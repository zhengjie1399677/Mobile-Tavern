import type { PromptConfig } from "../../types";
import type { PromptCompositionDiagnostic } from "../../domain/prompt-composition";

/**
 * 预设往返（导出 → 导入）的 MT 命名空间。
 *
 * SillyTavern 文件格式无法表达本应用的运行期开关与提示词字段；若不单独保存，
 * 重新导入只能继承"当前预设"的值，导致同一文件在不同环境下得到不同预设。
 * 这里把无法被 ST 表达的部分放进 `extensions.mobile_tavern_preset`，
 * ST 侧会忽略该键，本应用导入时优先恢复。
 */

export const MOBILE_TAVERN_PRESET_EXTENSION_KEY = "mobile_tavern_preset";
export const MOBILE_TAVERN_PRESET_EXTENSION_VERSION = 1;

export type MobileTavernPromptRuntime = Partial<Pick<
  PromptConfig,
  | "roleplayMode"
  | "useMainPrompt"
  | "useJailbreak"
  | "usePostHistory"
  | "enableReasoningGuidance"
  | "reasoningGuidancePrompt"
  | "tableMemoryPrompt"
  | "sectionHeaders"
  | "renderingFormat"
>>;

export interface ParsedMobileTavernPresetExtension {
  promptRuntime?: MobileTavernPromptRuntime;
  diagnostics: PromptCompositionDiagnostic[];
}

/** 生成随预设一起导出的 MT 命名空间载荷。 */
export function buildMobileTavernPresetExtension(promptConfig: PromptConfig): Record<string, unknown> {
  return {
    version: MOBILE_TAVERN_PRESET_EXTENSION_VERSION,
    promptRuntime: {
      roleplayMode: promptConfig.roleplayMode,
      useMainPrompt: promptConfig.useMainPrompt,
      useJailbreak: promptConfig.useJailbreak,
      usePostHistory: promptConfig.usePostHistory,
      enableReasoningGuidance: promptConfig.enableReasoningGuidance,
      reasoningGuidancePrompt: promptConfig.reasoningGuidancePrompt,
      tableMemoryPrompt: promptConfig.tableMemoryPrompt,
      sectionHeaders: promptConfig.sectionHeaders,
      renderingFormat: promptConfig.renderingFormat,
    },
  };
}

/** 解析外部文件中的 MT 命名空间；未知版本只告警并忽略，不影响通用字段导入。 */
export function parseMobileTavernPresetExtension(
  extensions: unknown,
): ParsedMobileTavernPresetExtension {
  if (!isRecord(extensions)) return { diagnostics: [] };
  const raw = extensions[MOBILE_TAVERN_PRESET_EXTENSION_KEY];
  if (raw === undefined) return { diagnostics: [] };
  if (!isRecord(raw)) {
    return {
      diagnostics: [unsupportedVersionDiagnostic("MT 命名空间结构无效，已忽略。")],
    };
  }
  if (raw.version !== MOBILE_TAVERN_PRESET_EXTENSION_VERSION) {
    return {
      diagnostics: [unsupportedVersionDiagnostic(
        `MT 命名空间版本 ${String(raw.version)} 不受支持，已忽略。`,
      )],
    };
  }
  return { promptRuntime: parsePromptRuntime(raw.promptRuntime), diagnostics: [] };
}

function parsePromptRuntime(value: unknown): MobileTavernPromptRuntime | undefined {
  if (!isRecord(value)) return undefined;
  const runtime: MobileTavernPromptRuntime = {};
  const booleanKeys = [
    "roleplayMode",
    "useMainPrompt",
    "useJailbreak",
    "usePostHistory",
    "enableReasoningGuidance",
  ] as const;
  for (const key of booleanKeys) {
    if (typeof value[key] === "boolean") runtime[key] = value[key];
  }
  const stringKeys = [
    "reasoningGuidancePrompt",
    "tableMemoryPrompt",
  ] as const;
  for (const key of stringKeys) {
    if (typeof value[key] === "string") runtime[key] = value[key];
  }
  if (value.renderingFormat === "auto"
    || value.renderingFormat === "xml"
    || value.renderingFormat === "markdown") {
    runtime.renderingFormat = value.renderingFormat;
  }
  if (isRecord(value.sectionHeaders)) {
    const headers: Record<string, string> = {};
    for (const [key, header] of Object.entries(value.sectionHeaders)) {
      if (typeof header === "string") headers[key] = header;
    }
    if (Object.keys(headers).length > 0) runtime.sectionHeaders = headers;
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined;
}

function unsupportedVersionDiagnostic(message: string): PromptCompositionDiagnostic {
  return {
    level: "warning",
    code: "MT_PRESET_EXTENSION_IGNORED",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
