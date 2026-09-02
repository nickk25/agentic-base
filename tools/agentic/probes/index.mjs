/**
 * Probes: the facts a snapshot is made of.
 *
 * Every value here is measured, never narrated. That is the whole discipline of
 * the state page — an agent asked to summarise its own work writes something
 * optimistic, so no agent writes any of this.
 *
 * A probe is `{ name, measure(ctx) }` returning plain JSON. Add a project's own
 * as another file in this folder. Keep each value comparable across runs: the
 * timeline is built by diffing two snapshots, so a field that churns for no
 * reason becomes an entry that means nothing.
 *
 * Deliberately absent, and worth saying out loud: line coverage, test count,
 * commits per week, lines added. Agents inflate all four without moving quality,
 * and a number that only ever goes up stops being read.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.agentic'])

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Which invariants exist and which of them a test actually covers.
 *
 * The interesting number is not how many are covered — it is which ones are not.
 * A contract that claims more than it proves is the failure this whole scaffold
 * exists to make visible.
 */
export const invariants = {
  name: 'invariants',
  measure: () => {
    const r = run('node', ['tools/agentic/invariants.mjs', '--json'])
    try {
      const d = JSON.parse(r.out)
      return { declared: d.declared, covered: d.declared - d.missingTest.length, uncovered: d.missingTest, undocumented: d.undocumented }
    } catch {
      return { error: 'invariant probe failed', detail: r.out.trim().slice(0, 400) }
    }
  },
}

/**
 * Every named test and whether it passed.
 *
 * Stored per name rather than as a total, because a total hides the case that
 * matters: one test flipping from pass to fail while another is added.
 */
export const tests = {
  name: 'tests',
  measure: () => {
    const r = run('node', ['--test', '--test-reporter=tap', 'tools/agentic/**/*.test.mjs'])
    /** @type {Record<string,'pass'|'fail'>} */
    const byName = {}
    for (const line of r.out.split('\n')) {
      const m = /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(line)
      if (m) byName[m[2]] = m[1] === 'ok' ? 'pass' : 'fail'
    }
    return { byName, failing: Object.entries(byName).filter(([, v]) => v === 'fail').map(([k]) => k) }
  },
}

/** Whether the coupling rules currently hold, and which do not. */
export const coupling = {
  name: 'coupling',
  measure: () => {
    const r = run('node', ['tools/agentic/gate.mjs', '--json'])
    try {
      const d = JSON.parse(r.out)
      return { violations: d.violations.map((v) => ({ rule: v.ruleId, bindings: v.bindings, required: v.required })) }
    } catch {
      return { violations: [], error: r.out.trim().slice(0, 200) }
    }
  },
}

/**
 * Size of each module, against the budget it is meant to stay inside.
 * Size is a proxy and a weak one, but an unbounded module is where an agent
 * stops being able to hold the whole thing at once, which is the real limit.
 */
export const modules = {
  name: 'modules',
  measure: ({ root, modulesDir = 'src', budget = 1200 }) => {
    let names = []
    try {
      names = readdirSync(join(root, modulesDir)).filter((n) => statSync(join(root, modulesDir, n)).isDirectory())
    } catch {
      return {}
    }
    return Object.fromEntries(
      names.sort().map((n) => {
        const files = walk(join(root, modulesDir, n))
        const lines = files.reduce((t, f) => t + readFileSync(f, 'utf8').split('\n').length, 0)
        return [n, { files: files.length, lines, budget, overBudget: lines > budget }]
      }),
    )
  },
}

export const builtins = { invariants, tests, coupling, modules }
