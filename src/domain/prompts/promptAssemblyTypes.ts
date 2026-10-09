/**
 * Prompt 组装期共用的中立类型。
 *
 * 这里只描述"发给模型的请求消息"与"组装诊断"两类形状，不承载任何来源生态语义。
 * （自由编排时期的 `PromptComposition*` 类型随编排路径一起删除，通用部分收敛到本文件。）
 */

export type PromptMessageRole = "system" | "user" | "assistant";

export interface PromptMessage {
  id?: string;
  role: PromptMessageRole;
  name?: string;
  content: string;
}

export type PromptDiagnosticLevel = "info" | "warning" | "error";

/** 导入/导出与组装过程的可读诊断条目。 */
export interface PromptDiagnostic {
  level: PromptDiagnosticLevel;
  code: string;
  message: string;
}

/** 兼容操作的诊断汇总：两类都只用于展示与排障。 */
export interface CompatibilityReport {
  warnings: PromptDiagnostic[];
  errors: PromptDiagnostic[];
}

/** 组装轨迹条目；传统路径当前只产出空数组，形状保留给审计消费方。 */
export interface PromptAssemblyTrace {
  id: string;
  label?: string;
  detail?: string;
}
