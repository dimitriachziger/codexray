#!/usr/bin/env node
import { analyzeFile } from "./analyze.js";
import {
  defaultSessionsDirectory,
  selectRolloutsWithMetadata,
} from "./discovery.js";
import { doctor } from "./doctor.js";
import {
  buildMultiSessionReport,
  buildSummaryReport,
  renderMulti,
  renderSession,
} from "./report.js";
import { installSkill } from "./skill.js";

interface CliOptions {
  command?: "analyze" | "doctor" | "skill";
  force?: boolean;
  skillsDirectory?: string;
  latest?: boolean;
  session?: string;
  last?: number;
  json?: boolean;
  summaryJson?: boolean;
  includeSnippets?: boolean;
  excludeCurrent?: boolean;
  sessionsDirectory?: string;
}

const VERSION = "0.1.0";

const HELP = `Codexray — Codex Token Analyzer

Usage:
  codex-token-analyzer <command> [options]

Commands:
  analyze  Analyze one or more rollout files.
  doctor   Check the sessions directory and supported rollout events.
  skill    Manage the bundled Codex skill.

Options:
  -h, --help     Show help.
  -v, --version  Show the version.

Run "codex-token-analyzer <command> --help" for command-specific help.
`;

const ANALYZE_HELP = `Usage:
  codex-token-analyzer analyze --latest [options]
  codex-token-analyzer analyze --session <id> [options]
  codex-token-analyzer analyze --last <count> [options]

Selectors (choose exactly one):
  --latest               Analyze the newest rollout.
  --session <id>         Analyze the rollout matching a session id.
  --last <count>         Analyze the newest 1–20 rollouts.

Options:
  --json                  Write the versioned JSON report.
  --summary-json          Write a compact, bounded JSON summary.
  --include-snippets      Include bounded, redacted snippets (explicit opt-in).
  --exclude-current       With --last, exclude CODEX_THREAD_ID before limiting.
  --sessions-dir <path>   Override the Codex sessions directory.
  -h, --help              Show this help.
`;

const DOCTOR_HELP = `Usage:
  codex-token-analyzer doctor [options]

Options:
  --json                  Write the doctor result as JSON.
  --sessions-dir <path>   Override the Codex sessions directory.
  -h, --help              Show this help.
`;

const SKILL_HELP = `Usage:
  codex-token-analyzer skill install [options]

Options:
  --force                 Replace an existing installation.
  --skills-dir <path>     Override the user skills directory.
  -h, --help              Show this help.
`;

class CliUsageError extends Error {}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const command = argv.shift();
  if (command === "analyze" || command === "doctor" || command === "skill") {
    options.command = command;
  }
  else if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(HELP);
    return options;
  } else if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return options;
  } else {
    throw new CliUsageError(`Unknown command: ${command}`);
  }
  if (options.command === "skill") {
    const skillCommand = argv.shift();
    if (skillCommand === "--help" || skillCommand === "-h") {
      process.stdout.write(SKILL_HELP);
      return {};
    }
    if (skillCommand !== "install") {
      throw new CliUsageError(
        skillCommand
          ? `Unknown skill command: ${skillCommand}`
          : "skill requires the install command.",
      );
    }
  }
  while (argv.length) {
    const argument = argv.shift()!;
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        options.command === "analyze"
          ? ANALYZE_HELP
          : options.command === "doctor"
            ? DOCTOR_HELP
            : SKILL_HELP,
      );
      return {};
    } else if (argument === "--version" || argument === "-v") {
      throw new CliUsageError("--version is only available as a global option.");
    } else if (argument === "--latest") options.latest = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--summary-json") options.summaryJson = true;
    else if (argument === "--exclude-current") options.excludeCurrent = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--include-snippets") options.includeSnippets = true;
    else if (argument === "--session") {
      const value = argv.shift();
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--session requires an id.");
      }
      options.session = value;
    } else if (argument === "--last") {
      const value = Number(argv.shift());
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new CliUsageError("--last must be an integer between 1 and 20.");
      }
      options.last = value;
    } else if (argument === "--sessions-dir") {
      const value = argv.shift();
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--sessions-dir requires a path.");
      }
      options.sessionsDirectory = value;
    } else if (argument === "--skills-dir") {
      const value = argv.shift();
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--skills-dir requires a path.");
      }
      options.skillsDirectory = value;
    } else {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
  }
  if (options.command === "doctor") {
    const analysisOptions = [
      options.latest && "--latest",
      options.session !== undefined && "--session",
      options.last !== undefined && "--last",
      options.includeSnippets && "--include-snippets",
      options.summaryJson && "--summary-json",
      options.excludeCurrent && "--exclude-current",
    ].filter(Boolean);
    if (analysisOptions.length) {
      throw new CliUsageError(
        `doctor does not accept analysis option(s): ${analysisOptions.join(", ")}.`,
      );
    }
  }
  if (options.command === "skill") {
    const unrelatedOptions = [
      options.latest && "--latest",
      options.session !== undefined && "--session",
      options.last !== undefined && "--last",
      options.json && "--json",
      options.summaryJson && "--summary-json",
      options.includeSnippets && "--include-snippets",
      options.excludeCurrent && "--exclude-current",
      options.sessionsDirectory !== undefined && "--sessions-dir",
    ].filter(Boolean);
    if (unrelatedOptions.length) {
      throw new CliUsageError(
        `skill install does not accept option(s): ${unrelatedOptions.join(", ")}.`,
      );
    }
  }
  if (options.command !== "skill" && (options.force || options.skillsDirectory)) {
    throw new CliUsageError(
      "--force and --skills-dir are only available for skill install.",
    );
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command) return;
  if (options.command === "skill") {
    const destination = await installSkill({
      force: options.force,
      skillsDirectory: options.skillsDirectory,
    });
    process.stdout.write(`Installed explain-codex-token-usage to ${destination}\n`);
    return;
  }
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
    throw new CliUsageError(
      "Choose exactly one of --latest, --session <id>, or --last <count>.",
    );
  }
  if (options.summaryJson && (options.json || options.includeSnippets)) {
    throw new CliUsageError(
      "--summary-json cannot be combined with --json or --include-snippets.",
    );
  }
  if (options.excludeCurrent && options.last === undefined) {
    throw new CliUsageError("--exclude-current is only available with --last.");
  }
  const currentSessionId = options.excludeCurrent
    ? process.env.CODEX_THREAD_ID?.trim()
    : undefined;
  if (options.excludeCurrent && !currentSessionId) {
    throw new CliUsageError(
      "--exclude-current requires CODEX_THREAD_ID to be set.",
    );
  }
  const selection = await selectRolloutsWithMetadata({
    latest: options.latest,
    session: options.session,
    last: options.last,
    sessionsDirectory,
    excludeCurrentSession: currentSessionId,
  });
  const files = selection.files;
  if (files.length === 0) {
    throw new Error(`No rollout files were found in ${sessionsDirectory}.`);
  }
  const reports: Awaited<ReturnType<typeof analyzeFile>>[] = [];
  for (const file of files) {
    reports.push(
      await analyzeFile(file, { includeSnippets: options.includeSnippets }),
    );
  }
  if (options.summaryJson) {
    const exclusion = selection.currentSessionExclusion;
    process.stdout.write(
      `${JSON.stringify(
        buildSummaryReport(reports, {
          requested: exclusion.requested,
          ...(exclusion.sessionId ? { session_id: exclusion.sessionId } : {}),
          found: exclusion.found,
          excluded: exclusion.excluded,
        }),
      )}\n`,
    );
    return;
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
  if (error instanceof CliUsageError) {
    process.stderr.write('Run "codex-token-analyzer --help" for usage.\n');
    process.exitCode = 2;
  } else {
    process.exitCode = 1;
  }
});
