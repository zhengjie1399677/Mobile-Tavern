import type {
  PromptCompositionBudgetReport,
  PromptCompositionDiagnostic,
  PromptCompositionTrace,
  PromptMessage,
} from "../../../domain/prompt-composition";
import type { PromptRequestShapingReport } from "./PromptRequestShaper";

/** Provider 投影前唯一权威的 Prompt 消息包。 */
export interface PromptEnvelope {
  version: 1;
  messages: PromptMessage[];
  diagnostics: PromptCompositionDiagnostic[];
  traces: PromptCompositionTrace[];
  budget?: PromptCompositionBudgetReport;
  stopSequences?: string[];
  requestShaping: PromptRequestShapingReport;
}

/**
 * PromptService 过渡期返回类型。
 * `messages` 是唯一权威；其余三项仅供旧预览与审计调用方读取，不得再用于组装请求。
 */
export interface PromptAssemblyResult {
  /** 本次生成成功后随消息事务提交的插件状态增量；预览不持久化。 */
  runtimePluginStatePatch?: Record<string, Record<string, unknown>>;
  version: 1;
  systemInstruction: string;
  history: Array<{
    role: "model" | "user" | "assistant";
    name?: string;
    content: string;
  }>;
  dynamicInstruction: string;
  userInput?: string;
  messages: PromptEnvelope["messages"];
  diagnostics: PromptEnvelope["diagnostics"];
  traces: PromptEnvelope["traces"];
  budget?: PromptCompositionBudgetReport;
  stopSequences?: string[];
  requestShaping: PromptRequestShapingReport;
}
