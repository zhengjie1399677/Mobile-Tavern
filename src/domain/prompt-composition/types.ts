export type PromptMessageRole = "system" | "user" | "assistant";

export interface PromptMessage {
  role: PromptMessageRole;
  content: string;
  name?: string;
}

export type PromptHistorySelection =
  | { mode: "all" }
  | { mode: "recent"; count: number; preserveFirstAssistant: boolean };

export type PromptBlockSource =
  | { type: "template" }
  | { type: "chat_history"; selection?: PromptHistorySelection };

export type PromptBlockPlacement =
  | { type: "ordered" }
  | { type: "in_chat"; depth: number; order?: number; historyBlockId?: string };

export interface PromptBlockCondition {
  dataKey: string;
  operator: "not_empty" | "empty" | "equals" | "not_equals";
  value?: string;
}

export interface PromptBlockTokenPolicy {
  priority: number;
  overflow: "keep" | "drop";
}

export interface PromptBlockCompatibilityMetadata {
  /** 外部格式标识仅作为不透明元数据；领域层不解释其语义。 */
  source: string;
  originalIdentifier?: string;
  originalFields?: Record<string, unknown>;
}

export interface PromptBlock {
  id: string;
  name: string;
  enabled: boolean;
  role: PromptMessageRole;
  source: PromptBlockSource;
  template: string;
  order: number;
  placement: PromptBlockPlacement;
  condition?: PromptBlockCondition;
  tokenPolicy?: PromptBlockTokenPolicy;
  compatibility?: PromptBlockCompatibilityMetadata;
}

export interface PromptCompositionCompatibilityMetadata {
  /** 外部格式标识仅作为不透明元数据；领域层不解释其语义。 */
  source: string;
  sourceVersion?: string;
  originalName?: string;
  preservedRootFields?: Record<string, unknown>;
}

export interface PromptComposition {
  id: string;
  name: string;
  version: 1;
  blocks: PromptBlock[];
  compatibility?: PromptCompositionCompatibilityMetadata;
}

export interface PromptCompositionRuntimeData {
  values: Record<string, string>;
  history: PromptMessage[];
}

export type PromptCompositionDiagnosticLevel = "info" | "warning" | "error";

export interface PromptCompositionDiagnostic {
  level: PromptCompositionDiagnosticLevel;
  code: string;
  message: string;
  blockId?: string;
  detail?: string;
}

export interface CompiledPromptComposition {
  messages: PromptMessage[];
  diagnostics: PromptCompositionDiagnostic[];
}

export interface CompatibilityReport {
  warnings: PromptCompositionDiagnostic[];
  errors: PromptCompositionDiagnostic[];
}
