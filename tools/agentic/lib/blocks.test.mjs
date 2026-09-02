import assert from 'node:assert/strict'
import { test } from 'node:test'
import { danglingBlocks, findBlocks, render, replaceBlock } from './blocks.mjs'

const doc = (body) => `# Title\n\n<!-- gen:demo -->\n${body}\n<!-- /gen:demo -->\n\ntail\n`

test('a block is found and its body replaced, markers untouched', () => {
  const out = replaceBlock(doc('old'), 'demo', 'new')
  assert.match(out, /<!-- gen:demo -->\nnew\n<!-- \/gen:demo -->/)
  assert.match(out, /tail/)
})

test('markers inside a code fence are examples, not regions', () => {
  // @invariant INV-blocks-01
  // Documenting this syntax means showing it. Without fence awareness, writing
  // the docs for the feature silently corrupts them the next time it runs.
  const text = [
    'Explaining the syntax:',
    '',
    '```',
    '<!-- gen:demo -->',
    'illustrative only',
    '<!-- /gen:demo -->',
    '```',
    '',
    '<!-- gen:demo -->',
    'the real one',
    '<!-- /gen:demo -->',
  ].join('\n')

  const blocks = findBlocks(text)
  assert.equal(blocks.length, 1, 'the fenced example must not count as a block')
  assert.equal(blocks[0].body.trim(), 'the real one')

  const out = replaceBlock(text, 'demo', 'generated')
  assert.match(out, /illustrative only/, 'the example must survive untouched')
  assert.doesNotMatch(out, /illustrative only[\s\S]*generated[\s\S]*illustrative/)
  assert.match(out, /<!-- gen:demo -->\ngenerated\n<!-- \/gen:demo -->/)
})

test('a tilde fence masks just like a backtick fence', () => {
  const text = '~~~\n<!-- gen:demo -->\nx\n<!-- /gen:demo -->\n~~~\n'
  assert.equal(findBlocks(text).length, 0)
})

test('an unclosed marker is reported rather than ignored', () => {
  // @invariant INV-blocks-02
  // The region stops being checked with no other signal, which is the failure
  // that matters: the contract looks maintained and is not.
  assert.deepEqual(danglingBlocks('<!-- gen:orphan -->\nbody\n'), ['orphan'])
  assert.deepEqual(danglingBlocks(doc('x')), [])
})

test('a block with no generator is left alone, never emptied', async () => {
  // @invariant INV-blocks-03
  // Emptying it because a generator was renamed would delete the only part of a
  // contract that was actually true.
  const before = doc('precious')
  const { text, unknown, rendered } = await render(before, {}, {})
  assert.equal(text, before)
  assert.deepEqual(unknown, ['demo'])
  assert.deepEqual(rendered, [])
})
