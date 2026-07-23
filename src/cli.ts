#!/usr/bin/env node
import { analyzeFile } from "./analyze.js";
import { defaultSessionsDirectory, selectRollouts } from "./discovery.js";
import { doctor } from "./doctor.js";
import {
  buildMultiSessionReport,
  renderMulti,
  renderSession,
} from "./report.js";

interface CliOptions {
  command?: "analyze" | "doctor";
  latest?: boolean;
  session?: string;
  last?: number;
  json?: boolean;
  includeSnippets?: boolean;
  sessionsDirectory?: string;
}

const HELP = `codex-token-analyzer

Usage:
  codex-token-analyzer analyze --latest [--json] [--include-snippets]
  codex-token-analyzer analyze --session <id> [--json] [--include-snippets]
  codex-token-analyzer analyze --last <count> [--json] [--include-snippets]
  codex-token-analyzer doctor [--json]

Options:
  --sessions-dir <path>  Override the Codex sessions directory.
  --include-snippets     Include bounded, redacted raw snippets (explicit opt-in).
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const command = argv.shift();
  if (command === "analyze" || command === "doctor") options.command = command;
  else if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(HELP);
    process.exit(0);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  while (argv.length) {
    const argument = argv.shift()!;
    if (argument === "--latest") options.latest = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--include-snippets") options.includeSnippets = true;
    else if (argument === "--session") {
      const value = argv.shift();
      if (!value) throw new Error("--session requires an id.");
      options.session = value;
    } else if (argument === "--last") {
      const value = Number(argv.shift());
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new Error("--last must be an integer between 1 and 20.");
      }
      options.last = value;
    } else if (argument === "--sessions-dir") {
      const value = argv.shift();
      if (!value) throw new Error("--sessions-dir requires a path.");
      options.sessionsDirectory = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sessionsDirectory =
    options.sessionsDirectory ?? defaultSessionsDirectory();
  if (options.command === "doctor") {
    const result = await doctor(sessionsDirectory);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          `Doctor: ${result.ok ? "ready" : "not ready"}`,
          `Node: ${result.node_version}`,
          `Rollouts: ${result.rollout_count}`,
          `Capabilities: ${Object.entries(result.capabilities)
            .filter(([, enabled]) => enabled)
            .map(([name]) => name)
            .join(", ") || "none"}`,
          ...result.warnings.map((warning) => `Warning: ${warning}`),
        ].join("\n") + "\n",
      );
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const selectors = [options.latest, options.session !== undefined, options.last !== undefined]
    .filter(Boolean).length;
  if (selectors !== 1) {
    throw new Error("Choose exactly one of --latest, --session <id>, or --last <count>.");
  }
  const files = await selectRollouts({
    latest: options.latest,
    session: options.session,
    last: options.last,
    sessionsDirectory,
  });
  const reports: Awaited<ReturnType<typeof analyzeFile>>[] = [];
  for (const file of files) {
    reports.push(
      await analyzeFile(file, { includeSnippets: options.includeSnippets }),
    );
  }
  if (reports.length === 1) {
    process.stdout.write(
      options.json
        ? `${JSON.stringify(reports[0], null, 2)}\n`
        : `${renderSession(reports[0]!)}\n`,
    );
  } else {
    const aggregate = buildMultiSessionReport(reports);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(aggregate, null, 2)}\n`
        : `${renderMulti(aggregate)}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
