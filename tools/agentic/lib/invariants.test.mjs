import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTap, tests as testsProbe } from '../probes/index.mjs'

// invariants.mjs is exercised end to end, as a real subprocess, against a
// throwaway fixture repository under os.tmpdir() — never against fixtures
// added to this repository. Each fixture reproduces one specific way a
// `@invariant` tag can fail to genuinely back a declared claim: living
// outside the tree that actually gets tested, sitting in a test that fails,
// sitting in a test that's skipped, or not sitting inside a test at all.

const INVARIANTS = fileURLToPath(new URL('../invariants.mjs', import.meta.url))
// The tag and the declaration marker are assembled at runtime rather than
// written literally. This file's fixtures contain example contracts and example
// test files as strings, and a repo-wide scan cannot tell a string literal from
// a comment — spelling them out here would make every fixture look like a real
// declaration with no test behind it, and this suite would permanently poison
// the very check it exists to verify.
const TAG = `@${'invariant'}`
const CLAIM = (id) => `- Some guarantee. \`${'test'}: ${id}\`\n`

const HEADER = "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\n\n"

function makeFixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'invariants-test-'))
}

function write(root, relPath, content) {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** Runs the real invariants.mjs against `root` and returns its parsed --json output. */
function runInvariants(root, extraArgs = []) {
  try {
    const out = execFileSync('node', [INVARIANTS, '--json', ...extraArgs], { cwd: root, encoding: 'utf8' })
    return JSON.parse(out)
  } catch (err) {
    // invariants.mjs exits 1 whenever it finds a problem; the JSON is still on stdout.
    return JSON.parse(err.stdout)
  }
}

test('a tag in a file outside the executed test tree does not satisfy a declared invariant', () => {
  // @invariant INV-invariants-01
  const root = makeFixtureRoot()
  try {
    write(root, 'CLAUDE.md', CLAIM('INV-fixture-01'))
    // Sits at the repo root, outside tools/agentic/** — the tree the real
    // `npm test` (and this tool) actually runs. A tag here must not be able
    // to satisfy the claim just because the file's name ends in `.test.mjs`.
    write(root, 'rogue.test.mjs', `${HEADER}test('rogue', () => {\n  // ${TAG} INV-fixture-01\n  assert.ok(true)\n})\n`)

    const result = runInvariants(root)
    assert.ok(result.missingTest.includes('INV-fixture-01'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tag inside a failing test does not satisfy a declared invariant', () => {
  // @invariant INV-invariants-02
  const root = makeFixtureRoot()
  try {
    write(root, 'CLAUDE.md', CLAIM('INV-fixture-02'))
    write(root, 'tools/agentic/lib/failing.test.mjs', `${HEADER}test('will fail', () => {\n  // ${TAG} INV-fixture-02\n  assert.ok(false)\n})\n`)

    const result = runInvariants(root)
    assert.equal(result.missingTest.includes('INV-fixture-02'), false, 'the tag exists, so it is not simply "missing"')
    const entry = result.unverified.find((u) => u.id === 'INV-fixture-02')
    assert.ok(entry, 'a failing test must not satisfy the declared invariant')
    assert.equal(entry.occurrences[0].state, 'fail')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tag inside a skipped test does not satisfy a declared invariant', () => {
  // @invariant INV-invariants-03
  const root = makeFixtureRoot()
  try {
    write(root, 'CLAUDE.md', CLAIM('INV-fixture-03'))
    write(
      root,
      'tools/agentic/lib/skipped.test.mjs',
      `${HEADER}test('skipped', { skip: true }, () => {\n  // ${TAG} INV-fixture-03\n  assert.ok(true)\n})\n`,
    )

    const result = runInvariants(root)
    const entry = result.unverified.find((u) => u.id === 'INV-fixture-03')
    assert.ok(entry, 'a skipped test must not satisfy the declared invariant')
    assert.equal(entry.occurrences[0].state, 'skip')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tag not inside any test() call is reported as an orphan, in both online and offline mode', () => {
  // @invariant INV-invariants-04
  const root = makeFixtureRoot()
  try {
    write(
      root,
      'tools/agentic/lib/orphan.test.mjs',
      `${HEADER}// ${TAG} INV-fixture-04\n\ntest('unrelated', () => {\n  assert.ok(true)\n})\n`,
    )

    for (const args of [[], ['--offline']]) {
      const result = runInvariants(root, args)
      const label = args.join(' ') || 'online'
      assert.ok(result.orphanTags.some((o) => o.id === 'INV-fixture-04'), `expected an orphan-tag report in ${label} mode`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('duplicate test names across different files do not collide in the tests probe', () => {
  // @invariant INV-invariants-05
  const root = makeFixtureRoot()
  try {
    write(root, 'tools/agentic/lib/a.test.mjs', `${HEADER}test('same name', () => {\n  assert.ok(true)\n})\n`)
    write(root, 'tools/agentic/lib/b.test.mjs', `${HEADER}test('same name', () => {\n  assert.ok(false)\n})\n`)

    const { byName } = testsProbe.measure({ root })
    const keys = Object.keys(byName).filter((k) => k.endsWith('same name'))
    assert.equal(keys.length, 2, 'each file must contribute its own entry for "same name"')
    const states = keys.map((k) => byName[k]).sort()
    assert.deepEqual(states, ['fail', 'pass'], 'the two identically-named tests must not overwrite one another')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseTap records a SKIP directive as its own state, never as a pass, and strips it from the name', () => {
  // @invariant INV-invariants-06
  const tap = [
    'TAP version 13',
    '# Subtest: skipped one',
    'ok 1 - skipped one # SKIP reason',
    '  ---',
    '  duration_ms: 0.1',
    '  ...',
    '1..1',
  ].join('\n')

  const leaves = parseTap(tap)
  assert.equal(leaves.length, 1)
  assert.equal(leaves[0].name, 'skipped one')
  assert.equal(leaves[0].state, 'skip')
})

test('parseTap does not count a describe() suite’s own summary line as a test', () => {
  // @invariant INV-invariants-07
  const tap = [
    'TAP version 13',
    '# Subtest: a suite',
    '    # Subtest: inner',
    '    ok 1 - inner',
    '      ---',
    '      duration_ms: 0.1',
    '      ...',
    '    1..1',
    "ok 1 - a suite",
    '  ---',
    '  duration_ms: 0.2',
    "  type: 'suite'",
    '  ...',
    '1..1',
  ].join('\n')

  const leaves = parseTap(tap)
  assert.equal(leaves.length, 1, 'the suite line itself must not be counted as a test')
  assert.equal(leaves[0].qualifiedName, 'a suite > inner')
  assert.equal(leaves[0].state, 'pass')
})

test('--offline mode is announced and does not require execution to satisfy a claim', () => {
  // @invariant INV-invariants-08
  const root = makeFixtureRoot()
  try {
    write(root, 'CLAUDE.md', CLAIM('INV-fixture-08'))
    // Would fail if it were ever executed — offline mode must never run it.
    write(root, 'tools/agentic/lib/wouldfail.test.mjs', `${HEADER}test('would fail', () => {\n  // ${TAG} INV-fixture-08\n  assert.ok(false)\n})\n`)

    const result = runInvariants(root, ['--offline'])
    assert.equal(result.mode, 'offline', 'the mode actually used must be visible in the output')
    assert.equal(result.missingTest.includes('INV-fixture-08'), false)
    assert.equal(result.unverified.length, 0, 'offline mode does not check execution at all')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tag inside a test that actually ran and passed satisfies the declared invariant', () => {
  // @invariant INV-invariants-09
  const root = makeFixtureRoot()
  try {
    write(root, 'CLAUDE.md', CLAIM('INV-fixture-09'))
    write(root, 'tools/agentic/lib/ok.test.mjs', `${HEADER}test('passes', () => {\n  // ${TAG} INV-fixture-09\n  assert.ok(true)\n})\n`)

    const result = runInvariants(root)
    assert.equal(result.missingTest.includes('INV-fixture-09'), false)
    assert.equal(result.unverified.length, 0)
    assert.equal(result.orphanTags.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
