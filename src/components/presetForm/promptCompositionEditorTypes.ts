import type {
  PromptCompositionDiagnostic,
  PromptMessage,
} from "../../domain/prompt-composition";

export interface PromptCompositionPreviewData {
  messages: PromptMessage[];
  diagnostics: PromptCompositionDiagnostic[];
  estimatedTokens: number;
  contextAvailable: boolean;
}
