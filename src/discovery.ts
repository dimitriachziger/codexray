import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultSessionsDirectory(): string {
  return (
    process.env.CODEX_SESSIONS_DIR ??
    join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions")
  );
}

async function collect(directory: string, output: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path, output);
    } else if (
      entry.isFile() &&
      entry.name.startsWith("rollout-") &&
      entry.name.endsWith(".jsonl")
    ) {
      output.push(path);
    }
  }
}

export async function listRollouts(directory = defaultSessionsDirectory()): Promise<string[]> {
  const files: string[] = [];
  await collect(directory, files);
  const dated = await Promise.all(
    files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })),
  );
  return dated
    .sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file))
    .map((entry) => entry.file);
}

export async function selectRollouts(options: {
  latest?: boolean;
  session?: string;
  last?: number;
  sessionsDirectory?: string;
}): Promise<string[]> {
  const files = await listRollouts(options.sessionsDirectory);
  if (options.session) {
    const matches = files.filter((file) => file.includes(options.session!));
    if (matches.length === 0) {
      throw new Error(`No rollout matched session id ${options.session}.`);
    }
    if (matches.length > 1) {
      throw new Error(`Session id ${options.session} matched more than one rollout.`);
    }
    return matches;
  }
  if (options.last !== undefined) return files.slice(0, options.last);
  if (options.latest) return files.slice(0, 1);
  throw new Error("Choose exactly one of --latest, --session <id>, or --last <count>.");
}
