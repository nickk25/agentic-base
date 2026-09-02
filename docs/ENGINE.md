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

## Unreleased

- First version: four obligation kinds, captured patterns, plan mode.
