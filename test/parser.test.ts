import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { analyzeFile } from "../src/analyze.js";
import { parseSession } from "../src/parser.js";

const fixtures = join(process.cwd(), "test", "fixtures");

test("sums every non-empty last_token_usage exactly without double-counting reasoning", async () => {
  const session = await parseSession(join(fixtures, "complex.jsonl"));
  assert.equal(session.accounting.model_steps, 3);
  assert.equal(session.accounting.turns, 2);
  assert.equal(session.accounting.input_tokens, 600);
  assert.equal(session.accounting.cached_input_tokens, 325);
  assert.equal(session.accounting.cache_write_input_tokens, 5);
  assert.equal(session.accounting.output_tokens, 120);
  assert.equal(session.accounting.reasoning_output_tokens, 42);
  assert.equal(session.accounting.total_tokens, 720);
  assert.equal(session.reset_markers, 1);
  assert.equal(session.compacted_events, 1);
  assert.equal(session.malformed_lines, 1);
  assert.ok(Object.values(session.accounting).every((value) => value >= 0));
});

test("links both tool call formats and retires pre-compaction context", async () => {
  const session = await parseSession(join(fixtures, "complex.jsonl"));
  const outputs = session.items.filter((item) => item.category === "tool_output");
  assert.equal(outputs.length, 3);
  assert.equal(outputs[0]?.target, "~/secret-workspace/src/a.ts");
  assert.equal(outputs[1]?.target, "~/secret-workspace/src/b.ts");
  assert.equal(outputs[0]?.available_from_step, 1);
  assert.ok(
    session.items.some(
      (item) => item.retired_at_step === 2 && item.category === "tool_output",
    ),
  );
  const replacement = session.items.find(
    (item) => item.category === "instructions" && item.available_from_step === 2,
  );
  assert.ok(replacement);
});

test("reports missing token events and an unknown-model encoding fallback", async () => {
  const session = await parseSession(join(fixtures, "aborted.jsonl"));
  assert.equal(session.accounting.model_steps, 0);
  assert.equal(session.encoding, "o200k_base");
  assert.equal(session.encoding_fallback, true);
  assert.ok(session.warnings.some((warning) => warning.code === "missing_token_events"));
  assert.ok(session.warnings.some((warning) => warning.code === "turn_without_token_count"));
});

test("standard JSON contains no raw prompt, command, output, or home directory", async () => {
  const report = await analyzeFile(join(fixtures, "complex.jsonl"));
  const json = JSON.stringify(report);
  assert.equal(json.includes("SECRET_USER_TEXT"), false);
  assert.equal(json.includes("SECRET_TOOL_OUTPUT"), false);
  assert.equal(json.includes("sed -n"), false);
  assert.equal(json.includes("/home/example"), false);
  assert.ok(json.includes("~/secret-workspace"));
  assert.ok(report.coverage.unattributed_input_tokens >= 0);
  assert.ok(report.turns.every((turn) =>
    turn.model_steps.every((step) => step.reconstruction_confidence)));
});

test("snippets are included only after explicit opt-in and stay bounded", async () => {
  const report = await analyzeFile(join(fixtures, "complex.jsonl"), {
    includeSnippets: true,
  });
  const json = JSON.stringify(report);
  assert.ok(json.includes("SECRET_TOOL_OUTPUT"));
  assert.ok(
    report.top_retained_context.every(
      (item) => item.snippet === undefined || item.snippet.length <= 160,
    ),
  );
});
