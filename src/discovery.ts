import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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
  try {
    await collect(directory, files);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
      throw new Error(`Sessions directory is not readable: ${directory}.`);
    }
    throw error;
  }
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
  excludeCurrentSession?: string;
}): Promise<string[]> {
  return (await selectRolloutsWithMetadata(options)).files;
}

export interface RolloutSelection {
  files: string[];
  currentSessionExclusion: {
    requested: boolean;
    sessionId?: string;
    found: boolean;
    excluded: boolean;
  };
}

export async function selectRolloutsWithMetadata(options: {
  latest?: boolean;
  session?: string;
  last?: number;
  sessionsDirectory?: string;
  excludeCurrentSession?: string;
}): Promise<RolloutSelection> {
  const files = await listRollouts(options.sessionsDirectory);
  const exclusion = {
    requested: options.excludeCurrentSession !== undefined,
    ...(options.excludeCurrentSession !== undefined
      ? { sessionId: options.excludeCurrentSession }
      : {}),
    found: false,
    excluded: false,
  };
  if (options.session) {
    const matches = files.filter((file) => file.includes(options.session!));
    if (matches.length === 0) {
      throw new Error(`No rollout matched session id ${options.session}.`);
    }
    if (matches.length > 1) {
      throw new Error(`Session id ${options.session} matched more than one rollout.`);
    }
    return { files: matches, currentSessionExclusion: exclusion };
  }
  if (options.last !== undefined) {
    const filtered =
      options.excludeCurrentSession === undefined
        ? files
        : files.filter(
            (file) => !basename(file).includes(options.excludeCurrentSession!),
          );
    if (options.excludeCurrentSession !== undefined) {
      exclusion.found = filtered.length !== files.length;
      exclusion.excluded = exclusion.found;
    }
    return {
      files: filtered.slice(0, options.last),
      currentSessionExclusion: exclusion,
    };
  }
  if (options.latest) {
    return {
      files: files.slice(0, 1),
      currentSessionExclusion: exclusion,
    };
  }
  throw new Error("Choose exactly one of --latest, --session <id>, or --last <count>.");
}
