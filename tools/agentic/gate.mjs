#!/usr/bin/env node
/**
 * The gate.
 *
 * Its output is the primary interface of this repository. Almost every reader is
 * an agent, and a failure that says "coupling failed" costs it a whole cycle, so
 * every violation names the rule, what triggered it, what is missing, and what to
 * do next. That is not decoration — it is the difference between a gate that
 * teaches and a gate that blocks.
 *
 *   gate                     evaluate the current change set
 *   gate --plan a.ts b.ts    which rules those paths would fire, running nothing
 *   gate --json              the same result as data, for anything downstream
 */

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { changedFiles, resolveRange } from './lib/changed.mjs'
import { evaluate, planFor } from './lib/coupling.mjs'

const MANIFEST = process.env.AGENTIC_MANIFEST ?? 'coupling.yaml'

const c = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', green: '', dim: '', bold: '', off: '' }

function loadRules() {
  let raw
  try {
    raw = readFileSync(MANIFEST, 'utf8')
  } catch {
    console.error(`No ${MANIFEST} found. This repository declares no coupling rules yet.`)
    process.exit(2)
  }
  const doc = parse(raw)
  if (!doc?.rules?.length) {
    console.error(`${MANIFEST} has no rules.`)
    process.exit(2)
  }
  for (const rule of doc.rules) {
    if (!rule.id || !rule.when || !rule.require) {
      console.error(`${MANIFEST}: every rule needs "id", "when" and "require". Offending rule: ${rule.id ?? '(unnamed)'}`)
      process.exit(2)
    }
  }
  return doc.rules
}

const describe = (bindings) =>
  Object.keys(bindings).length ? ` ${c.dim}(${Object.entries(bindings).map(([k, v]) => `${k}=${v}`).join(', ')})${c.off}` : ''

function reportViolations(violations) {
  console.error(`\n${c.red}${c.bold}${violations.length} coupling violation${violations.length > 1 ? 's' : ''}${c.off}\n`)
  for (const v of violations) {
    console.error(`${c.red}✗${c.off} ${c.bold}${v.ruleId}${c.off}${describe(v.bindings)}`)
    console.error(`  ${c.dim}triggered by${c.off}  ${v.triggeredBy.join(', ')}`)
    console.error(`  ${c.dim}required${c.off}      ${v.required}`)
    if (v.why) console.error(`  ${c.dim}why${c.off}           ${v.why}`)
    if (v.fix) console.error(`  ${c.dim}fix${c.off}           ${v.fix}`)
    if (v.detail) console.error(v.detail.split('\n').map((l) => `                ${c.dim}${l}${c.off}`).join('\n'))
    console.error('')
  }
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const planAt = argv.indexOf('--plan')
  const rules = loadRules()

  if (planAt !== -1) {
    const paths = argv.slice(planAt + 1).filter((a) => !a.startsWith('--'))
    if (!paths.length) {
      console.error('gate --plan needs the paths you intend to touch.')
      process.exit(2)
    }
    const plan = planFor(rules, paths)
    if (json) return console.log(JSON.stringify({ plan }, null, 2))

    if (!plan.length) return console.log(`${c.green}No rules fire for those paths.${c.off}`)
    console.log(`\n${c.bold}Touching those paths will require:${c.off}\n`)
    for (const p of plan) {
      console.log(`${c.bold}${p.ruleId}${c.off}${describe(p.bindings)}`)
      for (const o of p.obligations) console.log(`  · ${o}`)
      console.log('')
    }
    return
  }

  const range = resolveRange()
  const changes = changedFiles(range)
  const labels = (process.env.AGENTIC_PR_LABELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const violations = evaluate({ rules, changes, range, labels })

  if (json) {
    console.log(JSON.stringify({ range, changed: changes.length, violations }, null, 2))
    process.exit(violations.length ? 1 : 0)
  }

  if (!violations.length) {
    console.log(`${c.green}✓${c.off} ${changes.length} file${changes.length === 1 ? '' : 's'} changed, every coupling rule satisfied.`)
    return
  }

  reportViolations(violations)
  process.exit(1)
}

main()
