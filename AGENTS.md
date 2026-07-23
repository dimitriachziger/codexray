# Global Working Guidelines

## Efficient Workflow

- Start with targeted `rg` searches for the requested feature, symbols, imports, and
  references. Read only the relevant files and line ranges; broaden the search only
  when a concrete uncertainty remains. Before potentially broad output, inspect file
  names or counts and cap matches and line ranges. Treat truncated output as unusable
  and narrow the query instead of increasing the output limit.
- Check the current implementation and `git diff` before editing. Reuse nearby project
  patterns and make the smallest coherent change; avoid unrelated refactors, formatting,
  cleanup, and dependency changes.
- Stop exploring once there is enough evidence to implement and verify one primary
  approach. Do not repeatedly reread unchanged files or restate established findings.
- Verify from narrow to broad: affected test, affected module/package tests, relevant
  lint or type checks, then the full suite only when the change or risk justifies it.
  Do not rerun an unchanged successful command without a concrete reason.
- Keep command output and handoffs concise. Prefer filtered failure output and file
  references over complete generated files, large diffs, or repeated summaries. Avoid
  batching multiple large file reads into one tool call.
- For web and other high-volume tools, request the smallest useful response and expand
  only to resolve a concrete remaining uncertainty.
- After two failed implementation or verification attempts, reassess assumptions and
  the chosen approach before trying further variants.

## Documentation

- Record only stable, repository-specific, reusable findings; do not add generic advice,
  task history, token counts, or temporary failures.
