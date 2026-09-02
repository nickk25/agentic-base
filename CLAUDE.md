# agentic-base — map for agents

Scaffolding for repositories written and maintained entirely by agents. No human
reads this code end to end. The rules are not documentation about the product —
they are the product.

This file exists to route you to the right file in as few reads as possible.
It is capped at 120 lines and the cap is enforced. If something here does not
help you route, it belongs in a module contract instead.

## 0. Session protocol

1. Read this file, then the contract of the module you are about to touch.
2. Run `npm run gate:plan -- <the files you intend to touch>` **before writing**.
   It tells you which rules will fire and what they will demand. Discovering that
   at the end costs you a cycle.
3. Change one module. Needing two usually means a boundary is in the wrong place —
   stop and say so rather than working around it.
4. Regenerate what is generated, write the prose that changed.
5. `npm run gate && npm test`.
6. Open a pull request. It auto-merges when the checks pass; nobody reviews it.

## 1. What this is

A coupling-rule engine plus the CI wiring around it. A consuming repository copies
`tools/agentic/` and `.github/workflows/`, writes its own `coupling.yaml`, and gets
gates that cannot be bypassed with `--no-verify`.

## 2. Map

| Path | What lives there |
| --- | --- |
| `tools/agentic/lib/glob.mjs` | Path patterns with named captures. Everything else depends on it. |
| `tools/agentic/lib/changed.mjs` | Which files a change set touches, and which it adds. |
| `tools/agentic/lib/coupling.mjs` | The rule engine. The four obligation kinds. |
| `tools/agentic/gate.mjs` | CLI and the error interface. |
| `coupling.yaml` | This repository's own rules. Also the schema reference. |
| `docs/ENGINE.md` | Observable behaviour of the engine. Kept in step by a coupling rule. |

## 3. I want to change X, so I read Y

| Intent | Read first |
| --- | --- |
| Add or change a rule kind | `docs/ENGINE.md`, then `lib/coupling.mjs` |
| Change how paths match | `lib/glob.test.mjs` before `lib/glob.mjs` — the tests are the spec |
| Change what a failure looks like | `gate.mjs`, section `reportViolations` |
| Change which rules this repo enforces | `coupling.yaml` — protected, needs a label |
| Use this in another repository | `README.md`, section "Adopting this" |

## 4. Rules of this repository

Generated from `coupling.yaml`. Do not edit this section by hand.

<!-- gen:coupling -->
| Rule | Fires when you touch | It will demand |
| --- | --- | --- |
| `engine-docs` | `tools/agentic/**` | a change in `docs/ENGINE.md` |
| `matcher-proven` | `tools/agentic/lib/glob.mjs` | `npm test` to pass |
| `protected-controls` | `coupling.yaml`, `.github/workflows/**` | the `human-approved` label |
<!-- /gen:coupling -->

## 5. Commands

| Command | What it does |
| --- | --- |
| `npm run gate` | Evaluate every coupling rule against the current change set |
| `npm run gate:plan -- <paths>` | Which rules those paths would fire. Runs nothing. |
| `npm test` | The engine's own tests |
| `npm run gate -- --json` | The same result as data |

## 6. What a good pull request looks like

- One module. One reason.
- Every rule the plan predicted is satisfied, not waived.
- Generated sections regenerated, never hand-edited.
- Prose only where a machine cannot check it, and as little of it as possible.

## 7. Never

- Silence the checker: no `--no-verify`, no disabling a rule to make a pull
  request pass. If a rule is wrong, change the rule in its own pull request and
  say why.
- Weaken an expectation so the code passes. Fix the code.
- Add a rule that fires on more than roughly 40% of pull requests. It normalises
  the waiver and poisons the rules around it.
- Leave commented-out code. Delete it; the history has it.
- Add a dependency without a line in `docs/DECISIONS.md` saying why.
- Review your own work as the only reviewer.
