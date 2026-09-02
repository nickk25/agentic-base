#!/usr/bin/env node
/**
 * Invariants declared in contracts must map one-to-one onto tests that
 * actually ran and passed.
 *
 * A contract's Invariants section is prose, and prose is the part of a contract
 * that can lie. Anchoring each bullet to a test id is what stops it: the claim
 * stays in English, but its existence is checked against a real test.
 *
 *   contract   - A message already in the target language produces no plan. `test: INV-core-01`
 *   test file  // @invariant INV-core-01
 *
 * Both directions are enforced, and the second one is the one people forget:
 *
 *   documented with no test   a claim nobody checks. The whole point of the anchor.
 *   tested with no document   a rule the code enforces that no contract mentions,
 *                             so the next agent deletes it without knowing.
 *
 * "Anchored to a test" only means something if the anchor points at a test
 * that actually executed and passed. A `// @invariant` comment is a string,
 * and a string sitting in a file no test runner ever touches — a typo'd
 * filename, a file outside the tree `npm test` covers, a file that fails to
 * even load — satisfies a naive scan just as happily as a real, passing test
 * does. That is the gap this file used to leave open. By default it now
 * closes it: it runs the suite itself and requires the enclosing test for
 * each tag to have executed and passed. `--offline` opts back into the
 * weaker, structural-only check — see below — and the mode actually used is
 * always printed, so the strictness in effect is never invisible.
 *
 * This proves an invariant is *covered*, never that the test is any good. A test
 * that asserts nothing satisfies this happily. Mutation testing is what closes
 * that gap; this only closes the bookkeeping.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { discoverTestFiles, parseTap, runTapForFile } from './probes/index.mjs'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next'])
const ID = '[A-Z]{2,}-[a-zA-Z0-9_]+-[0-9]+'

const c = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', green: '', dim: '', bold: '', off: '' }

function walk(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || (entry.startsWith('.') && entry !== '.github')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** @returns {Map<string, {file: string, line: number}[]>} */
function collect(files, pattern) {
  const found = new Map()
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      for (const m of text.matchAll(pattern)) {
        const id = m[1]
        if (!found.has(id)) found.set(id, [])
        found.get(id).push({ file: relative(ROOT, file), line: i + 1 })
      }
    })
  }
  return found
}

// ---------------------------------------------------------------------------
// Tag → enclosing test.
//
// A tag is a comment, so it has no structure of its own to lean on — the only
// thing connecting it to a test is where it physically sits in the file. The
// design used here: scan backward, character by character, from the tag,
// tracking bracket nesting with a small stack of "closers we've already seen".
// A closer (`)`, `}`, `]`) gets pushed. An opener that matches the stack top
// gets popped — it was already closed somewhere between it and the tag, so it
// tells us nothing. An opener that does *not* match anything on the stack is,
// by construction, unmatched from the tag's point of view: it is a boundary
// the tag sits inside. If that boundary is a `(` immediately preceded by the
// identifier `test` (or `it`, `test.only`, `test.skip`, …) we've found the
// enclosing test and can read its name off the first argument. Otherwise it's
// some other enclosing thing — an arrow function body, an `if`, a `describe()`
// — and we keep walking outward past it to the next boundary.
//
// This is the "scan upward to the nearest enclosing test(...)" approach the
// task calls for, made precise: "nearest" means "the first qualifying,
// unmatched opening bracket", not merely "the closest line that happens to
// start with `test(`", which would be fooled by a sibling test earlier in the
// same file. A tag for which this scan runs off the top of the file without
// ever finding a qualifying call is not inside any test — that must be a
// reported error, never silence, so it is surfaced below as an "orphan tag",
// unconditionally (in both online and offline mode), since it is a defect in
// the tag itself and has nothing to do with whether tests were executed.
//
// Known limitation, worth naming: the test's name is read as a *static*
// source-level string literal. A dynamically built name (a template literal
// with interpolation, a name built from a variable) cannot be resolved this
// way and will not match the name Node reports at runtime. Every test in this
// repository uses a plain quoted literal, so this is not a live problem here,
// but it is a real ceiling on the approach.
const OPEN_FOR = { ')': '(', '}': '{', ']': '[' }

function readCallHead(content, parenIndex) {
  let i = parenIndex
  while (i > 0 && /\s/.test(content[i - 1])) i--
  const end = i
  while (i > 0 && /[A-Za-z0-9_$.]/.test(content[i - 1])) i--
  return content.slice(i, end)
}

function readLeadingStringLiteral(content, from) {
  let i = from
  while (i < content.length && /\s/.test(content[i])) i++
  const quote = content[i]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  let out = ''
  for (let j = i + 1; j < content.length; j++) {
    const ch = content[j]
    if (ch === '\\') {
      // Unescape rather than preserve: this name is compared against the name
      // Node prints at runtime, where `\\'` has already become `'`. Keeping the
      // backslash made every test whose title contains an apostrophe look like
      // a test that never ran — a false failure that would teach an agent to
      // distrust the check, which is worse than the check not existing.
      const next = content[j + 1] ?? ''
      out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' })[next] ?? next
      j++
      continue
    }
    if (ch === quote) return out
    out += ch
  }
  return null // unterminated — malformed source, not our problem to fix here
}

/** @returns {{ name: string|null } | null} null = not inside any test */
function findEnclosingTest(content, offset) {
  const stack = []
  for (let i = offset - 1; i >= 0; i--) {
    const ch = content[i]
    if (ch === ')' || ch === '}' || ch === ']') {
      stack.push(ch)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      const top = stack[stack.length - 1]
      if (top && OPEN_FOR[top] === ch) {
        stack.pop()
        continue
      }
      // Unmatched opener: a boundary the tag sits inside.
      if (ch === '(') {
        const head = readCallHead(content, i).split('.')[0]
        if (head === 'test' || head === 'it') {
          return { name: readLeadingStringLiteral(content, i + 1) }
        }
      }
      // Not a qualifying call — keep walking outward past this boundary.
    }
  }
  return null
}

function main() {
  const json = process.argv.includes('--json')
  const offline = process.argv.includes('--offline')
  const mode = offline ? 'offline' : 'online'

  const files = walk()
  const contracts = files.filter((f) => f.endsWith('CLAUDE.md'))
  const testFiles = discoverTestFiles(ROOT) // same tree the real `npm test` covers — see probes/index.mjs

  const declared = collect(contracts, new RegExp(`\`test:\\s*(${ID})\``, 'g'))

  // Every `@invariant` tag, resolved to the test that encloses it (or flagged
  // as an orphan if it isn't inside one at all).
  const TAG = new RegExp(`@invariant\\s+(${ID})`, 'g')
  const occurrences = new Map() // id -> [{file, line, testName}]
  const orphanTags = []

  for (const file of testFiles) {
    const rel = relative(ROOT, file)
    const content = readFileSync(file, 'utf8')
    for (const m of content.matchAll(TAG)) {
      const id = m[1]
      const line = content.slice(0, m.index).split('\n').length
      const enclosing = findEnclosingTest(content, m.index)
      if (!enclosing || !enclosing.name) {
        orphanTags.push({
          id,
          file: rel,
          line,
          reason: enclosing ? 'enclosing test name is not a static string literal' : 'not inside any test() call',
        })
        continue
      }
      if (!occurrences.has(id)) occurrences.set(id, [])
      occurrences.get(id).push({ file: rel, line, testName: enclosing.name })
    }
  }

  // Online mode (default): actually run the suite, one file at a time — the
  // same TAP parser the `tests` probe uses — and require the enclosing test
  // to have executed and passed. Offline mode skips this and accepts the
  // structural association alone (weaker, but still real: an orphan tag is
  // still an error either way).
  let results = null
  if (!offline) {
    results = new Map()
    for (const file of testFiles) {
      const rel = relative(ROOT, file)
      const r = runTapForFile(ROOT, rel)
      for (const entry of parseTap(r.out)) {
        results.set(`${rel} :: ${entry.qualifiedName}`, entry.state)
      }
    }
  }

  const stateOf = (occ) => results?.get(`${occ.file} :: ${occ.testName}`) ?? 'not run'
  const isProven = (occ) => !results || stateOf(occ) === 'pass'

  const tagged = new Set(occurrences.keys())
  const missingTest = [...declared.keys()].filter((id) => !tagged.has(id))
  const undocumented = [...tagged].filter((id) => !declared.has(id))
  const duplicated = [...declared.entries()].filter(([, at]) => at.length > 1)
  // "Exactly one test" has to mean exactly one on both sides. Two tests
  // carrying the same tag means deleting either leaves the claim looking
  // covered, so neither is really load-bearing.
  const duplicateTags = [...occurrences.entries()]
    .map(([id, at]) => [id, at.filter((o, i, all) => all.findIndex((x) => x.testName === o.testName && x.file === o.file) === i)])
    .filter(([, at]) => at.length > 1)

  // Declared, tagged, but the tag's own test did not execute-and-pass. Only
  // meaningful in online mode — offline mode never checks execution, so this
  // is always empty there. The mode is always printed below, precisely so
  // that "why is this empty" is never a hidden question.
  const unverified = [...occurrences.entries()]
    .filter(([id]) => declared.has(id))
    .filter(([, occs]) => !occs.some(isProven))
    .map(([id, occs]) => ({ id, occurrences: occs.map((o) => ({ ...o, state: stateOf(o) })) }))

  const problems = missingTest.length + undocumented.length + duplicated.length + duplicateTags.length + unverified.length + orphanTags.length

  if (json) {
    console.log(JSON.stringify({
      mode,
      declared: declared.size,
      tagged: tagged.size,
      missingTest,
      undocumented,
      duplicated: duplicated.map(([id, at]) => ({ id, at })),
      duplicateTags: duplicateTags.map(([id, at]) => ({ id, at })),
      unverified,
      orphanTags,
    }, null, 2))
    process.exit(problems ? 1 : 0)
  }

  const modeLine = offline
    ? `${c.dim}mode: offline — structural check only, tests were NOT executed${c.off}`
    : `${c.dim}mode: online — the test suite was executed and results checked${c.off}`

  if (!problems) {
    console.log(`${c.green}✓${c.off} ${declared.size} invariant${declared.size === 1 ? '' : 's'} declared, each with exactly one test.`)
    console.log(modeLine)
    return
  }

  console.error(`\n${c.red}${c.bold}${problems} invariant problem${problems > 1 ? 's' : ''}${c.off}`)
  console.error(modeLine)
  console.error('')

  for (const id of missingTest) {
    const at = declared.get(id)[0]
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}declared but never tested${c.off}`)
    console.error(`  ${c.dim}declared at${c.off}  ${at.file}:${at.line}`)
    console.error(`  ${c.dim}fix${c.off}          write the test and tag it \`// @invariant ${id}\`, or drop the claim from the contract`)
    console.error('')
  }
  for (const { id, occurrences: occs } of unverified) {
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}tagged, but its test did not run and pass${c.off}`)
    for (const o of occs) {
      console.error(`  ${c.dim}tagged at${c.off}    ${o.file}:${o.line} ${c.dim}(test "${o.testName}", state: ${o.state})${c.off}`)
    }
    console.error(`  ${c.dim}fix${c.off}          make the test run and pass, or drop the claim from the contract`)
    console.error('')
  }
  for (const { id, file, line, reason } of orphanTags) {
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}tag is not attached to any test${c.off}`)
    console.error(`  ${c.dim}at${c.off}           ${file}:${line} ${c.dim}(${reason})${c.off}`)
    console.error(`  ${c.dim}fix${c.off}          move the \`// @invariant\` comment inside a \`test(...)\` callback`)
    console.error('')
  }
  for (const id of undocumented) {
    const at = occurrences.get(id)[0]
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}tested but not in any contract${c.off}`)
    console.error(`  ${c.dim}tagged at${c.off}    ${at.file}:${at.line}`)
    console.error(`  ${c.dim}fix${c.off}          add the invariant to the module's contract; an unwritten rule gets deleted by the next agent`)
    console.error('')
  }
  for (const [id, at] of duplicateTags) {
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}tagged in more than one test${c.off}`)
    console.error(`  ${c.dim}at${c.off}           ${at.map((a) => `${a.file}:${a.line}`).join(', ')}`)
    console.error(`  ${c.dim}fix${c.off}          one claim, one test. Deleting either of these would leave the claim looking covered.`)
    console.error('')
  }
  for (const [id, at] of duplicated) {
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}declared in more than one place${c.off}`)
    console.error(`  ${c.dim}at${c.off}           ${at.map((a) => `${a.file}:${a.line}`).join(', ')}`)
    console.error(`  ${c.dim}fix${c.off}          one invariant, one contract. Give the second one its own id.`)
    console.error('')
  }

  process.exit(1)
}

main()
