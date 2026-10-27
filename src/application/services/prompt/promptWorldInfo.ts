import type { CharacterCard, ChatSession, LorebookEntry, Message, UserSettings } from "../../../types";
import type { ICompatibilityRuntimeService } from "../../compatibility/contracts";
import { resolveTriggeredLorebookEntries } from "./LorebookResolver";
import { createLorebookSessionContext } from "./PromptAssemblySupport";
import { resolveWorldInfoBudgetForSettings } from "./worldInfoBudget";
import { createLorebookAuditReport, type LorebookAuditReport } from "../../../domain/lorebookAudit";

type WorldInfoResolver = NonNullable<ReturnType<ICompatibilityRuntimeService["getWorldInfoResolver"]>>;

export interface WorldInfoMatchBudget {
  maxRecursionDepth?: number;
  conditionContext?: { variables?: Record<string, unknown>; session?: Record<string, unknown> };
  budgetChars: number;
  audit?: LorebookAuditReport;
}

/**
 * 按当前分辨率与预算触发世界书。
 * 兼容插件启用时走 SillyTavern 语义（sticky / 递归 / selective），否则走通用解析器；
 * 两条路径的命中与裁剪原因都写入同一个审计报告。
 */
export function matchWorldInfoEntries(
  messages: Message[],
  userInput: string,
  entries: LorebookEntry[],
  budget: WorldInfoMatchBudget,
  resolver: WorldInfoResolver | null,
): LorebookEntry[] {
  const { maxRecursionDepth = 3, conditionContext = {}, budgetChars, audit } = budget;
  if (resolver) {
    return [...resolver.resolve({
      messages,
      userInput,
      entries,
      maxRecursionDepth,
      budgetChars,
      conditionContext,
      ...(audit ? { audit } : {}),
    })];
  }
  return resolveTriggeredLorebookEntries(
    messages,
    userInput,
    entries,
    maxRecursionDepth,
    conditionContext,
    budgetChars,
    audit,
  );
}

export interface TurnWorldInfoInput {
  character: CharacterCard;
  chat: ChatSession;
  userInput: string;
  settings: UserSettings;
  globalLorebook: LorebookEntry[];
  resolver: WorldInfoResolver | null;
  variables?: Record<string, unknown>;
}

/**
 * 合并角色世界书与全局世界书并解析本轮命中条目。
 * 审计报告与命中使用同一份预算，避免「面板显示 6000、实际按分辨率裁剪」的口径不一致。
 */
export function resolveTurnWorldInfo(input: TurnWorldInfoInput): {
  entries: LorebookEntry[];
  allEntries: LorebookEntry[];
  report: LorebookAuditReport;
} {
  const { character, chat, userInput, settings, globalLorebook, resolver, variables } = input;
  const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
  const budgetChars = resolveWorldInfoBudgetForSettings(settings);
  const report = createLorebookAuditReport(budgetChars, allEntries.length);
  const entries = matchWorldInfoEntries(
    chat.messages || [],
    userInput,
    allEntries,
    {
      maxRecursionDepth: 3,
      conditionContext: { variables, session: createLorebookSessionContext(chat) },
      budgetChars,
      audit: report,
    },
    resolver,
  );
  return { entries, allEntries, report };
}
