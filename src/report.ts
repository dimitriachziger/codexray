import { basename } from "node:path";
import { persistentRecommendations } from "./findings.js";
import { redactHome } from "./redact.js";
import {
  SCHEMA_VERSION,
  type Accounting,
  type Confidence,
  type Finding,
  type InternalSession,
  type MultiSessionReport,
  type Recommendation,
  type SessionReport,
} from "./types.js";

function confidence(input: number, visible: number): Confidence {
  if (input === 0) return visible === 0 ? "high" : "low";
  const ratio = visible / input;
  if (ratio >= 0.7 && ratio <= 1.15) return "high";
  if (ratio >= 0.4 && ratio <= 1.35) return "medium";
  return "low";
}

export function buildSessionReport(
  session: InternalSession,
  findings: Finding[],
  recommendations: Recommendation[],
): SessionReport {
  const visible = session.steps.reduce((sum, step) => sum + step.visible_tokens, 0);
  const unattributed = session.steps.reduce(
    (sum, step) => sum + step.unattributed_input_tokens,
    0,
  );
  const overage = session.steps.reduce(
    (sum, step) => sum + step.visible_overage_tokens,
    0,
  );
  const input = session.accounting.input_tokens;
  const topItems = session.items
    .filter((item) => item.retained_context_load > 0)
    .sort((a, b) => b.retained_context_load - a.retained_context_load)
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      category: item.category,
      estimated_tokens: item.tokens,
      retained_steps: item.retained_steps,
      retained_context_load: item.retained_context_load,
      turn_id: item.turn_id,
      target: redactHome(item.target),
      ...(item.snippet ? { snippet: item.snippet } : {}),
    }));
  return {
    schema_version: SCHEMA_VERSION,
    session: {
      id: session.session_id,
      timestamp: session.timestamp,
      cli_version: session.cli_version,
      cwd: redactHome(session.cwd),
      rollout_file: basename(session.file),
      turns: session.accounting.turns,
      model_steps: session.accounting.model_steps,
    },
    accounting: session.accounting,
    coverage: {
      estimated_visible_input_tokens: visible,
      unattributed_input_tokens: unattributed,
      visible_overage_tokens: overage,
      ratio: input > 0 ? Math.min(1, visible / input) : 0,
      reconstruction_confidence: confidence(input, visible),
      encoding: session.encoding,
      encoding_fallback: session.encoding_fallback,
    },
    turns: session.turns.map((turn) => ({
      id: turn.id,
      model: turn.model,
      model_steps: turn.model_steps,
    })),
    top_retained_context: topItems,
    findings,
    recommendations,
    warnings: session.warnings,
  };
}

function emptyAccounting(): Accounting {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    model_steps: 0,
    turns: 0,
  };
}

export function buildMultiSessionReport(
  sessions: SessionReport[],
): MultiSessionReport {
  const accounting = emptyAccounting();
  let visible = 0;
  let unattributed = 0;
  let overage = 0;
  for (const report of sessions) {
    for (const key of [
      "input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "total_tokens",
      "model_steps",
      "turns",
    ] as const) {
      accounting[key] += report.accounting[key];
    }
    visible += report.coverage.estimated_visible_input_tokens;
    unattributed += report.coverage.unattributed_input_tokens;
    overage += report.coverage.visible_overage_tokens;
  }
  const findings = sessions.flatMap((report) =>
    report.findings.map((finding) => ({
      ...finding,
      id: `${report.session.id}:${finding.id}`,
    })),
  );
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    session_count: sessions.length,
    accounting,
    coverage: {
      estimated_visible_input_tokens: visible,
      unattributed_input_tokens: unattributed,
      visible_overage_tokens: overage,
      ratio:
        accounting.input_tokens > 0
          ? Math.min(1, visible / accounting.input_tokens)
          : 0,
      reconstruction_confidence: confidence(accounting.input_tokens, visible),
      encoding: [...new Set(sessions.map((report) => report.coverage.encoding))].join(","),
      encoding_fallback: sessions.some(
        (report) => report.coverage.encoding_fallback,
      ),
    },
    findings,
    recommendations: persistentRecommendations(sessions),
    warnings: sessions.flatMap((report) =>
      report.warnings.map((warning) => ({
        ...warning,
        message: `${report.session.id}: ${warning.message}`,
      })),
    ),
    sessions,
  };
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function renderSession(report: SessionReport): string {
  const lines = [
    `Session ${report.session.id}`,
    `  ${report.session.turns} turn(s), ${report.session.model_steps} model step(s)`,
    `  Input ${number(report.accounting.input_tokens)} (${number(report.accounting.cached_input_tokens)} cached), output ${number(report.accounting.output_tokens)}, reasoning ${number(report.accounting.reasoning_output_tokens)}`,
    `  Visible estimate ${number(report.coverage.estimated_visible_input_tokens)}; unattributed ${number(report.coverage.unattributed_input_tokens)}; coverage ${(report.coverage.ratio * 100).toFixed(1)}% (${report.coverage.reconstruction_confidence})`,
    `  Encoding ${report.coverage.encoding}${report.coverage.encoding_fallback ? " (fallback)" : ""}`,
  ];
  if (report.findings.length) {
    lines.push("  Findings:");
    for (const finding of report.findings.slice(0, 20)) {
      const load = finding.evidence.estimated_avoidable_context_load ?? 0;
      lines.push(
        `    - [${finding.confidence}] ${finding.message} Avoidable retained load: ~${number(load)} tokens.`,
      );
    }
  } else {
    lines.push("  Findings: none");
  }
  if (report.recommendations.length) {
    lines.push("  Recommendations:");
    for (const recommendation of report.recommendations) {
      lines.push(`    - ${recommendation.message}`);
    }
  }
  if (report.warnings.length) {
    lines.push(`  Warnings: ${report.warnings.length}`);
    for (const warning of report.warnings.slice(0, 5)) {
      lines.push(`    - ${warning.message}`);
    }
  }
  return lines.join("\n");
}

export function renderMulti(report: MultiSessionReport): string {
  const sections = report.sessions.map(renderSession);
  sections.push(
    [
      `Aggregate: ${report.session_count} session(s), ${number(report.accounting.input_tokens)} input tokens, ${(report.coverage.ratio * 100).toFixed(1)}% visible coverage.`,
      report.recommendations.length
        ? `Persistent AGENTS.md candidates (${report.recommendations.length}):\n${report.recommendations.map((item) => `  - ${item.message}`).join("\n")}`
        : "Persistent AGENTS.md candidates: none (requires the same pattern in at least 3 sessions).",
    ].join("\n"),
  );
  return sections.join("\n\n");
}
