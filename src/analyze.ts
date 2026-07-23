import { analyzeFindings, recommendationsFor } from "./findings.js";
import { parseSession } from "./parser.js";
import { buildSessionReport } from "./report.js";
import type { SessionReport } from "./types.js";

export async function analyzeFile(
  file: string,
  options: { includeSnippets?: boolean } = {},
): Promise<SessionReport> {
  const session = await parseSession(file, options);
  const findings = analyzeFindings(session);
  return buildSessionReport(
    session,
    findings,
    recommendationsFor(findings),
  );
}
