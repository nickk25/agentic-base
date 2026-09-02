/**
 * Path patterns with named captures.
 *
 * A deliberately small glob dialect, because coupling rules are read and written
 * by agents and every extra feature is another thing to get subtly wrong:
 *
 *   *          one path segment, no separators
 *   **         any number of segments, separators included
 *   ?          a single character, not a separator
 *   {name}     one path segment, captured under `name`
 *   !pattern   negation, only meaningful in a pattern list
 *
 * `{name}` is what makes one rule cover every module: `src/{module}/**` matches
 * each module folder and reports which one it matched, so the rule fans out
 * without anybody listing the modules by hand.
 */

const SPECIAL = /[.+^$()|[\]\\]/g

/**
 * Compile a pattern into a regular expression with named groups.
 * @param {string} pattern
 * @returns {{ re: RegExp, captures: string[] }}
 */
export function compile(pattern) {
  /** @type {string[]} */
  const captures = []
  let re = ''

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]

    if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) throw new Error(`unterminated capture in pattern: ${pattern}`)
      const name = pattern.slice(i + 1, end)
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`invalid capture name "${name}" in pattern: ${pattern}`)
      }
      if (captures.includes(name)) throw new Error(`duplicate capture "${name}" in pattern: ${pattern}`)
      captures.push(name)
      re += `(?<${name}>[^/]+)`
      i = end
      continue
    }

    if (ch === '*') {
      const isDouble = pattern[i + 1] === '*'
      if (isDouble) {
        // `a/**/b` should also match `a/b`, so swallow the following separator.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
      continue
    }

    if (ch === '?') {
      re += '[^/]'
      continue
    }

    re += ch.replace(SPECIAL, '\\$&')
  }

  return { re: new RegExp(`^${re}$`), captures }
}

/**
 * Match a path, returning its captures (an empty object when the pattern has none).
 * @param {string} pattern
 * @param {string} path
 * @returns {Record<string,string>|null}
 */
export function match(pattern, path) {
  const { re } = compile(pattern)
  const m = re.exec(path)
  return m ? { ...m.groups } : null
}

/**
 * Match against a list where entries starting with `!` subtract.
 * A path is included when some positive pattern matches and no negative one does.
 * @param {string[]} patterns
 * @param {string} path
 * @returns {Record<string,string>|null}
 */
export function matchList(patterns, path) {
  /** @type {Record<string,string>|null} */
  let hit = null
  for (const p of patterns) {
    if (p.startsWith('!')) {
      if (match(p.slice(1), path)) return null
    } else if (!hit) {
      hit = match(p, path)
    }
  }
  return hit
}

/**
 * Replace `{name}` placeholders with concrete values.
 * @param {string} pattern
 * @param {Record<string,string>} bindings
 */
export function substitute(pattern, bindings) {
  return pattern.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, name) =>
    name in bindings ? bindings[name] : whole,
  )
}
