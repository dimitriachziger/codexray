import assert from "node:assert/strict";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test("prints global help, subcommand help, and version", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(String(help.stdout), /Commands:/);
  assert.match(String(help.stdout), /analyze/);
  assert.match(String(help.stdout), /doctor/);

  const analyzeHelp = run("analyze", "--help");
  assert.equal(analyzeHelp.status, 0);
  assert.match(String(analyzeHelp.stdout), /Selectors \(choose exactly one\)/);

  const doctorHelp = run("doctor", "--help");
  assert.equal(doctorHelp.status, 0);
  assert.match(String(doctorHelp.stdout), /codex-token-analyzer doctor/);

  const version = run("--version");
  assert.equal(version.status, 0);
  assert.equal(String(version.stdout).trim(), "0.1.0");
});

test("returns exit code 2 for invalid arguments and doctor analysis options", () => {
  for (const args of [
    ["unknown"],
    ["analyze", "--unknown"],
    ["analyze"],
    ["analyze", "--latest", "--last", "2"],
    ["analyze", "--session", "--json"],
    ["doctor", "--latest"],
    ["doctor", "--include-snippets"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(String(result.stderr), /^Error:/);
  }
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
});
