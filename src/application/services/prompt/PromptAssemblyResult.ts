import type {
  PromptCompositionBudgetReport,
  PromptCompositionTrace,
} from "../../../domain/prompt-composition";

export interface PromptAssemblyResult {
  systemInstruction: string;
  history: Array<{
    role: "model" | "user" | "assistant";
    name?: string;
    content: string;
  }>;
  dynamicInstruction: string;
  userInput?: string;
  messages?: Array<{
    role: "system" | "user" | "assistant";
    name?: string;
    content: string;
  }>;
  diagnostics?: Array<{
    level: "info" | "warning" | "error";
    code: string;
    message: string;
    blockId?: string;
    detail?: string;
  }>;
  traces?: PromptCompositionTrace[];
  budget?: PromptCompositionBudgetReport;
}
