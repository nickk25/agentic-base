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

test('INV-glob-01 a/**/b also matches a/b', () => {
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

test('INV-glob-02 malformed patterns fail loudly rather than matching nothing', () => {
  // A pattern that quietly matches nothing would disable a rule with no signal.
  assert.throws(() => match('src/{unterminated', 'src/a'), /unterminated capture/)
  assert.throws(() => match('src/{9bad}/x', 'src/a/x'), /invalid capture name/)
  assert.throws(() => match('{m}/{m}', 'a/b'), /duplicate capture/)
})

test('INV-glob-03 matchList binds the more specific pattern no matter where it sits in the list', () => {
  // Picking whichever positive pattern matched first would let `src/**`, ahead
  // of `src/{module}/**`, always win — the capture-free pattern would win and
  // `module` would never bind, no matter how the rule was written.
  const moduleFirst = ['src/{module}/**', 'src/**']
  const moduleLast = ['src/**', 'src/{module}/**']
  assert.deepEqual(matchList(moduleFirst, 'src/core/plan.ts'), { module: 'core' })
  assert.deepEqual(matchList(moduleLast, 'src/core/plan.ts'), { module: 'core' })
})

test('INV-glob-04 matchList breaks a tie between equally-specific patterns by keeping the first', () => {
  // "Most captures wins" needs its own tie-break, or picking between two
  // patterns that bind the same number of names would be order-dependent again.
  const patterns = ['src/{module}/plan.ts', 'src/{name}/plan.ts']
  assert.deepEqual(matchList(patterns, 'src/core/plan.ts'), { module: 'core' })
})

test('INV-glob-05 an unbound capture left in a required path would match any value, not the one intended', () => {
  // The end-to-end danger of picking the wrong pattern in matchList: if
  // `src/**` won here, `module` would never bind, and `substitute` would leave
  // the literal `{module}` in the required path. That string, recompiled as a
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

test('INV-glob-06 substituteStrict fills captures the same way substitute does', () => {
  assert.equal(substituteStrict('src/{module}/CLAUDE.md', { module: 'core' }), 'src/core/CLAUDE.md')
})

test('INV-glob-07 substituteStrict fails loudly instead of letting a capture go unbound', () => {
  // `substitute` would leave `{other}` in place here, and that placeholder acts
  // as a wildcard if it is ever recompiled as a pattern — the worst failure
  // mode for anything that gates access. substituteStrict must refuse instead.
  assert.throws(
    () => substituteStrict('src/{other}/x', { module: 'core' }),
    /unbound capture "other" in pattern: src\/\{other\}\/x/,
  )
})

test('INV-glob-08 a negation excludes a path for good, even when a later pattern matches it directly', () => {
  // Documents the intentional trade-off: negation applies over the whole
  // list, so once a path is excluded there is no way to write a later
  // positive pattern that re-includes it. Predictability (no order-dependence)
  // is chosen over the extra expressiveness re-inclusion would allow.
  const patterns = ['!src/**/*.test.ts', 'src/**', 'src/**/*.test.ts']
  assert.equal(matchList(patterns, 'src/a.test.ts'), null)
})

test('INV-glob-09 an escaped metacharacter is a literal, not a wildcard', () => {
  // Captures come from real path segments, so their content is not trusted
  // input. Without an escape there is no way to substitute `evil*` back into a
  // pattern without it becoming one.
  const pattern = `${escapeGlob('evil*')}/x`
  assert.ok(match(pattern, 'evil*/x'), 'the literal name still matches itself')
  assert.equal(match(pattern, 'evilABC/x'), null, 'and matches nothing else')
  assert.ok(match(`${escapeGlob('a{b}')}/x`, 'a{b}/x'), 'braces escape too, not just stars')
})

test('INV-glob-10 escaping leaves the pattern author\'s own globs alone', () => {
  assert.ok(match('src/*.ts', 'src/a.ts'))
  assert.deepEqual(match('src/{module}/**', 'src/core/a.ts'), { module: 'core' })
})
