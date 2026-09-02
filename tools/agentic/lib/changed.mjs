/**
 * Which files this pull request changes.
 *
 * Knows nothing about the project that uses it.
 *
 * Compares two fixed SHAs, never branch names: `main` moves while a pull request
 * is open, so diffing against it pulls in commits the pull request never made.
 * Locally, with no pull request event around, it falls back to the merge base
 * with the default branch.
 */

import { execFileSync } from 'node:child_process'

/** @typedef {'A'|'C'|'D'|'M'|'R'|'T'} Status */
/** @typedef {{ status: Status, path: string, from?: string }} Change */
/** @typedef {{ base: string|null, head: string, source: 'event'|'merge-base'|'no-base' }} Range */

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/**
 * The two ends of the diff.
 * In CI they come from the pull request event; locally, from the merge base.
 *
 * @param {{ base?: string, head?: string, defaultBranch?: string }} [opts]
 * @returns {Range}
 */
export function resolveRange(opts = {}) {
  const base = opts.base ?? process.env.AGENTIC_BASE_SHA
  const head = opts.head ?? process.env.AGENTIC_HEAD_SHA

  if (base && head) return { base, head, source: 'event' }

  const branch = opts.defaultBranch ?? 'main'
  const currentHead = git(['rev-parse', 'HEAD']).trim()

  try {
    return { base: git(['merge-base', branch, 'HEAD']).trim(), head: currentHead, source: 'merge-base' }
  } catch {
    // Fresh repository, or the default branch does not exist yet: everything counts as new.
    return { base: null, head: currentHead, source: 'no-base' }
  }
}

/**
 * The changes in the range, with their status.
 *
 * `--no-renames` is deliberate. Without it, a file created from another one is
 * reported as a rename and disappears from the added-files filter. What coupling
 * rules care about is whether the PATH is new, not where its bytes came from.
 *
 * @param {Range} range
 * @returns {Change[]}
 */
export function changedFiles(range) {
  const args = ['diff', '--no-renames', '--name-status', '-z']
  if (range.base) args.push(`${range.base}...${range.head}`)
  else args.push('--root', range.head)

  /** @type {Change[]} */
  const changes = []
  const fields = git(args).split('\0').filter(Boolean)

  for (let i = 0; i < fields.length; i++) {
    const status = /** @type {Status} */ (fields[i][0])
    if (status === 'R' || status === 'C') {
      // Should not appear with --no-renames, but consume both paths if it does.
      changes.push({ status, from: fields[++i], path: fields[++i] })
    } else {
      changes.push({ status, path: fields[++i] })
    }
  }
  return changes
}

/** Every path the range touches, deletions included. */
export const touched = (changes) => changes.map((c) => c.path)

/** Paths this range ADDS. Modifying an existing file does not count. */
export const added = (changes) => changes.filter((c) => c.status === 'A').map((c) => c.path)
