import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { defaultSessionsDirectory, listRollouts } from "./discovery.js";
import { redactHome } from "./redact.js";

export interface DoctorReport {
  ok: boolean;
  node_version: string;
  sessions_directory: string;
  rollout_count: number;
  latest_rollout?: string;
  capabilities: {
    base_instructions_text: boolean;
    last_token_usage: boolean;
    function_call: boolean;
    custom_tool_call: boolean;
    compaction_replacement_history: boolean;
  };
  warnings: string[];
}

export async function doctor(
  sessionsDirectory = defaultSessionsDirectory(),
): Promise<DoctorReport> {
  const warnings: string[] = [];
  try {
    await access(sessionsDirectory);
  } catch {
    return {
      ok: false,
      node_version: process.version,
      sessions_directory: redactHome(sessionsDirectory) ?? sessionsDirectory,
      rollout_count: 0,
      capabilities: {
        base_instructions_text: false,
        last_token_usage: false,
        function_call: false,
        custom_tool_call: false,
        compaction_replacement_history: false,
      },
      warnings: ["The sessions directory is not readable."],
    };
  }
  const files = await listRollouts(sessionsDirectory);
  const latest = files[0];
  const capabilities = {
    base_instructions_text: false,
    last_token_usage: false,
    function_call: false,
    custom_tool_call: false,
    compaction_replacement_history: false,
  };
  if (latest) {
    const reader = createInterface({
      input: createReadStream(latest, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of reader) {
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const payload =
          record.payload && typeof record.payload === "object"
            ? record.payload as Record<string, unknown>
            : {};
        if (
          record.type === "session_meta" &&
          payload.base_instructions &&
          typeof payload.base_instructions === "object" &&
          typeof (payload.base_instructions as Record<string, unknown>).text === "string"
        ) {
          capabilities.base_instructions_text = true;
        }
        if (record.type === "response_item" && payload.type === "function_call") {
          capabilities.function_call = true;
        }
        if (record.type === "response_item" && payload.type === "custom_tool_call") {
          capabilities.custom_tool_call = true;
        }
        if (
          record.type === "event_msg" &&
          payload.type === "token_count" &&
          payload.info &&
          typeof payload.info === "object" &&
          (payload.info as Record<string, unknown>).last_token_usage
        ) {
          capabilities.last_token_usage = true;
        }
        if (
          record.type === "compacted" &&
          Array.isArray(payload.replacement_history)
        ) {
          capabilities.compaction_replacement_history = true;
        }
      } catch {
        warnings.push("The latest rollout contains malformed JSONL records.");
      }
    }
  } else {
    warnings.push("No rollout files were found. Ephemeral sessions cannot be analyzed.");
  }
  if (!capabilities.last_token_usage && latest) {
    warnings.push(
      "The latest rollout has no last_token_usage capability; this may be version- or session-mode-specific.",
    );
  }
  return {
    ok: Boolean(latest && capabilities.last_token_usage),
    node_version: process.version,
    sessions_directory: redactHome(sessionsDirectory) ?? sessionsDirectory,
    rollout_count: files.length,
    latest_rollout: redactHome(latest),
    capabilities,
    warnings: [...new Set(warnings)],
  };
}
