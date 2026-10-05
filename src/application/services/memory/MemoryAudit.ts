import type { ChatSession, UserSettings } from "../../../types";
import type { PromptCompositionTrace } from "../../../domain/prompt-composition";
import type {
  MemoryAuditSnapshot,
  MemoryPacketSourceAudit,
  RecalledMessage,
} from "./types";
import type { ContextContribution } from "../../../domain/contextSources/contracts";

interface BuildMemoryAuditParams {
  session: ChatSession;
  query: string;
  recalled: RecalledMessage[];
  settings: UserSettings;
  traces?: PromptCompositionTrace[];
  estimateTokens: (text: string) => number;
  /** 通用上下文贡献（记忆之外的来源）；未接入时为空数组，行为与泛化前一致。 */
  contextContributions?: readonly ContextContribution[];
}

const SOURCE_LABELS: Record<string, string> = {
  "memory.summaries": "剧情摘要",
  "memory.recalled": "唤醒记忆",
  "memory.tables": "状态数据",
};

/** 根据 Prompt 编排轨迹生成只读审计快照，不把运行时结果写入 ChatSession。 */
export function buildMemoryAuditSnapshot(params: BuildMemoryAuditParams): MemoryAuditSnapshot {
  const summaries = (params.session.summaries ?? [])
    .map((item) => `[${item.timeTag} | ${item.location}] ${item.content}`)
    .join("\n");
  const recalled = params.recalled.map((item) => item.content).join("\n\n");
  const enabledTables = (params.session.tableMemory ?? []).filter((sheet) => sheet.enable !== false);
  const tables = enabledTables.map((sheet) => [
    sheet.name,
    sheet.description ?? "",
    sheet.columns.join("|"),
    ...sheet.rows.map((row) => row.join("|")),
  ].filter(Boolean).join("\n")).join("\n\n");

  const sourceValues: Array<{
    key: MemoryPacketSourceAudit["key"];
    content: string;
    count: number;
  }> = [
    { key: "memory.summaries", content: summaries, count: params.session.summaries?.length ?? 0 },
    { key: "memory.recalled", content: recalled, count: params.recalled.length },
    { key: "memory.tables", content: tables, count: enabledTables.length },
  ];

  const usingComposition = params.settings.promptConfig?.usePromptComposition === true;
  const sources = sourceValues.map(({ key, content, count }): MemoryPacketSourceAudit => {
    const matchingTraces = (params.traces ?? []).filter((trace) => trace.resolvedDataKeys.includes(key));
    const included = usingComposition
      ? matchingTraces.some((trace) => !trace.dropped)
      : content.length > 0 && (key !== "memory.tables" || params.settings.enableTableMemory !== false);
    return {
      key,
      label: SOURCE_LABELS[key],
      included,
      count,
      characters: content.length,
      estimatedTokens: included ? params.estimateTokens(content) : 0,
      dropped: usingComposition && matchingTraces.length > 0
        ? matchingTraces.every((trace) => trace.dropped)
        : undefined,
    };
  });

  return {
    sessionId: params.session.id,
    query: params.query,
    createdAt: Date.now(),
    recalled: params.recalled,
    sources: [...sources, ...buildContextSourceAudits(params)],
    totalEstimatedTokens: [...sources, ...buildContextSourceAudits(params)]
      .reduce((total, source) => total + source.estimatedTokens, 0),
  };
}

/** 记忆数据源已由内建条目呈现，此处只补记忆之外的上下文贡献。 */
const BUILTIN_MEMORY_KEYS = new Set(["memory.summaries", "memory.recalled", "memory.tables"]);

/**
 * 上下文审计泛化：任何通过通用来源缝进入提示词的贡献都出现在同一列表里，
 * 复用既有 UI 入口（记忆抽屉按 `sources` 渲染），无需为每个来源新建审计体系。
 */
function buildContextSourceAudits(params: BuildMemoryAuditParams): MemoryPacketSourceAudit[] {
  const usingComposition = params.settings.promptConfig?.usePromptComposition === true;
  return (params.contextContributions ?? [])
    .filter((item: ContextContribution) => !BUILTIN_MEMORY_KEYS.has(item.macroName))
    .map((item: ContextContribution): MemoryPacketSourceAudit => {
      const matchingTraces = (params.traces ?? [])
        .filter((trace) => trace.resolvedDataKeys.includes(item.macroName));
      const contributed = item.status === "ok" || item.status === "truncated";
      const included = contributed
        ? usingComposition
          ? matchingTraces.some((trace) => !trace.dropped)
          : true
        : false;
      return {
        key: item.macroName,
        label: SOURCE_LABELS[item.macroName] ?? item.macroName,
        included,
        count: item.status === "empty" ? 0 : 1,
        characters: item.characters,
        estimatedTokens: included ? params.estimateTokens(item.content) : 0,
        dropped: usingComposition && matchingTraces.length > 0
          ? matchingTraces.every((trace) => trace.dropped)
          : undefined,
      };
    });
}
