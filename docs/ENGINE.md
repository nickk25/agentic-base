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
test file   test('INV-core-01 a message already in the target language produces no plan', ...)
```

Both directions fail. Documented with no test is a claim nobody checks; tested
with no document is a rule the next agent deletes without knowing it existed.

The limit is worth stating plainly: this proves an invariant is *covered*, never
that its test is any good. A test that asserts nothing satisfies it. Closing that
gap needs mutation testing, which is not here yet.

## Deletion is not a repair

Two shortcuts an agent finds quickly, both closed:

- Deleting the file a `changed` requirement points at no longer satisfies it.
  Removing a module together with its contract is the legitimate case; it is
  rare enough to waive on purpose rather than allow silently.
- Deleting a failing test no longer clears its open regression. Retiring a
  vanished subject is right when it was healthy and simply no longer exists to
  measure; applied to a failing one it makes deletion the cheapest repair
  available.

## Snapshots persist

The state job commits the snapshot store back to `main`. Without it the timeline
was a dead feature: every run began with an empty store, diffed nothing against
nothing, and reported zero transitions forever. A push made with `GITHUB_TOKEN`
does not re-trigger workflows, so this cannot loop.

## Ids live in test titles

An invariant id is written at the front of the test's own title:

    test('INV-glob-01 a/**/b also matches a/b', ...)

It used to be a comment inside the test body, found by scanning backwards
through bracket nesting to locate the enclosing `test(` call. That was a
JavaScript lexer that was not a JavaScript lexer: a test inside `describe()`
reported as never run, and a string containing a bracket before the tag made the
tag look like it belonged to no test at all. Both failed closed, but the remedy
they offered was "rearrange your code until the heuristic is satisfied", which is
a poor thing to hand an agent.

Putting the id in the title removes the problem rather than patching it: the id
travels in the TAP output itself, so nothing has to be parsed out of source, and
ids are unique by construction. A test with no id is not an error and is not
counted as coverage of anything.

## Manifest validation is shared

One loader validates and both `gate` and `contracts` go through it; neither can
consume an unvalidated manifest. Beyond shape, five conditions are now errors,
all of which used to be accepted and produce a rule that quietly did nothing:
an empty `when`, a `when` of only negations, empty `paths`, a duplicate rule id,
and a non-positive `min`.

They are errors rather than warnings on purpose. A warning that never blocks is
the same theatre as a `changed` requirement dressed up as a gate — it sits in the
tree looking enforced. A rule set is a set of promises, and a rule that can never
fire is a promise that cannot be kept.

## Reconciling what ran with what the source says

Online mode holds two views of the world: the ids the run reported, and the ids
a scan of the test files found. They are now reconciled, because an id present
in one and absent from the other used to fall out of both directions and be
reported nowhere at all — a title built from a template literal or a variable,
or written with `it()` rather than `test()`, was simply invisible.

`.skip` and `.todo` are read straight off the call, so a test that never asserts
anything does not back a claim even in offline mode, where nothing is executed.

The state probe no longer counts a declared invariant whose test *failed* as
covered. That single line discarded the whole point of running the suite: the
failure would have appeared on the state page as coverage.

## One definition of the suite

`package.json`, the probes and the invariant check all point at the same test
tree, and the glob is quoted so Node expands it. Under `sh`, `**` collapses to
`*` and reaches only one level down — which let a claim be proven by a test the
real suite never ran, while a comment in the probe asserted the two were
mirrored.

Invariant ids are anchored to the `INV-` prefix. Without it the pattern matched
any capitalised-token-dash-word-dash-number, so an ordinary title such as
`HTTP-status-500 is mapped to a retry` was read as an undeclared invariant and
failed the check for a repository that had done nothing wrong.

## What counts as a change

`rejectWhitespaceOnly` reads the counts, not the presence of output. A mode-only
change — `chmod +x` — still prints a `--numstat` row, so a file being mentioned
is not the same as anything inside it moving. Blank lines, spaces, tabs and file
modes all fail to satisfy it; a binary file is taken at its word, since we cannot
see inside it to argue otherwise.

## Unreleased

- Empty-result refusals, capture escaping and shell allowlisting, executed-test
  anchoring, manifest validation, dirty-snapshot refusal, retiring subjects.
- First version: four obligation kinds, captured patterns, plan mode.
- Generated contract regions, pluggable generators, invariant bijection check.
- Fence-aware scanning: `gen:` markers inside ``` blocks are examples, not regions.
- Something that appears already working is `neutral`, not `up`. Otherwise the
- A test that arrives already failing is `down`, however new it is.
- Snapshots, timeline diffing and the state page.
- `gate` with an empty change set. The merge-base fallback makes this the normal
- `contracts --check` when it found no generated regions anywhere.
- The success lines now carry their own evidence — files evaluated, rules fired,
- **Shell.** A `command` requirement is a shell string. A directory named
- **Patterns.** A directory named `evil*` substituted into a requirement used to
- Deletion loopholes closed, snapshots persisted, duplicate tags rejected, empty-but-allowed results reported honestly.
- Ids in test titles, shared manifest validation, blank lines no longer count as a change.
- it() recognised, inert tests rejected, TAP views reconciled, failing claims no longer counted as covered.
- INV- prefix required, one suite definition, mode-only changes rejected, YAML errors named, state job serialised.
