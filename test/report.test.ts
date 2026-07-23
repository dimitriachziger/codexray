import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { analyzeFile } from "../src/analyze.js";
import { buildSummaryReport } from "../src/report.js";
import type { Confidence, Finding, SessionReport } from "../src/types.js";

const fixture = join(process.cwd(), "test", "fixtures", "complex.jsonl");

test("summary aggregation bounds and sorts high-volume report details", async () => {
  const base = await analyzeFile(fixture, { includeSnippets: true });
  const kinds: Finding["kind"][] = [
    "duplicate_output",
    "similar_output",
    "large_output",
  ];
  const confidences: Confidence[] = ["high", "medium", "low"];
  const reports: SessionReport[] = Array.from({ length: 6 }, (_, index) => {
    const report = structuredClone(base);
    report.session.id = `session-${index}`;
    report.accounting.input_tokens = (index + 1) * 100;
    report.accounting.output_tokens = index + 1;
    report.accounting.total_tokens = (index + 1) * 101;
    report.findings = [
      {
        ...report.findings[0]!,
        id: `finding-${index}`,
        kind: kinds[index % kinds.length]!,
        confidence: confidences[index % confidences.length]!,
      },
    ];
    report.warnings = [
      { code: `warning-${index}`, message: `warning ${index}` },
    ];
    report.top_retained_context = [
      {
        id: `item-${index}`,
        category: "tool_output",
        estimated_tokens: index + 10,
        retained_steps: 2,
        retained_context_load: (index + 1) * 1_000,
        snippet: "summary must remove this",
      },
    ];
    return report;
  });

  const summary = buildSummaryReport(reports);
  assert.equal(
    summary.accounting.input_tokens,
    reports.reduce((sum, report) => sum + report.accounting.input_tokens, 0),
  );
  assert.equal(
    summary.coverage.unattributed_input_tokens,
    reports.reduce(
      (sum, report) => sum + report.coverage.unattributed_input_tokens,
      0,
    ),
  );
  assert.equal(
    Object.values(summary.visible_by_category).reduce(
      (sum, tokens) => sum + tokens,
      0,
    ),
    summary.coverage.estimated_visible_input_tokens,
  );
  assert.deepEqual(summary.findings, {
    total: 6,
    by_kind: {
      duplicate_output: 2,
      similar_output: 2,
      large_output: 2,
    },
    by_confidence: { high: 2, medium: 2, low: 2 },
  });
  assert.ok(
    summary.recommendations.some(
      (recommendation) => recommendation.kind === "agents_rule_candidate",
    ),
  );
  assert.equal(summary.warnings.count, 6);
  assert.equal(summary.warnings.examples.length, 5);
  assert.deepEqual(
    summary.top_costliest_sessions.map((session) => session.session_id),
    ["session-5", "session-4", "session-3", "session-2", "session-1"],
  );
  assert.deepEqual(
    summary.top_retained_context.map((item) => item.session_id),
    ["session-5", "session-4", "session-3", "session-2", "session-1"],
  );
  assert.ok(
    summary.top_retained_context.every(
      (item) => !("snippet" in item),
    ),
  );
});
