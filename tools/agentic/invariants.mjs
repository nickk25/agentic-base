#!/usr/bin/env node
/**
 * Invariants declared in contracts must map one-to-one onto tests.
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
 * This proves an invariant is *covered*, never that the test is any good. A test
 * that asserts nothing satisfies this happily. Mutation testing is what closes
 * that gap; this only closes the bookkeeping.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

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

function main() {
  const json = process.argv.includes('--json')
  const files = walk()
  const contracts = files.filter((f) => f.endsWith('CLAUDE.md'))
  const tests = files.filter((f) => /\.(test|spec)\.[a-z]+$/.test(f))

  const declared = collect(contracts, new RegExp(`\`test:\\s*(${ID})\``, 'g'))
  const tagged = collect(tests, new RegExp(`@invariant\\s+(${ID})`, 'g'))

  const missingTest = [...declared.keys()].filter((id) => !tagged.has(id))
  const undocumented = [...tagged.keys()].filter((id) => !declared.has(id))
  const duplicated = [...declared.entries()].filter(([, at]) => at.length > 1)

  if (json) {
    console.log(JSON.stringify({
      declared: declared.size,
      tagged: tagged.size,
      missingTest,
      undocumented,
      duplicated: duplicated.map(([id, at]) => ({ id, at })),
    }, null, 2))
    process.exit(missingTest.length || undocumented.length || duplicated.length ? 1 : 0)
  }

  const problems = missingTest.length + undocumented.length + duplicated.length
  if (!problems) {
    console.log(`${c.green}✓${c.off} ${declared.size} invariant${declared.size === 1 ? '' : 's'} declared, each with exactly one test.`)
    return
  }

  console.error(`\n${c.red}${c.bold}${problems} invariant problem${problems > 1 ? 's' : ''}${c.off}\n`)

  for (const id of missingTest) {
    const at = declared.get(id)[0]
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}declared but never tested${c.off}`)
    console.error(`  ${c.dim}declared at${c.off}  ${at.file}:${at.line}`)
    console.error(`  ${c.dim}fix${c.off}          write the test and tag it \`// @invariant ${id}\`, or drop the claim from the contract`)
    console.error('')
  }
  for (const id of undocumented) {
    const at = tagged.get(id)[0]
    console.error(`${c.red}✗${c.off} ${c.bold}${id}${c.off} ${c.dim}tested but not in any contract${c.off}`)
    console.error(`  ${c.dim}tagged at${c.off}    ${at.file}:${at.line}`)
    console.error(`  ${c.dim}fix${c.off}          add the invariant to the module's contract; an unwritten rule gets deleted by the next agent`)
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
