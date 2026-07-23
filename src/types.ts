export const SCHEMA_VERSION = "1.0.0";

export type ItemCategory =
  | "instructions"
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_output";

export type Confidence = "high" | "medium" | "low";

export interface TokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface Accounting extends TokenUsage {
  model_steps: number;
  turns: number;
}

export interface CategoryTokens {
  instructions: number;
  user: number;
  assistant: number;
  tool_call: number;
  tool_output: number;
}

export interface InternalContextItem {
  id: string;
  category: ItemCategory;
  tokens: number;
  timestamp?: string;
  turn_id?: string;
  model?: string;
  available_from_step: number;
  retired_at_step?: number;
  retained_steps: number;
  retained_context_load: number;
  call_id?: string;
  tool_name?: string;
  target?: string;
  target_source?: "structured" | "shell";
  operation?: "read" | "mutation" | "other";
  normalized_hash?: string;
  line_hashes?: string[];
  line_count?: number;
  snippet?: string;
  sequence: number;
}

export interface ModelStep {
  index: number;
  turn_id: string;
  model: string;
  accounting: TokenUsage;
  visible_tokens: number;
  visible_by_category: CategoryTokens;
  unattributed_input_tokens: number;
  visible_overage_tokens: number;
  coverage_ratio: number;
  reconstruction_confidence: Confidence;
}

export interface Turn {
  id: string;
  model: string;
  model_steps: ModelStep[];
}

export interface ParseWarning {
  code: string;
  message: string;
  line?: number;
}

export interface InternalSession {
  file: string;
  session_id: string;
  timestamp?: string;
  cli_version?: string;
  cwd?: string;
  turns: Turn[];
  steps: ModelStep[];
  items: InternalContextItem[];
  accounting: Accounting;
  warnings: ParseWarning[];
  unknown_event_types: Record<string, number>;
  malformed_lines: number;
  reset_markers: number;
  compacted_events: number;
  encoding: string;
  encoding_fallback: boolean;
}

export interface Finding {
  id: string;
  kind: "duplicate_output" | "similar_output" | "large_output";
  severity: "info" | "warning";
  confidence: Confidence;
  evidence: {
    occurrences?: number;
    target?: string;
    estimated_tokens_each?: number[];
    estimated_avoidable_context_load?: number;
    overlap_ratio?: number;
    mutation_between_reads?: boolean;
    snippet?: string;
  };
  message: string;
}

export interface Recommendation {
  id: string;
  kind: "workflow" | "agents_rule_candidate";
  confidence: Confidence;
  evidence: string;
  estimated_avoidable_context_load: number;
  message: string;
  session_count?: number;
}

export interface PublicItem {
  id: string;
  category: ItemCategory;
  estimated_tokens: number;
  retained_steps: number;
  retained_context_load: number;
  turn_id?: string;
  target?: string;
  snippet?: string;
}

export interface SessionReport {
  schema_version: typeof SCHEMA_VERSION;
  session: {
    id: string;
    timestamp?: string;
    cli_version?: string;
    cwd?: string;
    rollout_file: string;
    turns: number;
    model_steps: number;
  };
  accounting: Accounting;
  coverage: {
    estimated_visible_input_tokens: number;
    unattributed_input_tokens: number;
    visible_overage_tokens: number;
    ratio: number;
    reconstruction_confidence: Confidence;
    encoding: string;
    encoding_fallback: boolean;
  };
  turns: Array<{
    id: string;
    model: string;
    model_steps: ModelStep[];
  }>;
  top_retained_context: PublicItem[];
  findings: Finding[];
  recommendations: Recommendation[];
  warnings: ParseWarning[];
}

export interface MultiSessionReport {
  schema_version: typeof SCHEMA_VERSION;
  generated_at: string;
  session_count: number;
  accounting: Accounting;
  coverage: SessionReport["coverage"];
  findings: Finding[];
  recommendations: Recommendation[];
  warnings: ParseWarning[];
  sessions: SessionReport[];
}

export interface SummaryWarning extends ParseWarning {
  session_id: string;
}

export interface SummaryReport {
  schema_version: typeof SCHEMA_VERSION;
  report_kind: "summary";
  generated_at: string;
  session_count: number;
  current_session_exclusion: {
    requested: boolean;
    session_id?: string;
    found: boolean;
    excluded: boolean;
  };
  accounting: Accounting;
  coverage: SessionReport["coverage"];
  visible_by_category: CategoryTokens;
  findings: {
    total: number;
    by_kind: Record<Finding["kind"], number>;
    by_confidence: Record<Confidence, number>;
  };
  recommendations: Recommendation[];
  warnings: {
    count: number;
    examples: SummaryWarning[];
  };
  top_costliest_sessions: Array<{
    session_id: string;
    timestamp?: string;
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    retained_context_load: number;
  }>;
  top_retained_context: Array<
    Omit<PublicItem, "snippet"> & {
      session_id: string;
    }
  >;
}
