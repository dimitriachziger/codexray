import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { TokenCounter } from "../src/tokenizer.js";

const cli = join(process.cwd(), "dist", "src", "cli.js");
const fixtures = join(process.cwd(), "test", "fixtures");

function run(...args: string[]): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return result;
}

function runWithEnv(
  env: NodeJS.ProcessEnv,
  ...args: string[]
): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  assert.equal(result.error, undefined);
  return result;
}

test("prints global help, subcommand help, and version", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(String(help.stdout), /Commands:/);
  assert.match(String(help.stdout), /analyze/);
  assert.match(String(help.stdout), /doctor/);
  assert.match(String(help.stdout), /skill/);

  const analyzeHelp = run("analyze", "--help");
  assert.equal(analyzeHelp.status, 0);
  assert.match(String(analyzeHelp.stdout), /Selectors \(choose exactly one\)/);
  assert.match(String(analyzeHelp.stdout), /--summary-json/);
  assert.match(String(analyzeHelp.stdout), /--exclude-current/);

  const doctorHelp = run("doctor", "--help");
  assert.equal(doctorHelp.status, 0);
  assert.match(String(doctorHelp.stdout), /codex-token-analyzer doctor/);

  const skillHelp = run("skill", "--help");
  assert.equal(skillHelp.status, 0);
  assert.match(String(skillHelp.stdout), /skill install/);

  const version = run("--version");
  assert.equal(version.status, 0);
  assert.equal(String(version.stdout).trim(), "0.1.0");
});

test("returns exit code 2 for invalid and command-specific arguments", () => {
  for (const args of [
    ["unknown"],
    ["analyze", "--unknown"],
    ["analyze"],
    ["analyze", "--latest", "--last", "2"],
    ["analyze", "--session", "--json"],
    ["analyze", "--latest", "--summary-json", "--json"],
    ["analyze", "--latest", "--summary-json", "--include-snippets"],
    ["analyze", "--latest", "--exclude-current"],
    ["doctor", "--latest"],
    ["doctor", "--include-snippets"],
    ["doctor", "--summary-json"],
    ["doctor", "--exclude-current"],
    ["skill"],
    ["skill", "unknown"],
    ["skill", "install", "--latest"],
    ["skill", "install", "--json"],
    ["analyze", "--latest", "--force"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(String(result.stderr), /^Error:/);
  }
});

test("requires CODEX_THREAD_ID when excluding the current session", () => {
  const env = { ...process.env };
  delete env.CODEX_THREAD_ID;
  const result = runWithEnv(env, "analyze", "--last", "2", "--exclude-current");
  assert.equal(result.status, 2);
  assert.match(String(result.stderr), /requires CODEX_THREAD_ID/);
});

test("installs the bundled skill globally without overwriting by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-skills-"));
  const installed = run("skill", "install", "--skills-dir", directory);
  assert.equal(installed.status, 0, String(installed.stderr));

  const skillFile = join(
    directory,
    "explain-codex-token-usage",
    "SKILL.md",
  );
  assert.match(await readFile(skillFile, "utf8"), /name: explain-codex-token-usage/);

  const duplicate = run("skill", "install", "--skills-dir", directory);
  assert.equal(duplicate.status, 1);
  assert.match(String(duplicate.stderr), /already exists/);

  const forced = run(
    "skill",
    "install",
    "--skills-dir",
    directory,
    "--force",
  );
  assert.equal(forced.status, 0, String(forced.stderr));
});

test("returns exit code 1 with a clear error for empty and missing directories", async () => {
  const empty = await mkdtemp(join(tmpdir(), "codexray-empty-"));
  const emptyResult = run("analyze", "--latest", "--sessions-dir", empty);
  assert.equal(emptyResult.status, 1);
  assert.match(String(emptyResult.stderr), /No rollout files were found/);

  const missing = join(empty, "does-not-exist");
  const missingResult = run("analyze", "--latest", "--sessions-dir", missing);
  assert.equal(missingResult.status, 1);
  assert.match(String(missingResult.stderr), /Sessions directory is not readable/);
});

test("rejects ambiguous session ids and analyzes a unique fixture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-sessions-"));
  await writeFile(join(directory, "rollout-ambiguous-token-a.jsonl"), "");
  await writeFile(join(directory, "rollout-ambiguous-token-b.jsonl"), "");

  const ambiguous = run(
    "analyze",
    "--session",
    "ambiguous-token",
    "--sessions-dir",
    directory,
  );
  assert.equal(ambiguous.status, 1);
  assert.match(String(ambiguous.stderr), /matched more than one rollout/);

  const validDirectory = await mkdtemp(join(tmpdir(), "codexray-valid-"));
  await copyFile(
    join(fixtures, "simple.jsonl"),
    join(validDirectory, "rollout-simple-session.jsonl"),
  );
  const valid = run(
    "analyze",
    "--session",
    "simple-session",
    "--sessions-dir",
    validDirectory,
    "--json",
  );
  assert.equal(valid.status, 0, String(valid.stderr));
  const report = JSON.parse(String(valid.stdout)) as {
    schema_version: string;
    session: { id: string };
  };
  assert.equal(report.schema_version, "1.0.0");
  assert.equal(report.session.id, "simple-session");

  const summaryResult = run(
    "analyze",
    "--session",
    "simple-session",
    "--sessions-dir",
    validDirectory,
    "--summary-json",
  );
  assert.equal(summaryResult.status, 0, String(summaryResult.stderr));
  assert.equal(
    (JSON.parse(String(summaryResult.stdout)) as { report_kind: string })
      .report_kind,
    "summary",
  );
});

test("writes a compact summary and records current-session exclusion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-summary-"));
  await copyFile(
    join(fixtures, "simple.jsonl"),
    join(directory, "rollout-current-thread.jsonl"),
  );
  await copyFile(
    join(fixtures, "complex.jsonl"),
    join(directory, "rollout-historical.jsonl"),
  );
  const latest = run(
    "analyze",
    "--latest",
    "--summary-json",
    "--sessions-dir",
    directory,
  );
  assert.equal(latest.status, 0, String(latest.stderr));
  assert.equal(
    (JSON.parse(String(latest.stdout)) as { report_kind: string }).report_kind,
    "summary",
  );

  const result = runWithEnv(
    { ...process.env, CODEX_THREAD_ID: "current-thread" },
    "analyze",
    "--last",
    "1",
    "--summary-json",
    "--exclude-current",
    "--sessions-dir",
    directory,
  );
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(String(result.stdout).trim().split("\n").length, 1);
  const summary = JSON.parse(String(result.stdout)) as {
    report_kind: string;
    session_count: number;
    current_session_exclusion: {
      requested: boolean;
      session_id: string;
      found: boolean;
      excluded: boolean;
    };
  };
  assert.equal(summary.report_kind, "summary");
  assert.equal(summary.session_count, 1);
  assert.deepEqual(summary.current_session_exclusion, {
    requested: true,
    session_id: "current-thread",
    found: true,
    excluded: true,
  });
});

test("keeps a 20-session summary to one line and under 2,000 tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-summary-20-"));
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      copyFile(
        join(fixtures, "simple.jsonl"),
        join(directory, `rollout-session-${String(index).padStart(2, "0")}.jsonl`),
      ),
    ),
  );
  const result = run(
    "analyze",
    "--last",
    "20",
    "--summary-json",
    "--sessions-dir",
    directory,
  );
  assert.equal(result.status, 0, String(result.stderr));
  const output = String(result.stdout);
  assert.equal(output.trim().split("\n").length, 1);
  assert.ok(new TokenCounter("gpt-5").count(output) < 2_000);
});
