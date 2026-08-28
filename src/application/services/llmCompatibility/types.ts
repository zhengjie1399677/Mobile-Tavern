export interface ModelCapabilities {
  supportsTopK: boolean;
  supportsTopP: boolean;
  supportsTemperature: boolean;
  supportsJsonSchema: boolean;
  supportsFunctionCalling: boolean;
  supportsStream: boolean;
  supportsSystemPrompt: boolean;
  supportsMinP?: boolean;
  supportsRepetitionPenalty?: boolean;
  supportsStreamOptions?: boolean;
  contextWindow?: number;
  preferredFormat?: "xml" | "markdown";
  maxTemperature?: number;
  usesMaxCompletionTokens?: boolean;
}

export interface LLMParams extends Record<string, unknown> {
  top_k?: number;
  top_p?: number;
  temperature?: number;
  response_format?: unknown;
  functions?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  function_call?: unknown;
  stream_options?: unknown;
  min_p?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export type ProviderFamily =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "glm"
  | "qwen"
  | "other";

export interface ProviderIdentity {
  family: ProviderFamily;
  origin: string;
  scopeKey: string;
  official: boolean;
}

export interface UnsupportedProviderParameter {
  capability?: keyof ModelCapabilities;
  /** @deprecated 旧调用方兼容别名。 */
  param?: keyof ModelCapabilities;
  requestFields: readonly string[];
}
