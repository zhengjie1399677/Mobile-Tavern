import type {
  PromptCompositionBudgetReport,
  PromptCompositionDiagnostic,
  PromptCompositionTrace,
  PromptMessage,
} from "../../domain/prompt-composition";

export interface PromptCompositionPreviewData {
  messages: PromptMessage[];
  diagnostics: PromptCompositionDiagnostic[];
  estimatedTokens: number;
  contextAvailable: boolean;
  traces?: PromptCompositionTrace[];
  budget?: PromptCompositionBudgetReport;
}
