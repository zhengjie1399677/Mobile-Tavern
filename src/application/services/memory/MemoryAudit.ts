import type { ChatSession, UserSettings } from "../../../types";
import type { PromptCompositionTrace } from "../../../domain/prompt-composition";
import type {
  MemoryAuditSnapshot,
  MemoryPacketSourceAudit,
  RecalledMessage,
} from "./types";

interface BuildMemoryAuditParams {
  session: ChatSession;
  query: string;
  recalled: RecalledMessage[];
  settings: UserSettings;
  traces?: PromptCompositionTrace[];
  estimateTokens: (text: string) => number;
}

const SOURCE_LABELS: Record<MemoryPacketSourceAudit["key"], string> = {
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
    sources,
    totalEstimatedTokens: sources.reduce((total, source) => total + source.estimatedTokens, 0),
  };
}
