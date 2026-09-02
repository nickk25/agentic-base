import assert from 'node:assert/strict'
import { test } from 'node:test'
import { match, matchList, substitute } from './glob.mjs'

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
