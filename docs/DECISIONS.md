# Decisions

One decision per entry, shortest form that survives being read by someone who
was not there. This file exists so no agent re-litigates a question that has
already been settled — if a decision is not written here, the next session will
reopen it.

## Dependencies

Every dependency added to `package.json` needs a line here saying why, because
each one is surface that no human is going to audit.

- **`yaml`** — the manifest is read and written by agents, and YAML tolerates
  comments. The manifest is also the schema reference, and a reference with no
  room for explanation is a worse reference.

## Conventions

- **Invariant ids live at the front of a test's title**, not in a comment in its
  body. Finding the enclosing test of a comment required scanning source, which
  broke on `describe()` and on brackets inside strings. In a title the id travels
  in the test runner's own output and nothing has to be parsed.
- **Gates run in CI on pull requests, never in local hooks.** `--no-verify` is a
  native git flag that no hook manager can block or detect.
- **Dead rules are errors, not warnings.** A warning that never blocks is the
  same theatre as a `changed` requirement presented as a gate.
