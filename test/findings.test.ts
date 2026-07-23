import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeFile } from "../src/analyze.js";
import { persistentRecommendations } from "../src/findings.js";

function record(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: "2026-07-23T00:00:00Z", type, payload });
}

async function duplicateFixture(options: {
  id: string;
  mutate?: boolean;
  similar?: boolean;
  large?: boolean;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-analyzer-test-"));
  const file = join(directory, `rollout-${options.id}.jsonl`);
  const sharedLines = Array.from(
    { length: options.large ? 3_000 : 900 },
    (_, index) => `shared line ${index}`,
  );
  const firstOutput = sharedLines.join("\n");
  const secondOutput = options.similar
    ? [...sharedLines.slice(0, 850), "different tail"].join("\n")
    : firstOutput;
  const records = [
    record("session_meta", {
      id: options.id,
      cwd: "/tmp/project",
      base_instructions: { text: "rules" },
    }),
    record("turn_context", { turn_id: "turn-1", model: "gpt-5.2-codex" }),
    record("response_item", {
      type: "function_call",
      name: "functions.exec_command",
      arguments: JSON.stringify({ cmd: "cat src/large.ts" }),
      call_id: "read-1",
    }),
    record("response_item", {
      type: "function_call_output",
      call_id: "read-1",
      output: firstOutput,
    }),
    record("event_msg", {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 2,
          total_tokens: 110,
        },
      },
    }),
  ];
  if (options.mutate) {
    records.push(
      record("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch\n*** Update File: src/large.ts\n*** End Patch",
        call_id: "patch-1",
      }),
      record("response_item", {
        type: "custom_tool_call_output",
        call_id: "patch-1",
        output: "Done!",
      }),
      record("event_msg", {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 1000,
            output_tokens: 10,
            reasoning_output_tokens: 2,
            total_tokens: 5010,
          },
        },
      }),
    );
  }
  records.push(
    record("response_item", {
      type: "function_call",
      name: "functions.exec_command",
      arguments: JSON.stringify({ cmd: "sed -n '1,900p' src/large.ts" }),
      call_id: "read-2",
    }),
    record("response_item", {
      type: "function_call_output",
      call_id: "read-2",
      output: secondOutput,
    }),
    record("event_msg", {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 8000,
          cached_input_tokens: 3000,
          output_tokens: 10,
          reasoning_output_tokens: 2,
          total_tokens: 8010,
        },
      },
    }),
    record("response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
    }),
    record("event_msg", {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 12000,
          cached_input_tokens: 5000,
          output_tokens: 10,
          reasoning_output_tokens: 2,
          total_tokens: 12010,
        },
      },
    }),
  );
  await writeFile(file, `${records.join("\n")}\n`);
  return file;
}

test("detects exact duplicates and lowers confidence across a mutation", async () => {
  const report = await analyzeFile(
    await duplicateFixture({ id: "mutated", mutate: true }),
  );
  const duplicate = report.findings.find(
    (finding) => finding.kind === "duplicate_output",
  );
  assert.ok(duplicate);
  assert.equal(duplicate.confidence, "medium");
  assert.equal(duplicate.evidence.mutation_between_reads, true);
  assert.ok((duplicate.evidence.estimated_avoidable_context_load ?? 0) > 0);
});

test("detects similar outputs at 80% line overlap and large output thresholds", async () => {
  const report = await analyzeFile(
    await duplicateFixture({ id: "similar-large", similar: true, large: true }),
  );
  assert.ok(report.findings.some((finding) => finding.kind === "similar_output"));
  assert.ok(report.findings.some((finding) => finding.kind === "large_output"));
});

test("offers persistent AGENTS.md candidates only after three distinct sessions", async () => {
  const reports = await Promise.all([
    analyzeFile(await duplicateFixture({ id: "session-1" })),
    analyzeFile(await duplicateFixture({ id: "session-2" })),
    analyzeFile(await duplicateFixture({ id: "session-3" })),
  ]);
  assert.equal(persistentRecommendations(reports.slice(0, 2)).length, 0);
  assert.ok(
    persistentRecommendations(reports).some(
      (recommendation) => recommendation.kind === "agents_rule_candidate",
    ),
  );
  assert.equal(
    persistentRecommendations([reports[0]!, reports[0]!, reports[1]!]).length,
    0,
  );
});
