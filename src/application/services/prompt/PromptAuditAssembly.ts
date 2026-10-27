/**
 * 把 PromptService 的组装结果与世界书解析审计合并成「本轮提示词」快照。
 *
 * 抽成独立模块，既让 PromptService 保持单一职责与行数预算，
 * 也便于用纯函数单测覆盖快照字段（来源、触发原因、分区尺寸）。
 */
import type { LorebookEntry } from "../../../types";
import {
  buildPromptAuditSnapshot,
  type PromptAuditSection,
  type PromptAuditSnapshot,
} from "../../../domain/promptAudit";
import type { LorebookAuditReport } from "../../../domain/lorebookAudit";
import type { PromptAssemblyResult } from "./PromptAssemblyResult";

export interface BuildTurnPromptAuditInput {
  sessionId: string;
  generationType?: string;
  report: LorebookAuditReport;
  /** 参与解析的全部条目（角色书 + 全局书）。 */
  allEntries: readonly LorebookEntry[];
  /** 角色专属世界书条目，用于标注注入来源。 */
  characterEntries?: readonly LorebookEntry[];
  sections: readonly PromptAuditSection[];
  systemInstruction: string;
  history: ReadonlyArray<{ content: string }>;
  userInput?: string;
  capturedAt?: number;
}

export function buildTurnPromptAudit(input: BuildTurnPromptAuditInput): PromptAuditSnapshot {
  const characterEntryIds = new Set(
    (input.characterEntries ?? []).map((entry) => entry.id),
  );
  return buildPromptAuditSnapshot({
    sessionId: input.sessionId,
    capturedAt: input.capturedAt ?? Date.now(),
    ...(input.generationType ? { generationType: input.generationType } : {}),
    report: input.report,
    allEntries: input.allEntries,
    characterEntryIds,
    sections: input.sections,
    systemChars: input.systemInstruction.length,
    historyChars: input.history.reduce((sum, item) => sum + item.content.length, 0),
    userInputChars: (input.userInput ?? "").length,
  });
}

/** 以组装结果为底，附上本轮审计；调用方无需重复传 systemInstruction / history / userInput。 */
export function withTurnAudit(
  result: PromptAssemblyResult,
  input: Omit<BuildTurnPromptAuditInput, "systemInstruction" | "history" | "userInput">,
): PromptAssemblyResult {
  return {
    ...result,
    audit: buildTurnPromptAudit({
      ...input,
      systemInstruction: result.systemInstruction,
      history: result.history,
      userInput: result.userInput ?? "",
    }),
  };
}
