import { createHash } from "node:crypto";
import { redactHome } from "./redact.js";

export interface CallMetadata {
  operation: "read" | "mutation" | "other";
  target?: string;
  target_source?: "structured" | "shell";
}

const PATH_KEYS = new Set([
  "path",
  "file_path",
  "filepath",
  "filename",
  "uri",
  "ref_id",
]);
const READERS = new Set(["rg", "grep", "sed", "cat", "head", "tail"]);
const MUTATING_TOOL = /(apply_patch|write|edit|delete|remove|rename|move|mkdir)/i;

function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) words.push(current);
      current = "";
    } else if ("|;&".includes(char)) {
      return undefined;
    } else {
      current += char;
    }
  }
  if (quote || escaped) return undefined;
  if (current) words.push(current);
  return words;
}

function shellReadTarget(command: string): string | undefined {
  const words = shellWords(command.trim());
  if (!words?.length) return undefined;
  const executable = words[0]!.split("/").pop()!;
  if (!READERS.has(executable)) return undefined;

  const args = words.slice(1);
  const positional: string[] = [];
  const flagsWithValue = new Set([
    "--lines",
    "-c",
    "--bytes",
    "-m",
    "--max-count",
    "-A",
    "-B",
    "-C",
    "--after-context",
    "--before-context",
    "--context",
    "-e",
    "--regexp",
    "-f",
    "--file",
    "-g",
    "--glob",
    "-t",
    "--type",
  ]);
  if (executable === "head" || executable === "tail") {
    flagsWithValue.add("-n");
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (flagsWithValue.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }

  if (executable === "rg" || executable === "grep") {
    positional.shift();
  } else if (executable === "sed") {
    positional.shift();
  }
  const candidate = positional.at(-1);
  if (!candidate || candidate === "-" || /^\d+$/.test(candidate)) return undefined;
  return redactHome(candidate);
}

function findStructuredTarget(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStructuredTarget(entry);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PATH_KEYS.has(key) && typeof entry === "string" && entry) {
      return redactHome(entry);
    }
  }
  for (const entry of Object.values(value)) {
    const found = findStructuredTarget(entry);
    if (found) return found;
  }
  return undefined;
}

export function analyzeCall(toolName: string, input: unknown): CallMetadata {
  if (MUTATING_TOOL.test(toolName)) {
    const target =
      typeof input === "string"
        ? input.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1]
        : findStructuredTarget(input);
    return {
      operation: "mutation",
      target: redactHome(target),
      target_source: target ? "structured" : undefined,
    };
  }

  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      parsed = input;
    }
  }
  if (parsed && typeof parsed === "object") {
    const target = findStructuredTarget(parsed);
    const command =
      "cmd" in parsed && typeof parsed.cmd === "string" ? parsed.cmd : undefined;
    if (command) {
      if (/\b(?:sed\s+-i|rm|mv|cp|touch|mkdir|git\s+apply|perl\s+-i)\b/.test(command)) {
        return { operation: "mutation" };
      }
      const shellTarget = shellReadTarget(command);
      if (shellTarget) {
        return { operation: "read", target: shellTarget, target_source: "shell" };
      }
    }
    if (target) {
      return { operation: "read", target, target_source: "structured" };
    }
  }
  return { operation: "other" };
}

export function normalizedOutput(value: string): {
  hash: string;
  lineHashes: string[];
  lineCount: number;
} {
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  const unique = new Set<string>();
  const lines = normalized.split("\n");
  for (const line of lines.slice(0, 20_000)) {
    const normalizedLine = line.trim();
    if (normalizedLine) {
      unique.add(
        createHash("sha256").update(normalizedLine).digest("hex").slice(0, 16),
      );
    }
  }
  return {
    hash: createHash("sha256").update(normalized).digest("hex"),
    lineHashes: [...unique],
    lineCount: lines.length,
  };
}
