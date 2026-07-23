# Global Working Guidelines

## Efficient Workflow

- Start with targeted `rg` searches for the requested feature, symbols, imports, and
  references. Treat 2,000 estimated tokens or 200 lines as a hard default ceiling for
  any single tool result. Before a command could exceed either limit, inspect counts
  or filenames first, then split the read into the smallest relevant ranges. Do not
  print complete files, broad diffs, recursive listings, unfiltered logs, or full JSON
  when a bounded `rg`, `sed`, path-scoped diff, failure filter, or `jq` projection can
  answer the question. If output is truncated, discard it and narrow the query; never
  raise the output limit merely to capture the same broad result.
- Check the current implementation and `git diff` before editing. Reuse nearby project
  patterns and make the smallest coherent change; avoid unrelated refactors, formatting,
  cleanup, and dependency changes.
- Stop exploring once there is enough evidence to implement and verify one primary
  approach. Read each unchanged file region or tool result at most once. Reread only
  after a relevant mutation or to answer a concrete unresolved question, and read the
  smallest range that can answer it. Do not restate established findings.
- Verify from narrow to broad: affected test, affected module/package tests, relevant
  lint or type checks, then the full suite only when the change or risk justifies it.
  Do not rerun an unchanged successful command without a concrete reason.
- Keep command output and handoffs concise. Prefer filtered failure output and file
  references over generated content, diffs, or repeated summaries. Never batch
  unrelated file reads or commands when their combined output could cross the
  single-result ceiling.
- For web and other high-volume tools, request the smallest useful response and expand
  only to resolve a concrete remaining uncertainty.
- After two failed implementation or verification attempts, reassess assumptions and
  the chosen approach before trying further variants.

## Documentation

- Record only stable, repository-specific, reusable findings; do not add generic advice,
  task history, token counts, or temporary failures.
