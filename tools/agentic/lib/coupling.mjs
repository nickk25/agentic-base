/**
 * Coupling rules: "if these files change, these other things must be true".
 *
 * One manifest covers documentation contracts, schema migrations, prompt evals
 * and dependency decisions, because they are all the same shape. The engine
 * knows nothing about any of them; it only knows the four kinds below.
 *
 * Not every kind carries the same weight, and pretending otherwise is how a
 * rule set turns into theatre:
 *
 *   command  the real gate. Re-runs a generator and compares against what was
 *            committed. Asks whether the file is TRUE, not whether it changed.
 *   added    a real gate. A brand new path has to exist; editing an old file
 *            will not do.
 *   changed  a reminder, not a gate. It is satisfied by typing anything at all.
 *            Worth keeping — it makes an agent open the file — but never rely
 *            on it to prove the content is correct.
 *   label    a human gesture. Deliberate, traceable, and not cryptographic.
 */

import { execSync } from 'node:child_process'
import { added, touched } from './changed.mjs'
import { matchList, substitute } from './glob.mjs'

/**
 * @typedef {Object} Requirement
 * @property {'command'|'added'|'changed'|'label'} kind
 * @property {string} [run]        command to execute, for kind `command`
 * @property {string[]} [paths]    path patterns, for kinds `added` and `changed`
 * @property {number} [min]        how many matching paths are needed (default 1)
 * @property {string} [name]       label name, for kind `label`
 * @property {boolean} [rejectWhitespaceOnly] treat a whitespace-only diff as no change
 * @property {string} [fix]        what the agent should do about it
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string[]} when
 * @property {Requirement[]} require
 * @property {string} [why]
 */

/**
 * @typedef {Object} Violation
 * @property {string} ruleId
 * @property {Record<string,string>} bindings
 * @property {string[]} triggeredBy
 * @property {string} required
 * @property {string} [fix]
 * @property {string} [why]
 * @property {string} [detail]
 */

const bindingKey = (b) => JSON.stringify(Object.entries(b).sort())

/**
 * Group the paths that trigger a rule by the captures they resolved to.
 * `src/{module}/**` over three touched modules yields three groups.
 *
 * @param {Rule} rule
 * @param {string[]} paths
 * @returns {Map<string, { bindings: Record<string,string>, paths: string[] }>}
 */
function triggers(rule, paths) {
  const groups = new Map()
  for (const path of paths) {
    const bindings = matchList(rule.when, path)
    if (!bindings) continue
    const key = bindingKey(bindings)
    if (!groups.has(key)) groups.set(key, { bindings, paths: [] })
    groups.get(key).paths.push(path)
  }
  return groups
}

/**
 * Did this path change in a way that is more than whitespace?
 * @param {import('./changed.mjs').Range} range
 */
function changedBeyondWhitespace(range, path) {
  if (!range.base) return true
  try {
    const diff = execSync(
      `git diff -w --name-only ${range.base}...${range.head} -- ${JSON.stringify(path)}`,
      { encoding: 'utf8' },
    )
    return diff.trim().length > 0
  } catch {
    return true // Never fail a pull request because the whitespace probe itself broke.
  }
}

/**
 * Evaluate every rule against one range of changes.
 *
 * @param {Object} args
 * @param {Rule[]} args.rules
 * @param {import('./changed.mjs').Change[]} args.changes
 * @param {import('./changed.mjs').Range} args.range
 * @param {string[]} [args.labels]  labels on the pull request, for kind `label`
 * @param {boolean} [args.plan]     report which rules fire without running commands
 * @returns {Violation[]}
 */
export function evaluate({ rules, changes, range, labels = [], plan = false }) {
  const touchedPaths = touched(changes)
  const addedPaths = added(changes)
  /** @type {Violation[]} */
  const violations = []

  for (const rule of rules) {
    for (const { bindings, paths } of triggers(rule, touchedPaths).values()) {
      for (const req of rule.require) {
        const base = {
          ruleId: rule.id,
          bindings,
          triggeredBy: paths.slice(0, 5),
          why: rule.why,
          fix: req.fix && substitute(req.fix, bindings),
        }

        if (req.kind === 'label') {
          if (!labels.includes(req.name)) {
            violations.push({ ...base, required: `the label "${req.name}" on the pull request` })
          }
          continue
        }

        if (req.kind === 'command') {
          const run = substitute(req.run, bindings)
          if (plan) continue // A plan describes what will run; it does not run it.
          try {
            execSync(run, { stdio: 'pipe', encoding: 'utf8' })
          } catch (err) {
            violations.push({
              ...base,
              required: `\`${run}\` to succeed`,
              detail: (err.stderr || err.stdout || '').toString().trim().split('\n').slice(-12).join('\n'),
            })
          }
          continue
        }

        const wanted = req.paths.map((p) => substitute(p, bindings))
        const pool = req.kind === 'added' ? addedPaths : touchedPaths
        let hits = pool.filter((p) => matchList(wanted, p))

        if (req.kind === 'changed' && req.rejectWhitespaceOnly) {
          hits = hits.filter((p) => changedBeyondWhitespace(range, p))
        }

        const min = req.min ?? 1
        if (hits.length < min) {
          const verb = req.kind === 'added' ? 'a new file matching' : 'a change in'
          violations.push({
            ...base,
            required: `${verb} ${wanted.join(' or ')}${min > 1 ? ` (at least ${min})` : ''}`,
          })
        }
      }
    }
  }

  return violations
}

/**
 * Which rules this set of paths would fire, without running anything.
 * This is what `gate --plan` reports, so an agent learns the cost of a change
 * before writing it rather than after opening a pull request.
 *
 * @param {Rule[]} rules
 * @param {string[]} paths
 */
export function planFor(rules, paths) {
  return rules.flatMap((rule) =>
    [...triggers(rule, paths).values()].map(({ bindings, paths: hit }) => ({
      ruleId: rule.id,
      bindings,
      triggeredBy: hit,
      obligations: rule.require.map((r) =>
        r.kind === 'command'
          ? `run \`${substitute(r.run, bindings)}\``
          : r.kind === 'label'
            ? `the label "${r.name}"`
            : `${r.kind === 'added' ? 'a new file matching' : 'a change in'} ${r.paths
                .map((p) => substitute(p, bindings))
                .join(' or ')}`,
      ),
    })),
  )
}
