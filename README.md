# Codex Token Analyzer

Offline token accounting and visible-context diagnostics for local Codex CLI rollout files.

The analyzer deliberately separates:

- **Exact accounting:** every non-empty `last_token_usage` model step, including input, cached input, cache-write input, output, and reasoning-output tokens.
- **Estimated attribution:** locally tokenizable instructions, messages, tool calls, and tool outputs.
- **Diagnostics:** large outputs, duplicate or overlapping reads, retained context load, and evidence-backed workflow recommendations.

It makes no network calls, installs no hooks, and never changes `AGENTS.md`. Standard output contains no prompt, command, or tool-output text. Home directories are redacted. Bounded snippets require explicit `--include-snippets`.

## Requirements and setup

Node.js 20 or newer:

```sh
npm install
npm run build
npm link
```

`gpt-tokenizer` is the only runtime dependency.

## Commands

```sh
codex-token-analyzer doctor
codex-token-analyzer analyze --latest
codex-token-analyzer analyze --session <id>
codex-token-analyzer analyze --last 20
```

Every analyze command accepts `--json` and `--include-snippets`. The latter is the only mode that may include short raw excerpts. For a nonstandard rollout location, use `--sessions-dir <path>` or `CODEX_SESSIONS_DIR`.

`doctor` checks the currently available rollout schema instead of assuming that all Codex CLI versions or session modes emit the same events.

## Reading a report

`accounting` is the sum of non-empty `last_token_usage` events; reasoning tokens are displayed as a subset of output and are never added twice. Each token event closes one `ModelStep`, grouped by `turn_context.turn_id`.

`coverage` compares exact input tokens with the locally tokenizable active context. The report exposes the visible estimate, unattributed remainder, any visible overage, and reconstruction confidence. Tool schemas, serialization overhead, encrypted reasoning context, and other unlogged request material can remain unattributed.

`retained_context_load` is `item tokens × later model steps in which the item remains active`. Cached input is reported separately and is not subtracted from context load. A `compacted.replacement_history` event replaces the active visible history; zero usage after compaction is treated as a reset marker.

Duplicate confidence is high for identical normalized output hashes and medium for the same read target or at least 80% normalized-line overlap on outputs of 500 estimated tokens or more. An intervening mutation lowers confidence. Outputs at 2,000 and 10,000 estimated tokens are marked large and very large.

Per-session recommendations are immediate. Candidate `AGENTS.md` rules appear only when the same pattern occurs in at least three distinct sessions among the latest 20 analyzed sessions.

## JSON

The versioned JSON uses `schema_version: "1.0.0"` and exposes `accounting`, `coverage`, `findings`, `recommendations`, and `warnings`. Multi-session output adds aggregate values plus individual redacted session reports. The machine-readable contract is in [`schemas/report.schema.json`](schemas/report.schema.json).

## Skill

[`skill/explain-codex-token-usage`](skill/explain-codex-token-usage/SKILL.md) is a thin Codex skill. It invokes the CLI and explains only the redacted JSON; it does not read rollout files itself.

## Development

```sh
npm test
```

The tests cover exact accounting, cached and reasoning tokens, both tool-call formats, compaction and resets, interrupted and malformed sessions, privacy opt-in, exact and similar duplicates, mutation confidence, and large single records.
