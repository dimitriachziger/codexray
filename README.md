# Codexray — Codex Token Analyzer

[![CI](https://github.com/dimitriachziger/codexray/actions/workflows/ci.yml/badge.svg)](https://github.com/dimitriachziger/codexray/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Codexray is an offline token-accounting and visible-context diagnostic tool for
local Codex CLI rollout files. It reports exact recorded usage separately from
estimated attribution and flags expensive context patterns such as repeated or
very large tool output.

It makes no network calls, installs no hooks, and never changes `AGENTS.md`.

## Quickstart

Codexray supports maintained Node.js releases 22 and 24.

```sh
git clone https://github.com/dimitriachziger/codexray.git
cd codexray
npm ci
npm test
npm link
codex-token-analyzer skill install
codex-token-analyzer doctor
codex-token-analyzer analyze --latest
```

`gpt-tokenizer` is the only runtime dependency. Run
`npm unlink --global codex-token-analyzer` when you no longer want the linked
development command. The skill installer copies the bundled skill to
`~/.agents/skills/explain-codex-token-usage`, where Codex can use it in every
repository. It refuses to replace an existing installation unless you pass
`--force`.

Example output:

```text
Session 0198-example
  3 turn(s), 4 model step(s)
  Input 42,180 (30,400 cached), output 2,105, reasoning 820
  Visible estimate 31,702; unattributed 10,478; coverage 75.2% (high)
  Encoding o200k_base
  Findings:
    - [high] The same normalized output for ~/project/src/app.ts appeared 2 times. Avoidable retained load: ~3,840 tokens.
```

## Commands

```sh
codex-token-analyzer --help
codex-token-analyzer --version
codex-token-analyzer doctor
codex-token-analyzer skill install
codex-token-analyzer analyze --latest
codex-token-analyzer analyze --session <id>
codex-token-analyzer analyze --last 20
codex-token-analyzer analyze --last 20 --summary-json --exclude-current
```

Every `analyze` selector accepts `--json` for the unchanged full report or
`--summary-json` for a minified, bounded machine-readable report.
`--summary-json` cannot be combined with `--json` or `--include-snippets`.
For a nonstandard rollout location, use `--sessions-dir <path>` or
`CODEX_SESSIONS_DIR`.

`--exclude-current` is available only with `--last` and requires
`CODEX_THREAD_ID`. The matching rollout is removed before the requested limit
is applied, so `--last 20` can still return 20 historical sessions. The summary
records whether the current session was found and excluded. Run subcommand help
for the complete option list:

```sh
codex-token-analyzer analyze --help
codex-token-analyzer doctor --help
```

`doctor` checks the currently available rollout schema instead of assuming that
all Codex CLI versions or session modes emit the same events.

## Reading a report

- **Exact accounting** sums every non-empty `last_token_usage` model step,
  including input, cached input, cache-write input, output, and reasoning-output
  tokens. Reasoning is a subset of output and is not added twice.
- **Estimated attribution** locally tokenizes visible instructions, messages,
  tool calls, and tool outputs.
- **Retained context load** is `item tokens × later model steps in which the
  item remains active`. Cached input is reported separately and is not
  subtracted from this estimate.
- **Coverage** compares exact input tokens with locally reconstructable active
  context and exposes unattributed input, visible overage, and confidence.

A `compacted.replacement_history` event replaces active visible history. Zero
usage after compaction is treated as a reset marker. Duplicate confidence is
high for identical normalized output hashes and medium for the same target or
at least 80% normalized-line overlap on outputs of 500 estimated tokens or
more. An intervening mutation lowers confidence.

Per-session recommendations are immediate. Candidate `AGENTS.md` rules appear
only when the same pattern occurs in at least three distinct sessions among the
latest 20 analyzed sessions.

## Privacy boundaries

Standard output contains no prompt, command, or tool-output text. Linux, macOS,
and Windows home-directory prefixes are redacted from public paths. Short raw
excerpts are included only with the explicit `--include-snippets` opt-in and
are bounded to 160 characters after whitespace normalization and path
redaction.

Codexray still reads sensitive rollout files locally, and reports can reveal
session identifiers, timestamps, models, filenames, token counts, and
redacted-path structure. Snippet mode can expose source text or secrets; do not
enable it for reports you plan to share without reviewing the output. No
redaction method can infer every custom secret or nonstandard home path.

## Rollout compatibility

Codex rollout JSONL is not a stable public interchange format. Codexray
recognizes the event shapes covered by its fixtures, including
`last_token_usage`, both supported tool-call forms, turn contexts, and
compaction replacement history. Ephemeral sessions with no rollout cannot be
analyzed. Unknown events are ignored and reported as warnings; missing token
events prevent exact accounting. Run `doctor` after upgrading Codex CLI or
changing session modes.

Tool schemas, serialization overhead, encrypted reasoning context, and other
unlogged request material can remain unattributed. Findings are diagnostic
estimates, not billing data.

## JSON contract

JSON reports use `schema_version: "1.0.0"`. Full `--json` retains the existing
single- and multi-session structures, including turns, model steps, findings,
and session lists. The `report_kind: "summary"` variant contains aggregate
accounting and coverage, visible categories, grouped finding counts,
recommendations, bounded warnings, and at most five costliest sessions and
retained-context examples. It contains no turns, model steps, complete findings,
snippets, or unbounded session list. The strict public contract for all variants
is
[`schemas/report.schema.json`](schemas/report.schema.json). Reports generated by
the test fixtures are validated against that schema in CI.

## Skill

[`.agents/skills/explain-codex-token-usage`](.agents/skills/explain-codex-token-usage/SKILL.md)
is a thin Codex skill. It invokes the CLI once in summary mode and explains only
the redacted JSON; for recent-session analysis it excludes the active Codex
thread. It does not read rollout files itself. Codex discovers it automatically
while working in this repository. Run `codex-token-analyzer skill install` to
make it available user-wide under `~/.agents/skills`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and strict
fixture-redaction rules. Report privacy or security issues privately as
described in [SECURITY.md](SECURITY.md). Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

Codexray is licensed under the [MIT License](LICENSE).
