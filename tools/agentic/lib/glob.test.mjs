import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeGlob, match, matchList, substitute, substituteStrict } from './glob.mjs'

test('* stops at a separator', () => {
  assert.ok(match('src/*.ts', 'src/index.ts'))
  assert.equal(match('src/*.ts', 'src/core/index.ts'), null)
})

test('** crosses separators', () => {
  assert.ok(match('src/**', 'src/core/deep/index.ts'))
  assert.ok(match('src/**/*.ts', 'src/core/index.ts'))
})

test('a/**/b also matches a/b', () => {
  // @invariant INV-glob-01
  // The classic off-by-one: `**` has to be allowed to match nothing at all,
  // otherwise a rule silently skips files sitting directly in the folder.
  assert.ok(match('src/**/index.ts', 'src/index.ts'))
})

test('{name} captures exactly one segment', () => {
  assert.deepEqual(match('src/{module}/**', 'src/core/plan.ts'), { module: 'core' })
  assert.equal(match('src/{module}/**', 'src/index.ts'), null, 'loose files in src/ belong to no module')
})

test('captures resolve independently per path', () => {
  assert.deepEqual(match('src/{module}/**', 'src/llm/client.ts'), { module: 'llm' })
  assert.deepEqual(match('src/{a}/{b}/**', 'src/core/deep/x.ts'), { a: 'core', b: 'deep' })
})

test('dots are literal, not any-character', () => {
  assert.equal(match('a.ts', 'axts'), null)
})

test('a negation subtracts from the list', () => {
  const patterns = ['src/{module}/**', '!src/{module}/CLAUDE.md']
  assert.deepEqual(matchList(patterns, 'src/core/plan.ts'), { module: 'core' })
  assert.equal(matchList(patterns, 'src/core/CLAUDE.md'), null)
})

test('a negation wins wherever it sits in the list', () => {
  assert.equal(matchList(['!**/*.test.ts', 'src/**'], 'src/a.test.ts'), null)
})

test('substitute fills captures and leaves unknown ones alone', () => {
  assert.equal(substitute('src/{module}/CLAUDE.md', { module: 'core' }), 'src/core/CLAUDE.md')
  assert.equal(substitute('src/{other}/x', { module: 'core' }), 'src/{other}/x')
})

test('malformed patterns fail loudly rather than matching nothing', () => {
  // @invariant INV-glob-02
  // A pattern that quietly matches nothing would disable a rule with no signal.
  assert.throws(() => match('src/{unterminated', 'src/a'), /unterminated capture/)
  assert.throws(() => match('src/{9bad}/x', 'src/a/x'), /invalid capture name/)
  assert.throws(() => match('{m}/{m}', 'a/b'), /duplicate capture/)
})

test('matchList binds the more specific pattern no matter where it sits in the list', () => {
  // @invariant INV-glob-03
  // matchList used to keep whichever positive pattern matched first. With
  // `src/**` ahead of `src/{module}/**` that meant the capture-free pattern
  // always won and `module` never bound, no matter how the rule was written.
  const moduleFirst = ['src/{module}/**', 'src/**']
  const moduleLast = ['src/**', 'src/{module}/**']
  assert.deepEqual(matchList(moduleFirst, 'src/core/plan.ts'), { module: 'core' })
  assert.deepEqual(matchList(moduleLast, 'src/core/plan.ts'), { module: 'core' })
})

test('matchList breaks a tie between equally-specific patterns by keeping the first', () => {
  // @invariant INV-glob-04
  // "Most captures wins" needs its own tie-break, or picking between two
  // patterns that bind the same number of names would be order-dependent again.
  const patterns = ['src/{module}/plan.ts', 'src/{name}/plan.ts']
  assert.deepEqual(matchList(patterns, 'src/core/plan.ts'), { module: 'core' })
})

test('an unbound capture left in a required path would match any value, not the one intended', () => {
  // @invariant INV-glob-05
  // Pins the end-to-end danger from the bug report: before the matchList fix,
  // `src/**` won first, `module` never bound, and `substitute` left the
  // literal `{module}` in the required path. That string, recompiled as a
  // pattern, matches ANY module segment — a rule meant to require one
  // module's CLAUDE.md would be silently satisfied by every module's.
  const patterns = ['src/**', 'src/{module}/**']
  const bindings = matchList(patterns, 'src/core/plan.ts')
  const requiredPath = substitute('src/{module}/CLAUDE.md', bindings)
  assert.equal(requiredPath, 'src/core/CLAUDE.md', 'module must bind, not leave the placeholder literal')
  assert.deepEqual(match('src/{module}/CLAUDE.md', 'src/some-other-module/CLAUDE.md'), {
    module: 'some-other-module',
  })
})

test('substituteStrict fills captures the same way substitute does', () => {
  // @invariant INV-glob-06
  assert.equal(substituteStrict('src/{module}/CLAUDE.md', { module: 'core' }), 'src/core/CLAUDE.md')
})

test('substituteStrict fails loudly instead of letting a capture go unbound', () => {
  // @invariant INV-glob-07
  // `substitute` would leave `{other}` in place here, and that placeholder acts
  // as a wildcard if it is ever recompiled as a pattern — the worst failure
  // mode for anything that gates access. substituteStrict must refuse instead.
  assert.throws(
    () => substituteStrict('src/{other}/x', { module: 'core' }),
    /unbound capture "other" in pattern: src\/\{other\}\/x/,
  )
})

test('a negation excludes a path for good, even when a later pattern matches it directly', () => {
  // @invariant INV-glob-08
  // Documents the intentional trade-off: negation applies over the whole
  // list, so once a path is excluded there is no way to write a later
  // positive pattern that re-includes it. Predictability (no order-dependence)
  // is chosen over the extra expressiveness re-inclusion would allow.
  const patterns = ['!src/**/*.test.ts', 'src/**', 'src/**/*.test.ts']
  assert.equal(matchList(patterns, 'src/a.test.ts'), null)
})

test('an escaped metacharacter is a literal, not a wildcard', () => {
  // @invariant INV-glob-09
  // Captures come from real path segments, so their content is not trusted
  // input. Without an escape there is no way to substitute `evil*` back into a
  // pattern without it becoming one.
  const pattern = `${escapeGlob('evil*')}/x`
  assert.ok(match(pattern, 'evil*/x'), 'the literal name still matches itself')
  assert.equal(match(pattern, 'evilABC/x'), null, 'and matches nothing else')
  assert.ok(match(`${escapeGlob('a{b}')}/x`, 'a{b}/x'), 'braces escape too, not just stars')
})

test('escaping leaves the pattern author\'s own globs alone', () => {
  // @invariant INV-glob-10
  assert.ok(match('src/*.ts', 'src/a.ts'))
  assert.deepEqual(match('src/{module}/**', 'src/core/a.ts'), { module: 'core' })
})
