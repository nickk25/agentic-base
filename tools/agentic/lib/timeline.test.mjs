import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diff, health, openRegressions } from './timeline.mjs'

const snap = (sha, probes) => ({ ts: '2026-09-02T00:00:00.000Z', sha, subject: sha, probes })
const withTests = (sha, byName) => snap(sha, { tests: { byName, failing: Object.entries(byName).filter(([, v]) => v === 'fail').map(([k]) => k) } })

test('a snapshot that changed nothing measurable produces no entries', () => {
  // @invariant INV-timeline-01
  // The point of the whole file. A log of commits says the agents were busy; this
  // says whether the software moved, and they are different questions.
  const a = withTests('aaa', { one: 'pass' })
  const b = withTests('bbb', { one: 'pass' })
  assert.deepEqual(diff(a, b), [])
})

test('a test flipping either way is a transition with derived severity', () => {
  // @invariant INV-timeline-02
  const broke = diff(withTests('a', { one: 'pass' }), withTests('b', { one: 'fail' }))
  assert.equal(broke.length, 1)
  assert.equal(broke[0].severity, 'down')

  const fixed = diff(withTests('b', { one: 'fail' }), withTests('c', { one: 'pass' }))
  assert.equal(fixed[0].severity, 'up')
})

test('a test that arrives already failing is a regression, not a neutral addition', () => {
  // @invariant INV-timeline-03
  const entries = diff(withTests('a', {}), withTests('b', { fresh: 'fail' }))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].severity, 'down')
})

test('something that appears already working is neutral, never an improvement', () => {
  // @invariant INV-timeline-04
  // Otherwise the cheapest way to manufacture progress is to declare things that
  // already pass, and anything gameable into looking like progress eventually is.
  const before = snap('a', { invariants: { declared: 1, covered: 1, uncovered: [], undocumented: [] } })
  const after = snap('b', { invariants: { declared: 2, covered: 2, uncovered: [], undocumented: [] } })
  const entries = diff(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].severity, 'neutral')
})

test('a regression stays open until the same subject recovers', () => {
  // @invariant INV-timeline-05
  const entries = [
    ...diff(withTests('a', { one: 'pass' }), withTests('b', { one: 'fail' })),
    ...diff(withTests('b', { one: 'fail' }), withTests('c', { one: 'pass' })),
  ]
  assert.equal(openRegressions(entries).length, 0)
  assert.equal(openRegressions(entries.slice(0, 1)).length, 1)
})

test('the useful-transition rate is measured per snapshot, not per entry', () => {
  // @invariant INV-timeline-06
  // A burst of merges that changed nothing drags this down. That is the point:
  // it separates a repository that is moving from one that is going somewhere.
  const entries = diff(withTests('a', { one: 'fail' }), withTests('b', { one: 'pass' }))
  assert.equal(health(entries, 4).usefulTransitionRate, 0.25)
})
