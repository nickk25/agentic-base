/**
 * The timeline: what actually changed between two snapshots.
 *
 * An entry is a state transition, not a commit. A merge that moves nothing
 * measurable produces no entries and is invisible here — deliberately. A log of
 * commits tells you the agents were busy; this tells you whether the software
 * got better, and those are different questions with different answers.
 *
 * Severity is derived, never chosen. Nothing in this file asks anyone's opinion
 * about whether a change was good.
 *
 * One rule worth naming: something that appears already working is `neutral`,
 * not `up`. Otherwise the cheapest way to manufacture progress is to declare
 * things that already pass, and anything that can be gamed to look like progress
 * eventually is.
 */

import { createHash } from 'node:crypto'

// Joined on NUL, not a space: a kind or subject containing a space would
// otherwise be able to collide with a different pair. Written as an escape
// rather than a raw byte — a literal NUL makes the file binary to `file`,
// `grep` and, the one that actually matters here, `git diff`, which turns the
// review surface of an agent-maintained repository into "Binary files differ".
const id = (parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12)

const keys = (o) => Object.keys(o ?? {})
const setOf = (a) => new Set(a ?? [])

/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} ts
 * @property {string} kind
 * @property {string} subject
 * @property {unknown} [from]
 * @property {unknown} [to]
 * @property {'up'|'down'|'neutral'} severity
 * @property {string[]} evidence
 */

/**
 * @param {any} before  previous snapshot, or null for the first one
 * @param {any} after   the snapshot just taken
 * @returns {Entry[]}
 */
export function diff(before, after) {
  /** @type {Entry[]} */
  const entries = []
  const ts = after.ts
  const pair = [before?.sha ?? 'genesis', after.sha]

  const push = (kind, subject, severity, extra = {}) =>
    entries.push({ id: id([kind, subject, ...pair]), ts, kind, subject, severity, evidence: [], ...extra })

  // ---- invariants -----------------------------------------------------------
  const bInv = before?.probes?.invariants
  const aInv = after.probes?.invariants
  if (aInv && !aInv.error) {
    const wasUncovered = setOf(bInv?.uncovered)
    const isUncovered = setOf(aInv.uncovered)

    for (const inv of isUncovered) {
      if (!wasUncovered.has(inv)) {
        push('invariant.uncovered', inv, 'down', { from: 'covered', to: 'uncovered' })
      }
    }
    for (const inv of wasUncovered) {
      if (!isUncovered.has(inv)) {
        push('invariant.covered', inv, 'up', { from: 'uncovered', to: 'covered' })
      }
    }

    // A declared invariant that arrives already covered is bookkeeping, not an
    // achievement. Counting it as progress makes declaring easy claims the
    // cheapest way to look productive.
    if (bInv && typeof bInv.declared === 'number' && aInv.declared !== bInv.declared) {
      push('invariant.count', 'declared', 'neutral', { from: bInv.declared, to: aInv.declared })
    }
  }

  // ---- tests ----------------------------------------------------------------
  const bTests = before?.probes?.tests?.byName ?? {}
  const aTests = after.probes?.tests?.byName ?? {}
  for (const name of keys(aTests)) {
    const was = bTests[name]
    const is = aTests[name]
    if (was && was !== is) {
      push('test.flip', name, is === 'pass' ? 'up' : 'down', { from: was, to: is })
    } else if (!was && is === 'fail') {
      // Landing a failing test is a regression however new it is.
      push('test.flip', name, 'down', { from: 'absent', to: 'fail' })
    }
  }
  for (const name of keys(bTests)) {
    if (!(name in aTests)) push('test.removed', name, 'down', { from: bTests[name], to: 'absent' })
  }

  // ---- coupling -------------------------------------------------------------
  const key = (v) => `${v.rule}${Object.keys(v.bindings ?? {}).length ? ` (${Object.values(v.bindings).join(',')})` : ''}`
  const bViol = new Set((before?.probes?.coupling?.violations ?? []).map(key))
  const aViol = new Set((after.probes?.coupling?.violations ?? []).map(key))
  for (const v of aViol) if (!bViol.has(v)) push('coupling.opened', v, 'down', { to: 'violated' })
  for (const v of bViol) if (!aViol.has(v)) push('coupling.closed', v, 'up', { from: 'violated' })

  // ---- modules --------------------------------------------------------------
  const bMods = before?.probes?.modules ?? {}
  const aMods = after.probes?.modules ?? {}
  for (const name of keys(aMods)) {
    const was = bMods[name]
    const is = aMods[name]
    if (!was) push('module.added', name, 'neutral', { to: `${is.lines} lines` })
    else if (was.overBudget !== is.overBudget) {
      push('module.budget', name, is.overBudget ? 'down' : 'up', {
        from: `${was.lines} lines`,
        to: `${is.lines} lines of ${is.budget}`,
      })
    }
  }
  for (const name of keys(bMods)) if (!(name in aMods)) push('module.removed', name, 'neutral')

  return entries
}

/**
 * Which regression family a kind belongs to: the thing two kinds must share to
 * be allowed to cancel each other in `openRegressions`. Most kinds are their
 * own family — a `test.flip` down clears only a later `test.flip` up on the
 * same subject — but a couple of pairs record one regression under a different
 * verb per direction, and those must still be recognised as the same thing.
 *
 * Keying by `kind.split('.')[0]` used to stand in for this and lumped in far
 * more than intended: `test.flip` and `test.removed` share a namespace but are
 * not the same regression, and `module.added` could clear a `module.budget`
 * regression on the same module purely because both start with `module.`.
 */
const FAMILY = {
  'invariant.uncovered': 'invariant.coverage',
  'invariant.covered': 'invariant.coverage',
  'coupling.opened': 'coupling.violation',
  'coupling.closed': 'coupling.violation',
}
const family = (kind) => FAMILY[kind] ?? kind

/**
 * Kinds that mean the subject itself is gone, not merely changed.
 *
 * A vanished subject can never be re-measured, so it can never again produce
 * the `up` that would close a regression — the "renamed test" and "deleted
 * module" defects were both this: a `down` left in the map with no way out.
 * The fix is decided here rather than by having `diff` invent a synthetic `up`
 * for the vanished subject, because `diff` only ever reports what one pair of
 * snapshots actually measured; a subject that disappeared was never observed
 * to improve, and fabricating an improvement for it would be exactly the kind
 * of narrated, unmeasured claim this file exists to refuse. So instead: a
 * disappearance retires every open regression on that subject, of any kind,
 * and is not itself added as a new one — there is nothing left to check.
 */
const RETIRES_SUBJECT = new Set(['test.removed', 'module.removed'])

/**
 * Regressions still open: a `down` with no later `up` on the same subject.
 *
 * This is the number to read first. A repository can produce a great deal of
 * activity while this climbs, and that combination is the thing worth catching
 * early — it means the agents are fixing things by breaking others.
 *
 * @param {Entry[]} entries  oldest first
 */
export function openRegressions(entries) {
  /** @type {Map<string, Entry>} */
  const open = new Map()
  for (const e of entries) {
    if (RETIRES_SUBJECT.has(e.kind)) {
      // '\0' can't appear in a kind or subject string, so it is a safe
      // separator: the same convention this file's own id() already uses.
      for (const [k, open_] of open) {
        if (k.slice(k.indexOf('\0') + 1) !== e.subject) continue
        // A subject that was passing and then vanished has nothing left to
        // check. A subject that was FAILING and then vanished was deleted, and
        // deletion is not a repair — retiring it here would make "delete the
        // failing test" the cheapest way to clear a regression, which is the
        // single most tempting shortcut available to an agent.
        if (open_.to !== 'fail') open.delete(k)
      }
      continue
    }
    const k = `${family(e.kind)}\0${e.subject}`
    if (e.severity === 'down') open.set(k, e)
    else if (e.severity === 'up') open.delete(k)
  }
  return [...open.values()]
}

/**
 * Whether a snapshot may be taken as measured, given whether the working tree
 * has uncommitted changes and whether the caller opted in anyway.
 *
 * Pulled out as a pure function so the refusal rule (Bug 1: a snapshot stamped
 * with `git rev-parse HEAD` while it measures whatever is actually on disk,
 * dirty or not) has a test that needs no real git repository — state.mjs owns
 * running `git status --porcelain`; this just decides what to do with the
 * answer.
 *
 * @param {boolean} dirty       true when the working tree has uncommitted changes
 * @param {boolean} allowDirty  explicit opt-in from the caller
 * @returns {string | null}     a refusal message, or null if the snapshot may proceed
 */
export function refuseDirty(dirty, allowDirty) {
  if (!dirty || allowDirty) return null
  return (
    'Refusing to snapshot: the working tree has uncommitted changes, so a snapshot ' +
    'stamped with HEAD would measure changes that commit never contained. Commit first, ' +
    'or pass --allow-dirty to record one anyway (it will be marked "dirty": true).'
  )
}

/**
 * How much of the movement is going anywhere.
 * Useful ratios and useless ones differ by the denominator: this one is
 * snapshots, so a burst of merges that changed nothing measurable drags it down,
 * which is exactly what it is for.
 *
 * @param {Entry[]} entries
 * @param {number} snapshots
 */
export function health(entries, snapshots) {
  const ups = entries.filter((e) => e.severity === 'up').length
  const downs = entries.filter((e) => e.severity === 'down').length
  return {
    snapshots,
    improvements: ups,
    regressions: downs,
    openRegressions: openRegressions(entries).length,
    usefulTransitionRate: snapshots ? +(ups / snapshots).toFixed(2) : 0,
  }
}
