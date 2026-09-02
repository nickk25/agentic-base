/**
 * Generated regions inside a Markdown file.
 *
 * A contract is part machine, part prose. The machine part is fenced:
 *
 *   <!-- gen:exports -->
 *   ...whatever the generator produced...
 *   <!-- /gen:exports -->
 *
 * The point is not that the region gets rewritten. It is that `--check` can
 * regenerate it and compare, so the question stops being "did somebody edit the
 * documentation" and becomes "is the documentation TRUE". A blank line, a
 * plausible sentence, a convincing lie — none of them survive a byte comparison
 * against the code.
 *
 * Everything outside the fences is prose nobody can verify, and it stays as
 * small as the contract can bear.
 */

/**
 * Blank out fenced code blocks, preserving length so indices stay meaningful.
 *
 * Documentation that explains this syntax has to show it, and an example inside
 * a ``` fence is not a region to fill in. Without this, writing the docs for the
 * feature silently corrupts the docs for the feature.
 *
 * @param {string} text
 */
function maskFences(text) {
  const lines = text.split('\n')
  let inFence = false
  let fence = ''

  const masked = lines.map((line) => {
    const opener = /^ {0,3}(```+|~~~+)/.exec(line)
    if (!inFence && opener) {
      inFence = true
      fence = opener[1][0]
      return line
    }
    if (inFence) {
      const closer = /^ {0,3}(```+|~~~+)\s*$/.exec(line)
      if (closer && closer[1][0] === fence) {
        inFence = false
        return line
      }
      return ' '.repeat(line.length)
    }
    return line
  })

  return masked.join('\n')
}

/**
 * Every generated block present in a document, in source order.
 * Markers inside a code fence are examples, not regions, and are skipped.
 *
 * @param {string} text
 * @returns {{ name: string, body: string, start: number, end: number, bodyStart: number, bodyEnd: number }[]}
 */
export function findBlocks(text) {
  const scan = maskFences(text)
  const re = /<!--\s*gen:([a-zA-Z][a-zA-Z0-9_-]*)\s*-->\n?([\s\S]*?)<!--\s*\/gen:\1\s*-->/g
  const found = []
  let m
  while ((m = re.exec(scan))) {
    const bodyStart = m.index + m[0].indexOf(m[2], m[0].indexOf('-->') + 3)
    found.push({
      name: m[1],
      body: text.slice(bodyStart, bodyStart + m[2].length),
      start: m.index,
      end: m.index + m[0].length,
      bodyStart,
      bodyEnd: bodyStart + m[2].length,
    })
  }
  return found
}

/**
 * An opening marker with no matching close. Worth reporting loudly: the region
 * silently stops being checked, which is the failure mode that matters.
 * @param {string} text
 */
export function danglingBlocks(text) {
  const scan = maskFences(text)
  const opened = [...scan.matchAll(/<!--\s*gen:([a-zA-Z][a-zA-Z0-9_-]*)\s*-->/g)].map((m) => m[1])
  const closed = [...scan.matchAll(/<!--\s*\/gen:([a-zA-Z][a-zA-Z0-9_-]*)\s*-->/g)].map((m) => m[1])
  return opened.filter((name) => {
    const i = closed.indexOf(name)
    if (i === -1) return true
    closed.splice(i, 1)
    return false
  })
}

/**
 * Replace one block's body, leaving the markers and everything else untouched.
 * Splices by index rather than by pattern, so an example of the same block in a
 * code fence further down cannot be hit instead.
 *
 * @param {string} text
 * @param {string} name
 * @param {string} body
 */
export function replaceBlock(text, name, body) {
  const block = findBlocks(text).find((b) => b.name === name)
  if (!block) return text
  const normalised = body.endsWith('\n') ? body : `${body}\n`
  return text.slice(0, block.bodyStart) + normalised + text.slice(block.bodyEnd)
}

/**
 * Render every block a document declares, using the generators available.
 *
 * A block whose generator is missing is left alone and reported, rather than
 * emptied. Wiping a region because a generator was renamed would silently
 * delete the only true part of a contract.
 *
 * @param {string} text
 * @param {Record<string, (ctx: any) => string|Promise<string>>} generators
 * @param {any} ctx
 * @returns {Promise<{ text: string, rendered: string[], unknown: string[] }>}
 */
export async function render(text, generators, ctx) {
  const rendered = []
  const unknown = []
  let out = text

  for (const block of findBlocks(text)) {
    const gen = generators[block.name]
    if (!gen) {
      unknown.push(block.name)
      continue
    }
    out = replaceBlock(out, block.name, await gen(ctx))
    rendered.push(block.name)
  }

  return { text: out, rendered, unknown }
}
