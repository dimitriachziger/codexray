---
name: explain-codex-token-usage
description: Analyze and explain Codex CLI session token usage through the codex-token-analyzer redacted JSON interface. Use when a user asks where Codex tokens went, which context or tool outputs were costly, whether reads were duplicated, how compaction affected reconstruction, or which recurring workflow rule may be worth adding to AGENTS.md.
---

# Explain Codex Token Usage

Use the analyzer as the only source of session data. Do not open rollout JSONL files directly.

## Analyze

Run the analyzer exactly once with the selector the user requested:

- latest session: `codex-token-analyzer analyze --latest --summary-json`
- one session: `codex-token-analyzer analyze --session <id> --summary-json`
- recent sessions: `codex-token-analyzer analyze --last <1-20> --summary-json --exclude-current`

Do not request full JSON or make repeated analyzer calls. Omit snippets unless
the user explicitly asks for them and accepts that snippet output requires a
full, non-summary report. If the binary is unavailable in the analyzer
repository, build it first and then run `node dist/src/cli.js` exactly once with
the same analyze arguments.

## Explain

Keep the analyzer's three evidence levels separate:

- Treat `accounting` as exact per-model-step usage. Cached input remains part of context processing, and reasoning output is already included in output tokens.
- Treat `coverage`, item tokens, and retained context load as local estimates. State the unattributed remainder and reconstruction confidence; do not imply complete API-request reconstruction.
- Treat `findings` and `recommendations` as diagnostics supported by their evidence and confidence.

Lead with the largest actionable finding. Then summarize exact accounting,
visible coverage and categories, the bounded top retained-context examples,
finding counts, and warnings. Explain compaction or missing token events when
warning examples identify them.

Never turn cache ratios into claimed context savings. Never recommend lowering reasoning effort solely from token ratios. Never claim an instruction is unused because the assistant did not mention it.

For multi-session reports, describe an `agents_rule_candidate` only when the analyzer emitted it after the three-distinct-session threshold. Present it as a proposal and never edit AGENTS.md without a separate explicit request.

Do not reproduce snippets in the explanation unless they were explicitly requested and materially support the answer.
