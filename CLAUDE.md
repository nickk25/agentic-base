# agentic-base — map for agents

Scaffolding for repositories written and maintained entirely by agents. No human
reads this code end to end. The rules are not documentation about the product —
they are the product.

This file exists to route you to the right file in as few reads as possible.
It is capped at 360 lines and the cap is enforced. If something here does not
help you route, it belongs in a module contract instead.

## 0. The gates are advisory. Treat them as binding.

This repository is private on a plan where branch protection does not exist, so
CI reports a failure and nothing stops the merge. **The gate cannot enforce
itself. You are the enforcement.**

That is not permission to move faster. It is the opposite: every rule here is
one you could step over without anyone noticing, which is exactly why stepping
over one is the most damaging thing you can do in this repository.

So, without exception:

- **A red gate means do not merge.** Not "merge and open a follow-up". Not
  "merge, it is only advisory". Fix it, or leave the pull request open.
- **Never route around a rule.** Do not rename a file, move code to a path the
  pattern misses, or split a change across pull requests so that neither one
  fires the rule. If a rule is wrong, change the rule in its own pull request
  and say why. Working around a rule silently is worse than the bug the rule
  was there to catch.
- **State the result, every time.** Finish any session that touched code by
  reporting the outcome of `npm run gate` and `npm test` verbatim — including
  the failures you did not fix and why. This is the point of the rule: it makes
  ignoring a gate require an explicit false statement rather than a convenient
  silence.
- **Never claim a gate passed without running it.** If you could not run it, say
  that instead.

When branch protection is switched on, this section becomes redundant and the
machine takes over. Until then it is the only thing standing in for it.

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
- The useful-transition rate is measured per snapshot, not per entry, so a burst
  of merges that changed nothing drags it down. `test: INV-timeline-06`
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
- Offline mode is announced in the output and does not require execution to satisfy a claim. `test: INV-invariants-08`
- An id carried by an `it()` test is recognised in both directions, so an entire dialect of the test runner is not invisible. `test: INV-invariants-10`
- A test declared with `.skip` or `.todo` does not back a claim, even offline where nothing is executed. `test: INV-invariants-11`
- A declared claim whose test fails is not reported as covered by the state probe. `test: INV-invariants-12`
- A tag inside a test that actually ran and passed satisfies the declared invariant. `test: INV-invariants-09`
- A renamed test's old name is retired, not left open, once it no longer exists to be re-checked. `test: INV-timeline-07`
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
