import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diff, health, openRegressions, refuseDirty } from './timeline.mjs'

const snap = (sha, probes) => ({ ts: '2026-09-02T00:00:00.000Z', sha, subject: sha, probes })
const withTests = (sha, byName) => snap(sha, { tests: { byName, failing: Object.entries(byName).filter(([, v]) => v === 'fail').map(([k]) => k) } })
const withModules = (sha, modules) => snap(sha, { modules })

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

test('a renamed test does not leave a permanent open regression', () => {
  // @invariant INV-timeline-07
  // A rename emits test.removed (down) for the old name; the new name arrives
  // already passing, which is neutral by the "already working" rule, so
  // nothing was ever going to produce an `up` for the vanished old name. The
  // removal itself must still show up in the raw timeline (for audit), just
  // not as something still open.
  const entries = diff(withTests('a', { old: 'pass' }), withTests('b', { new: 'pass' }))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'test.removed')
  assert.equal(entries[0].severity, 'down')
  assert.equal(openRegressions(entries).length, 0)
})

test('a removed subject clears any open regression already recorded against it', () => {
  // @invariant INV-timeline-08
  // The same defect as the renamed test, on the module side: module.budget can
  // leave a `down` open, and deleting the module entirely (module.removed,
  // itself neutral) used to never touch it, so a module that no longer exists
  // could stay "over budget" forever.
  const small = { core: { lines: 10, budget: 1000, overBudget: false } }
  const big = { core: { lines: 1500, budget: 1000, overBudget: true } }
  const entries = [
    ...diff(withModules('a', small), withModules('b', big)),
    ...diff(withModules('b', big), withModules('c', {})),
  ]
  // Sanity check: the regression really was open right up until the removal.
  assert.equal(openRegressions(entries.slice(0, 1)).length, 1)
  assert.equal(openRegressions(entries).length, 0)
})

test("different transition kinds on the same subject do not clear each other's regressions", () => {
  // @invariant INV-timeline-09
  // Entries built directly rather than via diff(), to test the key itself in
  // isolation: keying by kind.split('.')[0], as before, collapsed every
  // module.* kind onto one key, so this made-up module.added "up" would have
  // cleared a real module.budget regression on the same module.
  const budgetDown = { kind: 'module.budget', subject: 'core', severity: 'down' }
  const unrelatedUp = { kind: 'module.added', subject: 'core', severity: 'up' }
  assert.deepEqual(openRegressions([budgetDown, unrelatedUp]), [budgetDown])
})

test('an invariant regaining coverage still closes its open regression', () => {
  // @invariant INV-timeline-10
  // invariant.uncovered and invariant.covered record one regression under a
  // different verb per direction. Fixing the key collision above must not
  // break this deliberate pairing.
  const clean = snap('a', { invariants: { declared: 1, covered: 1, uncovered: [], undocumented: [] } })
  const uncovered = snap('b', { invariants: { declared: 1, covered: 0, uncovered: ['INV-x'], undocumented: [] } })
  const covered = snap('c', { invariants: { declared: 1, covered: 1, uncovered: [], undocumented: [] } })
  const entries = [...diff(clean, uncovered), ...diff(uncovered, covered)]
  assert.equal(openRegressions(entries).length, 0)
})

test('a dirty working tree is refused by default, and only proceeds with explicit opt-in', () => {
  // @invariant INV-timeline-11
  // Bug 1: a snapshot stamped with HEAD while measuring an uncommitted tree
  // silently misattributes those changes to that commit. Refusing by default
  // is the only way a snapshot can be trusted; the opt-in exists so local
  // experimentation isn't blocked, not so dirt can pass as clean.
  assert.equal(refuseDirty(false, false), null)
  assert.equal(refuseDirty(true, true), null)
  assert.equal(typeof refuseDirty(true, false), 'string')
})

test('deleting a failing test does not clear its regression', () => {
  // @invariant INV-timeline-12
  // Retiring a vanished subject is right when it was healthy and simply no
  // longer exists to check. Applied to a FAILING subject it makes deletion the
  // cheapest repair available, which is the shortcut an agent will find first.
  const withTests = (sha, byName) => ({
    ts: '2026-09-02T00:00:00.000Z', sha, subject: sha,
    probes: { tests: { byName, failing: Object.entries(byName).filter(([, v]) => v === 'fail').map(([k]) => k) } },
  })
  const entries = [
    ...diff(withTests('a', { one: 'pass' }), withTests('b', { one: 'fail' })),
    ...diff(withTests('b', { one: 'fail' }), withTests('c', {})),
  ]
  assert.equal(openRegressions(entries).length, 1, 'the regression survives the deletion')
})

test('removing a healthy subject does retire its record', () => {
  // @invariant INV-timeline-13
  const snap = (sha, mods) => ({ ts: '2026-09-02T00:00:00.000Z', sha, subject: sha, probes: { modules: mods } })
  const entries = [
    ...diff(snap('a', { core: { lines: 10, budget: 5, overBudget: false } }),
            snap('b', { core: { lines: 99, budget: 5, overBudget: true } })),
    ...diff(snap('b', { core: { lines: 99, budget: 5, overBudget: true } }), snap('c', {})),
  ]
  assert.equal(openRegressions(entries).length, 0)
})
