import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { boundedSnippet } from "./redact.js";
import { analyzeCall, normalizedOutput } from "./targets.js";
import { TokenCounter, chooseEncoding } from "./tokenizer.js";
import type {
  Accounting,
  CategoryTokens,
  Confidence,
  InternalContextItem,
  InternalSession,
  ModelStep,
  TokenUsage,
  Turn,
} from "./types.js";

interface ParseOptions {
  includeSnippets?: boolean;
}

interface CallRecord {
  tool_name: string;
  operation: "read" | "mutation" | "other";
  target?: string;
  target_source?: "structured" | "shell";
  sequence: number;
}

const emptyCategories = (): CategoryTokens => ({
  instructions: 0,
  user: 0,
  assistant: 0,
  tool_call: 0,
  tool_output: 0,
});

const emptyUsage = (): TokenUsage => ({
  input_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
});

const emptyAccounting = (): Accounting => ({
  ...emptyUsage(),
  model_steps: 0,
  turns: 0,
});

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function tokenUsage(value: unknown): TokenUsage {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    input_tokens: safeNumber(raw.input_tokens),
    cached_input_tokens: safeNumber(raw.cached_input_tokens),
    cache_write_input_tokens: safeNumber(raw.cache_write_input_tokens),
    output_tokens: safeNumber(raw.output_tokens),
    reasoning_output_tokens: safeNumber(raw.reasoning_output_tokens),
    total_tokens: safeNumber(raw.total_tokens),
  };
}

function isNonEmptyUsage(usage: TokenUsage): boolean {
  return Object.values(usage).some((value) => value > 0);
}

function addUsage(target: TokenUsage, usage: TokenUsage): void {
  target.input_tokens += usage.input_tokens;
  target.cached_input_tokens += usage.cached_input_tokens;
  target.cache_write_input_tokens += usage.cache_write_input_tokens;
  target.output_tokens += usage.output_tokens;
  target.reasoning_output_tokens += usage.reasoning_output_tokens;
  target.total_tokens += usage.total_tokens;
}

function textContent(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (typeof value.text === "string") parts.push(value.text);
  }
  return parts.join("\n");
}

function reasoningSummary(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.summary)) return "";
  return payload.summary
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const text = (entry as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function confidenceFor(input: number, visible: number): Confidence {
  if (input === 0) return visible === 0 ? "high" : "low";
  const ratio = visible / input;
  if (ratio >= 0.7 && ratio <= 1.15) return "high";
  if (ratio >= 0.4 && ratio <= 1.35) return "medium";
  return "low";
}

export async function parseSession(
  file: string,
  options: ParseOptions = {},
): Promise<InternalSession> {
  const turns = new Map<string, Turn>();
  const items: InternalContextItem[] = [];
  const itemById = new Map<string, InternalContextItem>();
  const activeItems = new Set<string>();
  const calls = new Map<string, CallRecord>();
  const counters = new Map<string, TokenCounter>();
  const usedModels = new Set<string>();
  const accounting = emptyAccounting();
  const warnings: InternalSession["warnings"] = [];
  const unknownEventTypes: Record<string, number> = {};

  let sessionId = basename(file).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  let timestamp: string | undefined;
  let cliVersion: string | undefined;
  let cwd: string | undefined;
  let currentTurnId = "unassigned";
  let currentModel = "unknown";
  let stepIndex = 0;
  let sequence = 0;
  let lineNumber = 0;
  let malformedLines = 0;
  let resetMarkers = 0;
  let compactedEvents = 0;

  const counterFor = (model = currentModel): TokenCounter => {
    let counter = counters.get(model);
    if (!counter) {
      counter = new TokenCounter(model === "unknown" ? undefined : model);
      counters.set(model, counter);
    }
    return counter;
  };

  const ensureTurn = (id = currentTurnId, model = currentModel): Turn => {
    let turn = turns.get(id);
    if (!turn) {
      turn = { id, model, model_steps: [] };
      turns.set(id, turn);
    } else if (turn.model === "unknown" && model !== "unknown") {
      turn.model = model;
    }
    return turn;
  };

  const addItem = (
    category: InternalContextItem["category"],
    content: string,
    availability: number,
    extra: Partial<InternalContextItem> = {},
  ): InternalContextItem | undefined => {
    if (!content) return undefined;
    sequence += 1;
    const item: InternalContextItem = {
      id: `item-${sequence}`,
      category,
      tokens: counterFor().count(content),
      timestamp: extra.timestamp,
      turn_id: currentTurnId === "unassigned" ? undefined : currentTurnId,
      model: currentModel === "unknown" ? undefined : currentModel,
      available_from_step: availability,
      retained_steps: 0,
      retained_context_load: 0,
      sequence,
      ...extra,
    };
    if (options.includeSnippets) item.snippet = boundedSnippet(content);
    items.push(item);
    itemById.set(item.id, item);
    activeItems.add(item.id);
    return item;
  };

  const handleResponseItem = (
    payload: Record<string, unknown>,
    replacement = false,
  ): void => {
    const type = typeof payload.type === "string" ? payload.type : "";
    const availability = replacement ? stepIndex : stepIndex + 1;
    if (type === "message") {
      const role = typeof payload.role === "string" ? payload.role : "";
      const category =
        role === "developer" || role === "system"
          ? "instructions"
          : role === "user"
            ? "user"
            : role === "assistant"
              ? "assistant"
              : undefined;
      if (category) {
        addItem(
          category,
          textContent(payload),
          replacement || category === "instructions" || category === "user"
            ? stepIndex
            : availability,
        );
      }
      return;
    }
    if (type === "reasoning") {
      addItem("assistant", reasoningSummary(payload), availability);
      return;
    }
    if (type === "function_call" || type === "custom_tool_call") {
      const toolName = typeof payload.name === "string" ? payload.name : "unknown_tool";
      const input =
        type === "custom_tool_call" ? payload.input : payload.arguments;
      const serialized =
        typeof input === "string" ? input : input === undefined ? "" : JSON.stringify(input);
      const metadata = analyzeCall(toolName, input);
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const item = addItem(
        "tool_call",
        `${toolName}\n${serialized}`,
        availability,
        {
          call_id: callId,
          tool_name: toolName,
          ...metadata,
        },
      );
      if (callId && item) {
        calls.set(callId, {
          tool_name: toolName,
          operation: metadata.operation,
          target: metadata.target,
          target_source: metadata.target_source,
          sequence: item.sequence,
        });
      }
      return;
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const output =
        typeof payload.output === "string"
          ? payload.output
          : payload.output === undefined
            ? ""
            : JSON.stringify(payload.output);
      const call = callId ? calls.get(callId) : undefined;
      const normalized = normalizedOutput(output);
      addItem("tool_output", output, availability, {
        call_id: callId,
        tool_name: call?.tool_name,
        operation: call?.operation ?? "other",
        target: call?.target,
        target_source: call?.target_source,
        normalized_hash: normalized.hash,
        line_hashes: normalized.lineHashes,
        line_count: normalized.lineCount,
      });
    }
  };

  const completeStep = (usage: TokenUsage): void => {
    const visibleByCategory = emptyCategories();
    let visibleTokens = 0;
    for (const id of activeItems) {
      const item = itemById.get(id);
      if (!item || item.available_from_step > stepIndex) continue;
      visibleTokens += item.tokens;
      visibleByCategory[item.category] += item.tokens;
      item.retained_steps += 1;
      item.retained_context_load += item.tokens;
    }
    const unattributed = Math.max(0, usage.input_tokens - visibleTokens);
    const overage = Math.max(0, visibleTokens - usage.input_tokens);
    const coverageRatio =
      usage.input_tokens > 0 ? Math.min(1, visibleTokens / usage.input_tokens) : 0;
    const step: ModelStep = {
      index: stepIndex,
      turn_id: currentTurnId,
      model: currentModel,
      accounting: usage,
      visible_tokens: visibleTokens,
      visible_by_category: visibleByCategory,
      unattributed_input_tokens: unattributed,
      visible_overage_tokens: overage,
      coverage_ratio: coverageRatio,
      reconstruction_confidence: confidenceFor(usage.input_tokens, visibleTokens),
    };
    ensureTurn().model_steps.push(step);
    addUsage(accounting, usage);
    accounting.model_steps += 1;
    stepIndex += 1;
  };

  const input = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("record is not an object");
      record = parsed as Record<string, unknown>;
    } catch {
      malformedLines += 1;
      if (warnings.length < 20) {
        warnings.push({
          code: "malformed_jsonl",
          message: "A malformed JSONL record was skipped.",
          line: lineNumber,
        });
      }
      continue;
    }

    const type = typeof record.type === "string" ? record.type : "unknown";
    const payload =
      record.payload && typeof record.payload === "object"
        ? record.payload as Record<string, unknown>
        : {};
    if (!timestamp && typeof record.timestamp === "string") timestamp = record.timestamp;

    if (type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      else if (typeof payload.session_id === "string") sessionId = payload.session_id;
      if (typeof payload.timestamp === "string") timestamp = payload.timestamp;
      if (typeof payload.cli_version === "string") cliVersion = payload.cli_version;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      const base = payload.base_instructions;
      if (base && typeof base === "object") {
        const text = (base as Record<string, unknown>).text;
        if (typeof text === "string") addItem("instructions", text, stepIndex);
      } else if (typeof payload.instructions === "string") {
        addItem("instructions", payload.instructions, stepIndex);
      }
    } else if (type === "turn_context") {
      if (typeof payload.turn_id === "string") currentTurnId = payload.turn_id;
      if (typeof payload.model === "string") {
        currentModel = payload.model;
        usedModels.add(currentModel);
      }
      ensureTurn();
    } else if (type === "response_item") {
      handleResponseItem(payload);
    } else if (type === "event_msg") {
      if (payload.type === "token_count") {
        const info =
          payload.info && typeof payload.info === "object"
            ? payload.info as Record<string, unknown>
            : {};
        const usage = tokenUsage(info.last_token_usage);
        if (isNonEmptyUsage(usage)) completeStep(usage);
        else resetMarkers += 1;
      }
    } else if (type === "compacted") {
      compactedEvents += 1;
      for (const id of activeItems) {
        const item = itemById.get(id);
        if (item) item.retired_at_step = stepIndex;
      }
      activeItems.clear();
      const history = payload.replacement_history;
      if (Array.isArray(history)) {
        for (const entry of history) {
          if (entry && typeof entry === "object") {
            handleResponseItem(entry as Record<string, unknown>, true);
          }
        }
      } else {
        warnings.push({
          code: "compaction_without_replacement_history",
          message: "A compaction record had no replacement_history.",
          line: lineNumber,
        });
      }
    } else if (type !== "world_state") {
      unknownEventTypes[type] = (unknownEventTypes[type] ?? 0) + 1;
    }
  }

  const turnList = [...turns.values()];
  accounting.turns = turnList.length;
  for (const turn of turnList) {
    if (turn.model_steps.length === 0) {
      warnings.push({
        code: "turn_without_token_count",
        message: `Turn ${turn.id} has no non-empty last_token_usage event.`,
      });
    }
  }
  if (accounting.model_steps === 0) {
    warnings.push({
      code: "missing_token_events",
      message: "No non-empty last_token_usage events were found; exact accounting is unavailable.",
    });
  }
  const unknownCount = Object.values(unknownEventTypes).reduce((sum, count) => sum + count, 0);
  if (unknownCount > 0) {
    warnings.push({
      code: "unknown_events",
      message: `${unknownCount} unknown event record(s) were ignored.`,
    });
  }

  const modelChoices = [...usedModels].map(chooseEncoding);
  const encodings = [...new Set(modelChoices.map((choice) => choice.name))];
  const encodingFallback = modelChoices.some((choice) => choice.fallback);
  if (encodingFallback) {
    warnings.push({
      code: "encoding_fallback",
      message: "At least one unknown model was tokenized with the o200k_base fallback.",
    });
  }

  return {
    file,
    session_id: sessionId,
    timestamp,
    cli_version: cliVersion,
    cwd,
    turns: turnList,
    steps: turnList.flatMap((turn) => turn.model_steps).sort((a, b) => a.index - b.index),
    items,
    accounting,
    warnings,
    unknown_event_types: unknownEventTypes,
    malformed_lines: malformedLines,
    reset_markers: resetMarkers,
    compacted_events: compactedEvents,
    encoding: encodings.length ? encodings.join(",") : "o200k_base",
    encoding_fallback: encodingFallback,
  };
}
