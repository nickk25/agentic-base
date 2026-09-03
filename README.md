# agentic-base

Scaffolding for repositories written and maintained entirely by agents.

The premise is uncomfortable and worth stating first: **nobody reads this code.**
An agent writes it, an agent changes it, and the human directing the work never
opens most of it. Under those conditions a rule written in prose is a suggestion,
and a suggestion decays. So the rules here are executable, and the ones that are
not are labelled as what they are.

## What it gives you

**One manifest for coupled change.** `coupling.yaml` declares "if these files
change, these other things must be true." The same four obligation kinds cover
documentation contracts, schema migrations, prompt evals and dependency
decisions, and they are deliberately unequal in strength:

| Kind | Proves |
| --- | --- |
| `command` | Everything, when it regenerates a file and compares. Cannot be satisfied by typing. |
| `added` | A genuinely new path exists. Editing an old file does not count. |
| `changed` | Only that somebody opened the file. A reminder, and labelled as one. |
| `label` | A deliberate human gesture. Traceable, not cryptographic. |

**Contracts that cannot lie.** The machine-written regions of a `CLAUDE.md` are
fenced and regenerated. `contracts --check` rebuilds them and compares byte for
byte, so the question stops being "did somebody edit the documentation" and
becomes "is the documentation true".

**Claims anchored to tests.** Every invariant in a contract cites a test id, and
the mapping is enforced in both directions. Documented with no test is a claim
nobody checks; tested with no document is a rule the next agent deletes without
knowing it existed.

**A state page that measures rather than narrates.** No model writes a word of
it. Its timeline records state transitions, not commits: a merge that moves
nothing measurable is invisible, because a commit log tells you the agents were
busy and this is meant to tell you whether the software got better.

**Errors written for the reader they actually have.** Almost every reader is an
agent, and a failure that says `lint failed` costs it a whole cycle. Every
violation names the rule, what triggered it, what is missing and what to do.
`gate --plan <paths>` reports what a change will demand *before* it is written.

## Adopting this

1. Copy `tools/agentic/` and `.github/workflows/gates.yml`.
2. Add the scripts from `package.json` (`gate`, `contracts`, `invariants`,
   `state`, `verify`).
3. Write your own `coupling.yaml`. The one here is commented as the schema
   reference.
4. Drop language-specific generators into `tools/agentic/generators/` and extra
   probes into `tools/agentic/probes/`. Both are `{ name, ... }` exports picked
   up automatically. The engine never learns what language it is governing.
5. Copy `CLAUDE.md` as the shape of a root contract and rewrite it for your
   project. Keep it a router, not a manual.

## Enforcement

Gates run in CI on pull requests, never in local hooks. `--no-verify` is a native
git flag that no hook manager can block or detect, so the branch is the only
place a check can actually prevent a write.

`main` here is protected by a ruleset with an **empty bypass list**: no pull
request, no merge, and no exception for the repository owner. Auto-merge is enabled, but it is requested per pull request
(`gh pr merge --auto`), so opening one and asking for auto-merge is a single
step in the session protocol. GitHub then merges it the moment the checks pass
and deletes the branch — it exists for three minutes and nobody reads it. The pull request is not a review ritual; it is the only
place a check can stand between a change and the branch.

One consequence worth stating, because it shaped the design: CI cannot write to
`main` either. Measurements are therefore published to a separate `state` branch.
The protection did not bend to accommodate the tooling.

Branch protection does not exist on **private** repositories on the free plan.
That is why this one is public. If you adopt this in a private repository, either
pay for it or accept that every gate here is advisory — and if it is advisory,
say so at the top of your root contract rather than letting the README imply
otherwise.

## Commands

| Command | What it does |
| --- | --- |
| `npm run gate` | Evaluate every coupling rule against the current change set |
| `npm run gate:plan -- <paths>` | What those paths will demand. Runs nothing. |
| `npm run contracts` | Rewrite the generated regions |
| `npm run contracts:check` | Fail if any of them disagrees with the code |
| `npm run invariants` | Enforce the claim ↔ test bijection |
| `npm run state` | Measure, store a snapshot, render the state page |
| `npm run verify` | All of the above, in order |

## What it does not do

It proves an invariant is *covered*, never that its test is any good — a test
that asserts nothing satisfies it happily. Closing that gap needs mutation
testing, which is not here yet. And `changed` remains a reminder no matter how it
is dressed up. Pretending otherwise is how a rule set turns into theatre.
