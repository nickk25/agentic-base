import assert from 'node:assert/strict'
import { test } from 'node:test'
import { danglingBlocks, duplicateBlocks, findBlocks, render, replaceBlock, unterminatedFence } from './blocks.mjs'

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

test('an empty block body round-trips without corrupting the markers', async () => {
  // @invariant INV-blocks-04
  // indexOf('') returns its search start, so an empty body used to land the
  // replacement inside the opening marker line, producing "<!-- gen:x -->new"
  // and permanently mangling the marker on the very first render.
  const empty = '<!-- gen:demo -->\n<!-- /gen:demo -->\n'
  const out = replaceBlock(empty, 'demo', 'filled in')
  assert.equal(out, '<!-- gen:demo -->\nfilled in\n<!-- /gen:demo -->\n')
})

test('rendering an already-rendered document is a no-op', async () => {
  // @invariant INV-blocks-05
  // `contracts` writing a file that `contracts --check` then flags as stale is
  // the tool contradicting itself on the very next run.
  const generators = { demo: () => 'stable output' }
  const first = await render(doc(''), generators, {})
  const second = await render(first.text, generators, {})
  assert.equal(second.text, first.text)
  assert.deepEqual(second.rendered, ['demo'])
})

test('an unterminated code fence is reported by line, not silently ignored', () => {
  // @invariant INV-blocks-06
  // Leaving inFence true to end of file makes every later block invisible to
  // findBlocks and danglingBlocks alike — a check could pass green having
  // examined nothing after the break.
  const text = ['prose', '', '```js', "const x = 1", '', '<!-- gen:demo -->', 'body', '<!-- /gen:demo -->'].join('\n')
  assert.equal(unterminatedFence(text), 3)
  assert.equal(findBlocks(text).length, 0, 'the block after the broken fence must not be seen')
})

test('a closed fence reports no unterminated fence', () => {
  // @invariant INV-blocks-07
  assert.equal(unterminatedFence(doc('x')), null)
})

test('two blocks sharing a name are reported as a duplicate, not partially rendered', async () => {
  // @invariant INV-blocks-08
  // render() and replaceBlock() both resolve a block by name, so the second
  // declaration is never reachable — it would look maintained while actually
  // going unchecked. That has to fail loudly instead of picking a winner.
  const text = ['<!-- gen:demo -->', 'first', '<!-- /gen:demo -->', '', '<!-- gen:demo -->', 'second', '<!-- /gen:demo -->'].join('\n')
  const dupes = duplicateBlocks(text)
  assert.equal(dupes.length, 1)
  assert.equal(dupes[0].name, 'demo')
  assert.deepEqual(dupes[0].lines, [1, 5])

  await assert.rejects(() => render(text, { demo: () => 'x' }, {}))
})

test('a document with no duplicate names reports none', () => {
  // @invariant INV-blocks-09
  assert.deepEqual(duplicateBlocks(doc('x')), [])
})
