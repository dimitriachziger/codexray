import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { selectRolloutsWithMetadata } from "../src/discovery.js";

async function rollout(
  directory: string,
  name: string,
  modifiedSeconds: number,
): Promise<string> {
  const file = join(directory, `rollout-${name}.jsonl`);
  await writeFile(file, "");
  await utimes(file, modifiedSeconds, modifiedSeconds);
  return file;
}

test("excludes the current session before applying the --last limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-discovery-"));
  await rollout(directory, "older-a", 100);
  await rollout(directory, "older-b", 200);
  await rollout(directory, "current-thread", 300);

  const selection = await selectRolloutsWithMetadata({
    last: 2,
    sessionsDirectory: directory,
    excludeCurrentSession: "current-thread",
  });

  assert.deepEqual(
    selection.files.map((file) => basename(file)),
    ["rollout-older-b.jsonl", "rollout-older-a.jsonl"],
  );
  assert.deepEqual(selection.currentSessionExclusion, {
    requested: true,
    sessionId: "current-thread",
    found: true,
    excluded: true,
  });
});

test("a missing current session id leaves the limited selection unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexray-discovery-"));
  await rollout(directory, "older-a", 100);
  await rollout(directory, "newer-b", 200);
  await rollout(directory, "newest-c", 300);

  const selection = await selectRolloutsWithMetadata({
    last: 2,
    sessionsDirectory: directory,
    excludeCurrentSession: "not-present",
  });

  assert.deepEqual(
    selection.files.map((file) => basename(file)),
    ["rollout-newest-c.jsonl", "rollout-newer-b.jsonl"],
  );
  assert.deepEqual(selection.currentSessionExclusion, {
    requested: true,
    sessionId: "not-present",
    found: false,
    excluded: false,
  });
});
