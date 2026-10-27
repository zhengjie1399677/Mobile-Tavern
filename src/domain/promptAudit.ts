/**
 * 「本轮提示词审计」快照：把一次 Prompt 组装的世界书命中与最终 System Prompt
 * 各分区尺寸收敛成可展示的只读结构。
 *
 * 该快照只存在于聊天运行时的瞬态状态（useChat），不写入 ChatSession，
 * 避免把大段提示词正文持久化进用户数据。
 */
import type { LorebookEntry } from "../types";
import type { LorebookAuditReport } from "./lorebookAudit";

/** 单个分区正文的展示上限，超出部分截断，避免快照撑爆内存与渲染。 */
export const PROMPT_AUDIT_SECTION_MAX_CHARS = 120_000;

export type PromptAuditLorebookSource = "character" | "global";

export interface PromptAuditLorebookEntry {
  id: string;
  title: string;
  source: PromptAuditLorebookSource;
  trigger: "constant" | "sticky" | "keyword";
  matchedKey?: string;
  keys: string[];
  chars: number;
  position?: string;
}

export interface PromptAuditSection {
  id: string;
  title: string;
  phase: string;
  chars: number;
  content: string;
}

export interface PromptAuditSnapshot {
  version: 1;
  sessionId: string;
  capturedAt: number;
  generationType?: string;
  lorebook: {
    budgetChars: number;
    candidateCount: number;
    entries: PromptAuditLorebookEntry[];
    budgetDropped: Array<{ id: string; title: string; chars: number }>;
  };
  prompt: {
    sections: PromptAuditSection[];
    systemChars: number;
    historyChars: number;
    userInputChars: number;
  };
}

export interface BuildPromptAuditSnapshotInput {
  sessionId: string;
  capturedAt: number;
  generationType?: string;
  report: LorebookAuditReport;
  /** 参与本轮解析的全部条目（角色书 + 全局书）。 */
  allEntries: readonly LorebookEntry[];
  /** 角色专属世界书的条目 id 集合，用于区分注入来源。 */
  characterEntryIds: ReadonlySet<string>;
  sections: readonly PromptAuditSection[];
  systemChars: number;
  historyChars: number;
  userInputChars: number;
}

/** 运行时可能遇到历史数据里 keys 存成字符串 / 对象，展示层统一读成字符串数组。 */
function readKeyList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((key): key is string => typeof key === "string").map((key) => key.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((key) => key.trim()).filter(Boolean);
  }
  if (raw && typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .filter((key): key is string => typeof key === "string")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  return [];
}

function entryTitle(entry: LorebookEntry): string {
  const comment = typeof entry.comment === "string" ? entry.comment.trim() : "";
  if (comment) return comment;
  const firstKey = readKeyList(entry.keys)[0];
  if (firstKey) return firstKey;
  return entry.id;
}

export function truncatePromptAuditText(text: string): string {
  if (text.length <= PROMPT_AUDIT_SECTION_MAX_CHARS) return text;
  return `${text.slice(0, PROMPT_AUDIT_SECTION_MAX_CHARS)}\n…（已截断，共 ${text.length} 字符）`;
}

export function buildPromptAuditSnapshot(input: BuildPromptAuditSnapshotInput): PromptAuditSnapshot {
  const byId = new Map<string, LorebookEntry>();
  for (const entry of input.allEntries) byId.set(entry.id, entry);

  const entries: PromptAuditLorebookEntry[] = [];
  for (const hit of input.report.hits) {
    const entry = byId.get(hit.entryId);
    if (!entry) continue;
    entries.push({
      id: entry.id,
      title: entryTitle(entry),
      source: input.characterEntryIds.has(entry.id) ? "character" : "global",
      trigger: hit.trigger,
      ...(hit.matchedKey ? { matchedKey: hit.matchedKey } : {}),
      keys: readKeyList(entry.keys),
      chars: entry.content?.length ?? 0,
      ...(entry.position ? { position: entry.position } : {}),
    });
  }

  const budgetDropped = input.report.budgetDropped.map((drop) => {
    const entry = byId.get(drop.entryId);
    return {
      id: drop.entryId,
      title: entry ? entryTitle(entry) : drop.entryId,
      chars: drop.chars,
    };
  });

  return {
    version: 1,
    sessionId: input.sessionId,
    capturedAt: input.capturedAt,
    ...(input.generationType ? { generationType: input.generationType } : {}),
    lorebook: {
      budgetChars: input.report.budgetChars,
      candidateCount: input.report.candidateCount,
      entries,
      budgetDropped,
    },
    prompt: {
      sections: input.sections.map((section) => ({
        ...section,
        content: truncatePromptAuditText(section.content),
      })),
      systemChars: input.systemChars,
      historyChars: input.historyChars,
      userInputChars: input.userInputChars,
    },
  };
}
