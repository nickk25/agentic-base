# Engine behaviour

Observable behaviour of the coupling engine. A coupling rule keeps this file in
step with `tools/agentic/`: change the engine, say what changed here.

## Obligation kinds

| Kind | Satisfied when | What it actually proves |
| --- | --- | --- |
| `command` | The command exits 0 | Everything, when the command regenerates a file and compares it against what was committed. Cannot be satisfied by typing. |
| `added` | The change set adds a path matching the pattern | That a genuinely new file exists. Editing an old one does not count. |
| `changed` | Some diff exists in the target path | Only that somebody opened the file. Treat as a reminder. |
| `label` | The named label is on the pull request | That a person made a deliberate gesture. Traceable, not cryptographic. |

`changed` accepts `rejectWhitespaceOnly: true`, which re-diffs with `-w` and
ignores changes that are only whitespace. It raises the cost of gaming the rule
from "press enter" to "type a word". It does not make the rule trustworthy.

## Patterns

`*` one segment · `**` any number of segments, including none · `?` one character
· `{name}` one captured segment · leading `!` subtracts.

`a/**/b` matches `a/b`. A capture makes one rule cover every module: `src/{module}/**`
fires once per module actually touched, and the capture is substituted into the
requirement, so `src/{module}/CLAUDE.md` resolves per module with nobody listing them.

A malformed pattern throws rather than matching nothing. A pattern that silently
matches nothing would disable its rule with no signal at all, which is the worst
possible failure for a control.

## Comparison range

Two fixed SHAs, from `AGENTIC_BASE_SHA` and `AGENTIC_HEAD_SHA`. Never branch names:
the default branch moves while a pull request is open, so diffing against it pulls
in commits the pull request never made. Locally, with no event present, the range
falls back to the merge base with `main`.

Renames are disabled (`--no-renames`). Git otherwise reports a file created from
another one as a rename, and it vanishes from the added-files filter. What a rule
cares about is whether the PATH is new.

## Exit codes

`0` satisfied · `1` violations · `2` the manifest is missing or malformed.

`--json` emits the same result as data, including the resolved range, so anything
downstream reads structure instead of parsing a report.

## Generated contract regions

A contract is part machine, part prose. The machine part is fenced:

```
<!-- gen:coupling -->
...generated...
<!-- /gen:coupling -->
```

`contracts --check` regenerates every region in memory and compares. That is the
only question worth asking of documentation — not "did somebody edit it" but "is
it true" — and it is the one an agent cannot answer by typing.

Markers inside a fenced code block are examples, not regions. Documentation for
this feature has to show the syntax, and without fence awareness, writing those
docs silently corrupts them the next time the renderer runs — which is exactly
how it was found. Replacement splices by index rather than by pattern, so an
example further down the file cannot be hit instead of the real region.

Two failure modes are reported rather than silently repaired, because both make
a region stop being checked without anyone noticing:

- an opening marker with no close: the region is invisible to the renderer.
- a block whose generator does not exist: left untouched, never emptied. Wiping
  a region because a generator was renamed would delete the only true part of a
  contract.

Generators are pluggable. `tools/agentic/generators/index.mjs` ships the ones
that need no knowledge of the language being governed — `coupling`, `commands`,
`modules`. Anything that parses source is language-specific and belongs in the
consuming repository as another file in that folder exporting `{ name, generate }`.

## Invariants

`invariants` enforces a one-to-one mapping between claims in contracts and tests:

```
contract    - A message already in the target language produces no plan. `test: INV-core-01`
test file   // @invariant INV-core-01
```

Both directions fail. Documented with no test is a claim nobody checks; tested
with no document is a rule the next agent deletes without knowing it existed.

The limit is worth stating plainly: this proves an invariant is *covered*, never
that its test is any good. A test that asserts nothing satisfies it. Closing that
gap needs mutation testing, which is not here yet.

## Unreleased

- First version: four obligation kinds, captured patterns, plan mode.
- Generated contract regions, pluggable generators, invariant bijection check.
- Fence-aware scanning: `gen:` markers inside ``` blocks are examples, not regions.

## State and the timeline

`state snapshot` measures the repository through the probes in
`tools/agentic/probes/` and keeps the result under `.agentic/snapshots/`.
`state render` diffs consecutive snapshots into `docs/state.json`, and renders
`docs/state.html` as a view of it. Agents read the JSON; the HTML is never the
source.

A timeline entry is a **state transition, not a commit**. A merge that moves
nothing measurable produces no entry at all. That is deliberate: a log of commits
tells you the agents were busy, and this is meant to tell you whether the
software got better.

Severity is derived, never chosen — nothing asks anyone's opinion about whether a
change was good. Two rules carry most of the weight:

- Something that appears already working is `neutral`, not `up`. Otherwise the
  cheapest way to manufacture progress is to declare things that already pass.
- A test that arrives already failing is `down`, however new it is.

`usefulTransitionRate` is improvements divided by **snapshots**, not by entries,
so a burst of merges that changed nothing drags it down. It is the first number
to read: a repository can generate a great deal of activity while getting worse,
and that combination is what this is for.

Probes measure and never narrate. Line coverage, test count, commits per week and
lines added are deliberately absent — agents inflate all four without moving
quality, and a number that only goes up stops being read.
- Snapshots, timeline diffing and the state page.

## Refusing to report a green that measured nothing

Three checks now fail rather than pass when they had nothing to examine, each
with an explicit `--allow-empty` for the legitimate case:

- `gate` with an empty change set. The merge-base fallback makes this the normal
  situation on `main` and on a clean tree, and it used to print a checkmark.
- `contracts --check` when it found no generated regions anywhere.
- The success lines now carry their own evidence — files evaluated, rules fired,
  blocks checked — so a green result can be told apart from a green absence.

This is the single most important class of bug in a repository like this. A
control that reports success without doing anything is worse than no control,
because it is trusted.

## Untrusted captures

A capture is a real path segment, so its contents are controlled by whoever can
name a file. Two consequences, one severe:

- **Shell.** A `command` requirement is a shell string. A directory named
  `x; rm -rf .; false` used to execute. Captures are now validated against a
  strict allowlist and the rule is refused, by name, if a value falls outside it.
  Where a real argv is possible — the whitespace probe — no shell is used at all.
- **Patterns.** A directory named `evil*` substituted into a requirement used to
  be recompiled as a live wildcard, widening the very requirement it was meant to
  pin down. Captured values are escaped on the way in; the pattern author's own
  globs are untouched. The pattern language gained a backslash escape for this.

Same root cause both times: attacker-controlled text re-entering a language that
gives some characters meaning.

## Anchoring that actually anchors

`invariants` no longer accepts a tag on faith. By default it runs the suite,
associates each `@invariant` tag with its enclosing `test(...)` call by scanning
outward through bracket nesting, and requires that test to have executed and
passed. A tag in a file no runner touches, inside a failing test, or inside a
skipped one, no longer satisfies a claim; each lands in its own bucket
(`missingTest`, `unverified`, `orphanTags`) so the reason is never guessed.
`--offline` keeps the weaker structural check, and the mode in effect is always
printed — a check whose strictness is invisible is not a check.

Test names are read as static string literals and unescaped before comparison.
A dynamically built name cannot be resolved this way; that ceiling is real and
named rather than hidden.

## Manifest validation

A malformed rule is rejected before evaluation, with the rule named. `when:` as a
string rather than a list is the motivating case: it is valid YAML, and the
matcher would iterate it character by character, so the rule fires on unrelated
paths and stays silent on the intended one. It looks like a working rule while
doing nothing its author meant. Unknown keys are reported rather than ignored,
because a typo in a requirement key is the same failure wearing a different hat.

## Snapshots refuse a dirty tree

A snapshot stamped with `HEAD` while uncommitted changes sit on disk describes
code that commit never contained. It is refused by default; the opt-in marks the
snapshot `dirty`, forces the page red, and says so, because a measurement that
cannot state what it measured is worse than none.

## Unreleased

- Empty-result refusals, capture escaping and shell allowlisting, executed-test
  anchoring, manifest validation, dirty-snapshot refusal, retiring subjects.
