import type {
  Confidence,
  Finding,
  InternalContextItem,
  InternalSession,
  Recommendation,
  SessionReport,
} from "./types.js";

function mutationBetween(
  items: InternalContextItem[],
  first: InternalContextItem,
  second: InternalContextItem,
): boolean {
  return items.some(
    (item) =>
      item.operation === "mutation" &&
      item.sequence > first.sequence &&
      item.sequence < second.sequence &&
      (!item.target || !first.target || item.target === first.target),
  );
}

function lowerConfidence(confidence: Confidence): Confidence {
  return confidence === "high" ? "medium" : "low";
}

function lineOverlap(first: InternalContextItem, second: InternalContextItem): number {
  if (!first.line_hashes?.length || !second.line_hashes?.length) return 0;
  const right = new Set(second.line_hashes);
  let intersection = 0;
  for (const hash of first.line_hashes) {
    if (right.has(hash)) intersection += 1;
  }
  return intersection / Math.min(first.line_hashes.length, second.line_hashes.length);
}

function duplicateFindings(session: InternalSession): Finding[] {
  const outputs = session.items.filter(
    (item) => item.category === "tool_output" && item.tokens > 0,
  );
  const findings: Finding[] = [];
  const exactGroups = new Map<string, InternalContextItem[]>();
  for (const output of outputs) {
    if (!output.normalized_hash) continue;
    const group = exactGroups.get(output.normalized_hash) ?? [];
    group.push(output);
    exactGroups.set(output.normalized_hash, group);
  }

  let exactIndex = 0;
  const exactPairs = new Set<string>();
  for (const group of exactGroups.values()) {
    if (group.length < 2) continue;
    exactIndex += 1;
    const sorted = group.sort((a, b) => a.sequence - b.sequence);
    let mutated = false;
    for (let index = 1; index < sorted.length; index += 1) {
      const first = sorted[index - 1]!;
      const second = sorted[index]!;
      if (mutationBetween(session.items, first, second)) mutated = true;
      exactPairs.add([first.id, second.id].sort().join(":"));
    }
    const confidence: Confidence = mutated ? "medium" : "high";
    const avoidable = sorted
      .slice(1)
      .reduce((sum, item) => sum + item.retained_context_load, 0);
    const target = sorted.find((item) => item.target)?.target;
    findings.push({
      id: `duplicate-output-${exactIndex}`,
      kind: "duplicate_output",
      severity: "warning",
      confidence,
      evidence: {
        occurrences: sorted.length,
        target,
        estimated_tokens_each: sorted.map((item) => item.tokens),
        estimated_avoidable_context_load: avoidable,
        mutation_between_reads: mutated,
        snippet: sorted[0]?.snippet,
      },
      message: target
        ? `The same normalized output for ${target} appeared ${sorted.length} times.`
        : `The same normalized tool output appeared ${sorted.length} times.`,
    });
  }

  let similarIndex = 0;
  const largeEnough = outputs.filter((item) => item.tokens >= 500);
  for (let leftIndex = 0; leftIndex < largeEnough.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < largeEnough.length;
      rightIndex += 1
    ) {
      if (findings.length >= 100) return findings;
      const first = largeEnough[leftIndex]!;
      const second = largeEnough[rightIndex]!;
      if (first.normalized_hash === second.normalized_hash) continue;
      if (exactPairs.has([first.id, second.id].sort().join(":"))) continue;
      const overlap = lineOverlap(first, second);
      const sameTarget = Boolean(first.target && first.target === second.target);
      if (!sameTarget && overlap < 0.8) continue;
      similarIndex += 1;
      const mutated = mutationBetween(session.items, first, second);
      const confidence: Confidence = mutated ? lowerConfidence("medium") : "medium";
      findings.push({
        id: `similar-output-${similarIndex}`,
        kind: "similar_output",
        severity: "warning",
        confidence,
        evidence: {
          occurrences: 2,
          target: sameTarget ? first.target : undefined,
          estimated_tokens_each: [first.tokens, second.tokens],
          estimated_avoidable_context_load: second.retained_context_load,
          overlap_ratio: overlap,
          mutation_between_reads: mutated,
          snippet: first.snippet,
        },
        message: sameTarget
          ? `Two large reads targeted ${first.target}.`
          : `Two large tool outputs shared ${Math.round(overlap * 100)}% of normalized lines.`,
      });
    }
  }
  return findings;
}

function largeOutputFindings(session: InternalSession): Finding[] {
  return session.items
    .filter((item) => item.category === "tool_output" && item.tokens >= 2_000)
    .map((item, index) => ({
      id: `large-output-${index + 1}`,
      kind: "large_output" as const,
      severity: "warning" as const,
      confidence: "high" as const,
      evidence: {
        occurrences: 1,
        target: item.target,
        estimated_tokens_each: [item.tokens],
        estimated_avoidable_context_load: item.retained_context_load,
        snippet: item.snippet,
      },
      message:
        item.tokens >= 10_000
          ? `A very large tool output was estimated at ${item.tokens} visible tokens.`
          : `A large tool output was estimated at ${item.tokens} visible tokens.`,
    }));
}

export function analyzeFindings(session: InternalSession): Finding[] {
  return [...largeOutputFindings(session), ...duplicateFindings(session)];
}

export function recommendationsFor(findings: Finding[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const duplicate = findings.filter(
    (finding) =>
      finding.kind === "duplicate_output" || finding.kind === "similar_output",
  );
  if (duplicate.length) {
    recommendations.push({
      id: "targeted-reads",
      kind: "workflow",
      confidence: duplicate.some((finding) => finding.confidence === "high")
        ? "high"
        : "medium",
      evidence: `${duplicate.length} duplicate or overlapping read pattern(s).`,
      estimated_avoidable_context_load: duplicate.reduce(
        (sum, finding) =>
          sum + (finding.evidence.estimated_avoidable_context_load ?? 0),
        0,
      ),
      message:
        "Use targeted rg matches and bounded line ranges before reading complete files; reread after mutations only when verification needs it.",
    });
  }
  const large = findings.filter((finding) => finding.kind === "large_output");
  if (large.length) {
    recommendations.push({
      id: "bound-tool-output",
      kind: "workflow",
      confidence: "high",
      evidence: `${large.length} tool output(s) exceeded 2,000 estimated visible tokens.`,
      estimated_avoidable_context_load: large.reduce(
        (sum, finding) =>
          sum + (finding.evidence.estimated_avoidable_context_load ?? 0),
        0,
      ),
      message:
        "Cap broad command output, inspect filenames or match counts first, and narrow the query before printing large content.",
    });
  }
  return recommendations;
}

export function persistentRecommendations(
  reports: SessionReport[],
): Recommendation[] {
  const seen = new Set<string>();
  const recent = reports
    .filter((report) => {
      if (seen.has(report.session.id)) return false;
      seen.add(report.session.id);
      return true;
    })
    .slice(0, 20);
  const duplicateSessions = recent.filter((report) =>
    report.findings.some(
      (finding) =>
        finding.kind === "duplicate_output" || finding.kind === "similar_output",
    ),
  );
  const largeSessions = recent.filter((report) =>
    report.findings.some((finding) => finding.kind === "large_output"),
  );
  const recommendations: Recommendation[] = [];
  if (duplicateSessions.length >= 3) {
    recommendations.push({
      id: "agents-targeted-reads",
      kind: "agents_rule_candidate",
      confidence: "high",
      session_count: duplicateSessions.length,
      evidence: `Duplicate or overlapping reads occurred in ${duplicateSessions.length} of the last ${recent.length} analyzed sessions.`,
      estimated_avoidable_context_load: duplicateSessions.reduce(
        (sum, report) =>
          sum +
          report.findings.reduce(
            (inner, finding) =>
              inner +
              (finding.kind === "duplicate_output" ||
              finding.kind === "similar_output"
                ? finding.evidence.estimated_avoidable_context_load ?? 0
                : 0),
            0,
          ),
        0,
      ),
      message:
        "Candidate AGENTS.md rule: start with targeted rg searches and bounded line ranges; avoid rereading unchanged large regions.",
    });
  }
  if (largeSessions.length >= 3) {
    recommendations.push({
      id: "agents-bound-output",
      kind: "agents_rule_candidate",
      confidence: "high",
      session_count: largeSessions.length,
      evidence: `Large outputs occurred in ${largeSessions.length} of the last ${recent.length} analyzed sessions.`,
      estimated_avoidable_context_load: largeSessions.reduce(
        (sum, report) =>
          sum +
          report.findings.reduce(
            (inner, finding) =>
              inner +
              (finding.kind === "large_output"
                ? finding.evidence.estimated_avoidable_context_load ?? 0
                : 0),
            0,
          ),
        0,
      ),
      message:
        "Candidate AGENTS.md rule: cap potentially broad command output and narrow searches after inspecting counts or filenames.",
    });
  }
  return recommendations;
}
