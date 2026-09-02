#!/usr/bin/env node
/**
 * Regenerate the machine-written parts of every contract.
 *
 *   contracts            rewrite the generated regions in place
 *   contracts --check    regenerate in memory and fail if the file differs
 *   contracts --json     the same result as data
 *
 * `--check` is the half that matters, and it is what a coupling rule of kind
 * `command` should run. It does not ask whether somebody edited the
 * documentation — it asks whether the documentation matches the code, which is
 * the only version of that question an agent cannot satisfy by typing.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'yaml'
import { builtins } from './generators/index.mjs'
import { danglingBlocks, findBlocks, render } from './lib/blocks.mjs'

const ROOT = process.cwd()
const MANIFEST = process.env.AGENTIC_MANIFEST ?? 'coupling.yaml'
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next'])

const c = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', bold: '', off: '' }

/** Every Markdown file in the tree, ignoring the usual noise. */
function markdownFiles(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.') && entry !== '.github') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) markdownFiles(full, out)
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

/**
 * Built-ins plus whatever the consuming repository dropped into `generators/`.
 * Language-specific generators live there, so this engine never has to know
 * what language it is governing.
 */
async function loadGenerators() {
  const map = Object.fromEntries(Object.values(builtins).map((g) => [g.name, g.generate]))
  const dir = join(ROOT, 'tools/agentic/generators')

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.mjs') || file === 'index.mjs') continue
    const mod = await import(join(dir, file))
    for (const exported of Object.values(mod)) {
      if (exported?.name && typeof exported.generate === 'function') {
        map[exported.name] = exported.generate
      }
    }
  }
  return map
}

/** The first non-heading, non-blank line of a module's contract. */
function readFirstProse(moduleName, modulesDir = 'src') {
  try {
    const text = readFileSync(join(ROOT, modulesDir, moduleName, 'CLAUDE.md'), 'utf8')
    return text.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'))?.trim()
  } catch {
    return null
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const json = argv.includes('--json')

  const rules = parse(readFileSync(join(ROOT, MANIFEST), 'utf8'))?.rules ?? []
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const generators = await loadGenerators()
  const ctx = { rules, pkg, root: ROOT, readFirstProse }

  const stale = []
  const written = []
  const unknown = []
  const dangling = []

  for (const file of markdownFiles()) {
    const before = readFileSync(file, 'utf8')

    const loose = danglingBlocks(before)
    if (loose.length) dangling.push({ file: relative(ROOT, file), names: loose })
    if (!findBlocks(before).length) continue

    const result = await render(before, generators, ctx)
    if (result.unknown.length) unknown.push({ file: relative(ROOT, file), names: result.unknown })

    if (result.text === before) continue
    if (check) stale.push({ file: relative(ROOT, file), blocks: result.rendered })
    else {
      writeFileSync(file, result.text)
      written.push({ file: relative(ROOT, file), blocks: result.rendered })
    }
  }

  if (json) {
    console.log(JSON.stringify({ stale, written, unknown, dangling }, null, 2))
    process.exit(stale.length || dangling.length ? 1 : 0)
  }

  for (const d of dangling) {
    console.error(`${c.yellow}!${c.off} ${d.file}: opening marker with no close for ${d.names.join(', ')}`)
    console.error(`  ${c.dim}That region is silently unchecked. Close it, or delete the marker.${c.off}`)
  }
  for (const u of unknown) {
    console.error(`${c.yellow}!${c.off} ${u.file}: no generator named ${u.names.join(', ')}`)
    console.error(`  ${c.dim}Left untouched rather than emptied. Add it to tools/agentic/generators/, or remove the block.${c.off}`)
  }

  if (check) {
    if (!stale.length && !dangling.length) {
      console.log(`${c.green}✓${c.off} every generated section matches the code.`)
      return
    }
    if (stale.length) {
      console.error(`\n${c.red}${c.bold}${stale.length} contract${stale.length > 1 ? 's are' : ' is'} out of date${c.off}\n`)
      for (const s of stale) {
        console.error(`${c.red}✗${c.off} ${c.bold}${s.file}${c.off}`)
        console.error(`  ${c.dim}stale sections${c.off}  ${s.blocks.join(', ')}`)
        console.error(`  ${c.dim}fix${c.off}             npm run contracts`)
        console.error('')
      }
    }
    process.exit(1)
  }

  if (!written.length) console.log(`${c.green}✓${c.off} nothing to regenerate.`)
  for (const w of written) console.log(`${c.green}updated${c.off} ${w.file} ${c.dim}(${w.blocks.join(', ')})${c.off}`)
}

main()
