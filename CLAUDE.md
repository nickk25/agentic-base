# agentic-base — map for agents

Scaffolding for repositories written and maintained entirely by agents. No human
reads this code end to end. The rules are not documentation about the product —
they are the product.

This file exists to route you to the right file in as few reads as possible.
It is capped at 440 lines and the cap is enforced. If something here does not
help you route, it belongs in a module contract instead.

## 0. The gates are enforced. You cannot merge past them.

`main` is protected with an empty bypass list. Nobody writes to it outside a pull
request whose checks passed — not you, not the repository owner, not CI. A push
straight to `main` is refused by the server.

This section used to be an appeal to your discipline, because the gates were
advisory and a red check stopped nothing. It is now a description of what the
machine does. Two habits from that period are worth keeping anyway:

- **Report what the checks said**, verbatim, at the end of any session that
  touched code — including failures you did not fix, and why. The machine now
  blocks the merge, but it cannot make your summary honest.
- **Never route around a rule.** Renaming a file out of a pattern, or splitting a
  change so neither half fires the rule, still works and is still worse than the
  bug the rule existed to catch. If a rule is wrong, change the rule in its own
  pull request and say why.

Measurements are published to the `state` branch, never to `main`. The protection
did not bend to let CI write; the measurement moved.

## 1. Session protocol

1. Read this file, then the contract of the module you are about to touch.
2. Run `npm run gate:plan -- <the files you intend to touch>` **before writing**.
   It tells you which rules will fire and what they will demand. Discovering that
   at the end costs you a cycle.
3. Change one module. Needing two usually means a boundary is in the wrong place —
   stop and say so rather than working around it.
4. Regenerate what is generated, write the prose that changed.
5. `npm run gate && npm test`. Report both results, pass or fail.
6. Open a pull request. It auto-merges when the checks pass; nobody reviews it.

## 2. What this is

A coupling-rule engine plus the CI wiring around it. A consuming repository copies
`tools/agentic/` and `.github/workflows/`, writes its own `coupling.yaml`, and gets
gates that cannot be bypassed with `--no-verify`.

## 3. Map

| Path | What lives there |
| --- | --- |
| `tools/agentic/lib/glob.mjs` | Path patterns with named captures. Everything else depends on it. |
| `tools/agentic/lib/changed.mjs` | Which files a change set touches, and which it adds. |
| `tools/agentic/lib/coupling.mjs` | The rule engine. The four obligation kinds. |
| `tools/agentic/gate.mjs` | CLI and the error interface. |
| `tools/agentic/lib/blocks.mjs` | Generated regions inside Markdown. Fence-aware. |
| `tools/agentic/contracts.mjs` | Rewrites those regions; `--check` compares them against the code. |
| `tools/agentic/invariants.mjs` | The claim ↔ test bijection. |
| `tools/agentic/lib/timeline.mjs` | Snapshot diffing. Severity is derived, never chosen. |
| `tools/agentic/state.mjs` | Measures, stores, renders `docs/state.json` and `docs/state.html`. |
| `tools/agentic/probes/index.mjs` | The facts a snapshot is made of. Pluggable. |
| `coupling.yaml` | This repository's own rules. Also the schema reference. |
| `docs/ENGINE.md` | Observable behaviour of the engine. Kept in step by a coupling rule. |

## 4. I want to change X, so I read Y

| Intent | Read first |
| --- | --- |
| Add or change a rule kind | `docs/ENGINE.md`, then `lib/coupling.mjs` |
| Change how paths match | `lib/glob.test.mjs` before `lib/glob.mjs` — the tests are the spec |
| Change what a failure looks like | `gate.mjs`, section `reportViolations` |
| Change which rules this repo enforces | `coupling.yaml` — protected, needs a label |
| Add a fact to the state page | `probes/index.mjs`, then `lib/timeline.mjs` to make it a transition |
| Change what counts as progress | `lib/timeline.mjs` — severity rules live there and nowhere else |
| Use this in another repository | `README.md`, section "Adopting this" |

## 5. Rules of this repository

Generated from `coupling.yaml`. Do not edit this section by hand.

<!-- gen:coupling -->
| Rule | Fires when you touch | It will demand |
| --- | --- | --- |
| `engine-docs` | `tools/agentic/**` | a change in `docs/ENGINE.md` |
| `matcher-proven` | `tools/agentic/lib/glob.mjs` | `npm test` to pass |
| `contracts-current` | `tools/agentic/**`, `package.json`, `coupling.yaml`, `**/CLAUDE.md` | `npm run contracts:check` to pass |
| `invariants-anchored` | `tools/agentic/**`, `**/CLAUDE.md` | `npm run invariants` to pass |
| `protected-controls` | `coupling.yaml`, `.github/workflows/**` | the `human-approved` label |
| `measured-history` | `.agentic/snapshots/**` | the `human-approved` label |
<!-- /gen:coupling -->

## 6. Invariants of the engine

Each bullet is anchored to a test. `npm run invariants` enforces the mapping in
both directions: a claim with no test is a claim nobody checks, and a tagged test
with no claim is a rule the next agent deletes without knowing it existed.

This proves an invariant is covered, never that its test is any good — a test
that asserts nothing satisfies it happily. That gap is what mutation testing is
for, and it is not here yet.

- `**` may match nothing, so `a/**/b` matches `a/b`. A rule that skipped files
  sitting directly in a folder would be wrong in the direction nobody notices.
  `test: INV-glob-01`
- A malformed pattern throws instead of matching nothing. Silently matching
  nothing disables its rule with no signal at all. `test: INV-glob-02`
- A captured rule fans out once per module the change set actually touched.
  `test: INV-coupling-01`
- A rule stays silent for modules nothing touched. `test: INV-coupling-02`
- The capture is substituted into the requirement, so each module is measured
  against its own contract. `test: INV-coupling-03`
- `added` refuses a modified file where a new one was required. `test: INV-coupling-04`
- A `label` requirement reads the labels on the pull request. `test: INV-coupling-05`
- Plan mode never executes a command. Asking what a change will cost must stay
  cheaper than making it. `test: INV-coupling-06`
- A failing command reports its own output, not just its exit code. Otherwise an
  agent has to re-run it to learn why, which costs a cycle. `test: INV-coupling-07`
- A captured path segment that is unsafe to interpolate into a shell string refuses the `command` requirement instead of running it. `test: INV-coupling-08`
- A hostile path used by the whitespace probe never reaches a shell, so it cannot execute anything. `test: INV-coupling-09`
- A whitespace-only edit does not satisfy a requirement marked `rejectWhitespaceOnly`. `test: INV-coupling-10`
- An edit with real content satisfies a requirement marked `rejectWhitespaceOnly`. `test: INV-coupling-11`
- A required path referencing a capture its own rule never binds is reported as a rule error, not a crash. `test: INV-coupling-12`
- With no base commit, every path HEAD introduces is treated as new, not diffed as the working tree against HEAD. `test: INV-coupling-13`
- The gate refuses to report success when the change set is empty, unless `--allow-empty` is passed. `test: INV-coupling-14`
- `gate --plan` normalises a `./` prefix, a trailing slash, and an absolute in-repo path to the same result as the bare relative path. `test: INV-coupling-15`
- The gate rejects a malformed manifest, naming the offending rule and the problem, before evaluating anything. `test: INV-coupling-16`
- A capture containing glob metacharacters cannot widen the requirement it fills. `test: INV-coupling-17`
- Deleting the target does not satisfy a `changed` requirement; otherwise the cheapest way to satisfy "document what you did" is to delete the document. `test: INV-coupling-18`
- Adding blank lines does not satisfy `rejectWhitespaceOnly`. `test: INV-coupling-19`
- A mode-only change does not satisfy `rejectWhitespaceOnly`; zero bytes changed is not a change. `test: INV-coupling-20`
- Explicit `base` and `head` resolve to an event-sourced range, with options winning over the environment. `test: INV-changed-01`
- `base` and `head` fall back to the environment when options supply neither. `test: INV-changed-02`
- Only one of `base`/`head` being present does not resolve as an event-sourced range; half a range is not a range. `test: INV-changed-03`
- A resolvable merge base is reported as such, so a reader can tell where the comparison came from. `test: INV-changed-04`
- With no default branch to compare against, the range says so rather than inventing one. `test: INV-changed-05`
- ChangedFiles reports one entry per changed path, tagged with its real status. `test: INV-changed-06`
- With no base, changedFiles diffs the empty tree against head, not the working tree. `test: INV-changed-07`
- Touched/present/added derive exactly the right path lists from a mixed change set. `test: INV-changed-08`
- A binary file edit satisfies `rejectWhitespaceOnly`, since there is no text inside it to call whitespace. `test: INV-coupling-21`
- With no base to diff against, `rejectWhitespaceOnly` treats the path as genuinely changed. `test: INV-coupling-22`
- A git failure inside the whitespace probe fails open rather than blocking the pull request. `test: INV-coupling-23`
- An ordinary captured value is accepted as safe, and the command it gates genuinely runs. `test: INV-coupling-24`
- A capture unsafe only in its middle is still refused, not judged by its safe-looking ends alone. `test: INV-coupling-25`
- A rule that touches the same module through two different paths still produces one violation, not one per path. `test: INV-coupling-26`
- `triggeredBy` is capped at 5 paths even when many more paths triggered the rule. `test: INV-coupling-27`
- A requirement's own `fix` is substituted with the capture, and a requirement with no `fix` leaves it unset. `test: INV-coupling-28`
- Deleting a file's content down to nothing still counts as a real change under `rejectWhitespaceOnly`. `test: INV-coupling-29`
- Without `rejectWhitespaceOnly`, a whitespace-only edit still satisfies a plain `changed` requirement. `test: INV-coupling-30`
- An `added` violation and a `changed` violation read differently, and both name the pattern. `test: INV-coupling-31`
- A `min` greater than 1 is named in the requirement text, and `min: 1` claims no minimum at all. `test: INV-coupling-32`
- A failing command's detail keeps only the tail of its own output, not the whole thing. `test: INV-coupling-33`
- `--plan` describes every requirement kind in words an agent can act on, captures substituted in. `test: INV-coupling-34`
- Multiple acceptable path patterns read as alternatives, not concatenated into one. `test: INV-coupling-35`
- A failing command with no output of its own reports an empty detail, not a placeholder. `test: INV-coupling-36`
- `rejectWhitespaceOnly` is honoured only for `changed` requirements, never for `added` ones. `test: INV-coupling-37`
- Two `when` patterns that bind the same captures in a different order still group into one violation. `test: INV-coupling-38`
- The no-base short-circuit fires before any `git diff` runs, even one that would report "no change". `test: INV-coupling-39`
- A requirement entry that is not an object is reported by name, not a crash. `test: INV-manifest-23`
- A rule entry that is not an object is reported for every check, not a crash. `test: INV-manifest-24`
- An unknown "kind" names every kind it could have been, comma-separated. `test: INV-manifest-25`
- An empty YAML document is reported as declaring no rules, not a crash. `test: INV-manifest-26`
- A YAML syntax error is reported by name and position, not thrown. `test: INV-manifest-27`
- Deleting a failing test does not clear its open regression. `test: INV-timeline-12`
- A rule with no `id` is rejected by name instead of being silently accepted. `test: INV-manifest-01`
- A `when` written as a string instead of a list is rejected instead of being iterated character by character. `test: INV-manifest-02`
- A `require` that is not a list is rejected instead of being silently accepted. `test: INV-manifest-03`
- An unknown key on a rule is named instead of being ignored. `test: INV-manifest-04`
- An unknown requirement `kind` is named along with the rule and requirement index that carries it. `test: INV-manifest-05`
- A `command` requirement without `run` is rejected. `test: INV-manifest-06`
- A `label` requirement without `name` is rejected. `test: INV-manifest-07`
- A `changed` requirement whose `paths` is not a list is rejected. `test: INV-manifest-08`
- A key not used by a requirement's kind (e.g. `paths` on `command`) is named instead of being ignored. `test: INV-manifest-09`
- A rule whose `when` is `[]` is rejected as a rule that can never fire. `test: INV-manifest-10`
- A rule whose `when` consists entirely of negations is rejected as a rule that can never fire. `test: INV-manifest-11`
- An `added` requirement with `paths: []` is rejected as impossible to satisfy. `test: INV-manifest-12`
- A `changed` requirement with `paths: []` is rejected as impossible to satisfy. `test: INV-manifest-13`
- Two rules sharing the same `id` are rejected as duplicates. `test: INV-manifest-14`
- A `min` of zero is rejected instead of being treated as a requirement that is always satisfied. `test: INV-manifest-15`
- A `min` that is not an integer is rejected. `test: INV-manifest-16`
- An empty `require` list is rejected as a rule that demands nothing. `test: INV-manifest-17`
- A well-formed manifest produces zero problems. `test: INV-manifest-18`
- A manifest declaring zero rules is rejected as declaring nothing. `test: INV-manifest-19`
- A missing manifest file is reported by name instead of throwing. `test: INV-manifest-20`
- `loadManifest` reads and validates a real manifest file from disk. `test: INV-manifest-21`
- `validateRules` validates an already-parsed rule array directly, with no YAML or file I/O involved. `test: INV-manifest-22`
- Removing a healthy subject does retire its record, since there is nothing left to check. `test: INV-timeline-13`
- A renamed test — a passing subject vanishing while another passing subject appears, in matching counts, in the same diff — is recorded as neutral, never as a regression. `test: INV-timeline-07`
- `health` reports only what is open, with no cumulative counter and no rate. `test: INV-timeline-14`
- A mass rename of many passing tests produces only neutral entries and leaves nothing open. `test: INV-timeline-15`
- When removals outnumber matching additions, the unmatched ones still report as regressions; a real deletion does not hide behind rename detection. `test: INV-timeline-16`
- A genuine failure is still an open regression in a diff that also contains a rename. `test: INV-timeline-17`
- A failing test's disappearance is never matched into a rename; only a passing subject can be presumed carried over. `test: INV-timeline-18`
- An escaped metacharacter is a literal, not a wildcard, so a captured value can re-enter a pattern without becoming one. `test: INV-glob-09`
- Escaping a captured value leaves the pattern author's own globs intact. `test: INV-glob-10`
- A `gen:` marker inside a code fence is an example, not a region. Documenting
  this syntax must not corrupt the document. `test: INV-blocks-01`
- An unclosed marker is reported, not ignored. The region would otherwise stop
  being checked while the contract still looks maintained. `test: INV-blocks-02`
- A block whose generator is missing is left alone, never emptied. Wiping it
  would delete the only verified part of a contract. `test: INV-blocks-03`
- A snapshot that changed nothing measurable produces no timeline entry. A log of
  commits says the agents were busy; the timeline says whether the software
  moved. `test: INV-timeline-01`
- A test flipping either way is a transition, and its severity is derived, never
  chosen. `test: INV-timeline-02`
- A test that arrives already failing is a regression, not a neutral addition.
  `test: INV-timeline-03`
- Something that appears already working is neutral, never an improvement.
  Otherwise declaring easy claims becomes the cheapest way to look productive.
  `test: INV-timeline-04`
- A regression stays open until the same subject recovers. `test: INV-timeline-05`
- An empty block body renders and re-renders without corrupting the opening marker line. `test: INV-blocks-04`
- Rendering an already-rendered document produces byte-identical output (the round trip is idempotent). `test: INV-blocks-05`
- An unterminated code fence is reported by its opening line number instead of silently hiding every later block. `test: INV-blocks-06`
- A document whose fences all close reports no unterminated fence. `test: INV-blocks-07`
- Two blocks sharing a name are reported as a duplicate with both line numbers, and rendering such a document fails loudly instead of silently rendering only the first. `test: INV-blocks-08`
- A document with no duplicate block names reports no duplicates. `test: INV-blocks-09`
- `matchList` binds the most specific matching pattern (the one capturing the most names) regardless of where it sits in the list, because picking the first match arbitrarily could drop a capture a later, more specific pattern would have bound. `test: INV-glob-03`
- When two matching patterns bind the same number of captures, `matchList` keeps the earliest one, so the "most captures wins" rule is itself order-independent rather than trading one order-dependency for another. `test: INV-glob-04`
- An unbound `{name}` capture left in a required path is recompiled as a wildcard segment matching any value, so `matchList` must resolve captures correctly or a rule meant to require one specific path is silently satisfied by any path in its place. `test: INV-glob-05`
- `substituteStrict` fills every capture exactly like `substitute` when all names are bound, so it is a safe drop-in for callers that already provide complete bindings. `test: INV-glob-06`
- `substituteStrict` throws an error naming the unbound capture and the pattern instead of leaving the placeholder in place, because a silently widened wildcard is the worst failure mode for anything that gates access. `test: INV-glob-07`
- A negation excludes a path for the whole pattern list permanently, even when a later positive pattern would otherwise match that same path directly, because re-inclusion after an exclusion would make the result depend on pattern order — and these lists are written and read by agents, so predictability matters more than the extra expressiveness. `test: INV-glob-08`
- A tag in a file outside the tree the real test run covers must not satisfy a declared invariant. `test: INV-invariants-01`
- A tag inside a test that runs and fails must not satisfy a declared invariant. `test: INV-invariants-02`
- A tag inside a test that is skipped must not satisfy a declared invariant. `test: INV-invariants-03`
- Duplicate test names across different files do not collide in the tests probe's name-to-state map. `test: INV-invariants-05`
- The TAP parser records a SKIP directive as its own state, never as a pass, and strips the directive from the test name. `test: INV-invariants-06`
- The TAP parser does not count a `describe()` suite's own summary line as a test. `test: INV-invariants-07`
- An id carried by an `it()` test is recognised in both directions, so an entire dialect of the test runner is not invisible. `test: INV-invariants-10`
- A declared claim whose test fails is not reported as covered by the state probe. `test: INV-invariants-12`
- A tag inside a test that actually ran and passed satisfies the declared invariant. `test: INV-invariants-09`
- Removing a subject entirely (a module deleted after being over budget) clears any open regression already recorded against it. `test: INV-timeline-08`
- Two different transition kinds on the same subject can never cancel each other's open regressions. `test: INV-timeline-09`
- An invariant that regains coverage still closes its open regression, even though the covering and uncovering kinds are named differently. `test: INV-timeline-10`
- Taking a snapshot of a dirty working tree is refused by default, and proceeds only with an explicit opt-in that marks it dirty. `test: INV-timeline-11`

## 7. Commands

Generated from `package.json`. Do not edit by hand.

<!-- gen:commands -->
| Command | Runs |
| --- | --- |
| `npm run gate` | `node tools/agentic/gate.mjs` |
| `npm run gate:plan` | `node tools/agentic/gate.mjs --plan` |
| `npm run contracts` | `node tools/agentic/contracts.mjs` |
| `npm run contracts:check` | `node tools/agentic/contracts.mjs --check` |
| `npm run invariants` | `node tools/agentic/invariants.mjs` |
| `npm run test` | `node --test tools/agentic/**/*.test.mjs` |
| `npm run verify` | `npm run contracts:check && npm run invariants && npm test && npm run gate` |
| `npm run state` | `node tools/agentic/state.mjs` |
| `npm run state:snapshot` | `node tools/agentic/state.mjs snapshot` |
| `npm run mutate` | `stryker run` |
| `npm run mutate:quick` | `stryker run --mutate tools/agentic/lib/glob.mjs` |
<!-- /gen:commands -->

## 8. What a good pull request looks like

- One module. One reason.
- Every rule the plan predicted is satisfied, not waived.
- Generated sections regenerated, never hand-edited.
- Prose only where a machine cannot check it, and as little of it as possible.

## 9. Never

- Silence the checker: no `--no-verify`, no disabling a rule to make a pull
  request pass. If a rule is wrong, change the rule in its own pull request and
  say why.
- Weaken an expectation so the code passes. Fix the code.
- Add a rule that fires on more than roughly 40% of pull requests. It normalises
  the waiver and poisons the rules around it.
- Leave commented-out code. Delete it; the history has it.
- Add a dependency without a line in `docs/DECISIONS.md` saying why.
- Review your own work as the only reviewer.
