/**
 * 聊天输入区的「显性调用外部能力」面板。
 *
 * 设计目标（用户反馈）：MCP 工具不能只赌模型自觉发起 tool_call，
 * 必须有一个用户可见的调用入口：
 *   1. 输入区按钮 / 斜杠命令 `/tool` 打开本面板；
 *   2. 面板列出当前已启用且已连通的外部来源工具；
 *   3. 用草稿文本自动匹配工具并预填主参数（"自动识别匹配"）；
 *   4. 直连调用（与工作台测试沙盒同一条 testCallTool 路径），
 *      结果回填到对话，让模型基于真实结果继续写作。
 */
import React from "react";
import { ChevronDown, ChevronRight, Loader2, Play, Sparkles, X } from "lucide-react";
import { externalSourceUseCases } from "../../application/externalSources/externalSourceUseCases";
import type { IExternalSourceRuntimeService } from "../../application/serviceContracts";
import type { ExternalToolDescriptor } from "../../domain/externalSources/contracts";

export interface ExternalToolInvocationTarget {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly tool: ExternalToolDescriptor;
}

export interface ExternalToolInvocationPayload {
  readonly target: ExternalToolInvocationTarget;
  readonly input: Record<string, unknown>;
  readonly query: string;
  readonly resultText: string;
  readonly durationMs: number;
}

interface ExternalToolInvocationSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 打开时带入的输入框草稿：用于自动匹配工具并预填查询。 */
  readonly seedText?: string;
  readonly getRuntime: () => IExternalSourceRuntimeService | null;
  readonly onConfirm: (payload: ExternalToolInvocationPayload) => Promise<void>;
  readonly showAlert: (message: string, title?: string) => Promise<void> | void;
}

/** 送入对话的工具结果最大长度；超出即截断，避免一次调用撑爆上下文。 */
export const EXTERNAL_TOOL_RESULT_MAX_CHARS = 6000;

const PREFERRED_ARGUMENT_KEYS = [
  "query",
  "prompt",
  "question",
  "q",
  "search",
  "keyword",
  "keywords",
  "text",
  "url",
  "topic",
] as const;

/** 从工具的 JSON Schema 推导"用户查询"应写入哪个参数。 */
export function resolvePrimaryArgumentKey(
  schema: Readonly<Record<string, unknown>> | undefined,
): string | null {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const propertyMap = properties as Record<string, unknown>;
  const keys = Object.keys(propertyMap);
  for (const candidate of PREFERRED_ARGUMENT_KEYS) {
    if (keys.includes(candidate)) return candidate;
  }
  for (const key of keys) {
    const descriptor = propertyMap[key];
    if (descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)
      && (descriptor as { type?: unknown }).type === "string") {
      return key;
    }
  }
  return keys[0] ?? null;
}

/** 把工具返回值转成可读文本。 */
export function stringifyExternalToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/** 组装送入对话的工具结果消息（模型与用户都能看到）。 */
export function formatExternalToolResultForConversation(
  payload: ExternalToolInvocationPayload,
): string {
  const raw = payload.resultText;
  const truncated = raw.length > EXTERNAL_TOOL_RESULT_MAX_CHARS
    ? `${raw.slice(0, EXTERNAL_TOOL_RESULT_MAX_CHARS)}\n…（结果过长已截断）`
    : raw;
  const args = JSON.stringify(payload.input);
  const cost = Number.isFinite(payload.durationMs) ? `，耗时 ${payload.durationMs}ms` : "";
  return [
    `【外部能力结果 · ${payload.target.sourceName}/${payload.target.tool.localName}】${cost}`,
    `调用参数：${args}`,
    "结果：",
    truncated,
  ].join("\n");
}

interface ToolGroup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly tools: readonly ExternalToolDescriptor[];
}

export const ExternalToolInvocationSheet: React.FC<ExternalToolInvocationSheetProps> = ({
  open,
  onClose,
  seedText,
  getRuntime,
  onConfirm,
  showAlert,
}) => {
  const [groups, setGroups] = React.useState<ToolGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<ExternalToolInvocationTarget | null>(null);
  const [query, setQuery] = React.useState("");
  const [argsJson, setArgsJson] = React.useState("{}");
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [executing, setExecuting] = React.useState(false);
  const primaryKey = React.useMemo(
    () => resolvePrimaryArgumentKey(selected?.tool.inputSchema),
    [selected],
  );

  const selectTool = React.useCallback((
    target: ExternalToolInvocationTarget,
    nextQuery: string,
  ) => {
    setSelected(target);
    setQuery(nextQuery);
    const key = resolvePrimaryArgumentKey(target.tool.inputSchema);
    setArgsJson(JSON.stringify(key ? { [key]: nextQuery } : {}, null, 2));
  }, []);

  // 打开时加载"已启用且已连通"的来源与工具。快照来自运行时内存缓存，不发网络请求。
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const runtime = getRuntime();
        const sources = await externalSourceUseCases.list();
        const enabled = sources.filter((source) => source.enabled);
        const nextGroups: ToolGroup[] = [];
        for (const source of enabled) {
          const snapshot = runtime?.getSnapshot(source.id) ?? null;
          const tools = [...(snapshot?.tools ?? [])];
          if (tools.length > 0) {
            nextGroups.push({ sourceId: source.id, sourceName: source.displayName, tools });
          }
        }
        if (cancelled) return;
        setGroups(nextGroups);

        // 自动匹配：草稿文本里出现来源名 / 工具名 / 全局名时直接选中该工具；
        // 只有一个工具时也直接选中（省一次点击）。
        const seed = (seedText ?? "").trim();
        const all = nextGroups.flatMap((group) => group.tools.map((tool) => ({
          target: { sourceId: group.sourceId, sourceName: group.sourceName, tool },
          group,
        })));
        if (all.length === 0) {
          setSelected(null);
          return;
        }
        const lowered = seed.toLowerCase();
        const matched = all.find(({ target, group }) => {
          const candidates = [
            target.tool.localName,
            target.tool.qualifiedName,
            group.sourceName,
            target.sourceId,
          ].map((value) => value.toLowerCase());
          return candidates.some((value) => value.length > 1 && lowered.includes(value));
        });
        const chosen = matched ?? (all.length === 1 ? all[0] : null);
        if (!chosen) {
          setSelected(null);
          return;
        }
        const cleaned = matched
          ? seed
            .replace(new RegExp(matched.target.tool.localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
            .replace(new RegExp(matched.group.sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
            .trim()
          : seed;
        selectTool(chosen.target, cleaned);
      } catch (error: unknown) {
        if (!cancelled) {
          console.warn("[ExternalToolInvocationSheet] 加载外部能力失败", error);
          setGroups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getRuntime, open, seedText, selectTool]);

  // 关闭时重置，避免下次打开残留上一次的选中状态。
  React.useEffect(() => {
    if (open) return;
    setSelected(null);
    setQuery("");
    setArgsJson("{}");
    setShowAdvanced(false);
    setExecuting(false);
  }, [open]);

  if (!open) return null;

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (!selected) return;
    const key = resolvePrimaryArgumentKey(selected.tool.inputSchema);
    if (!key) return;
    try {
      const parsed = JSON.parse(argsJson) as Record<string, unknown>;
      setArgsJson(JSON.stringify({ ...parsed, [key]: value }, null, 2));
    } catch {
      setArgsJson(JSON.stringify({ [key]: value }, null, 2));
    }
  };

  const handleExecute = async () => {
    if (!selected || executing) return;
    const runtime = getRuntime();
    if (!runtime) {
      await showAlert("外部能力运行时未就绪，无法调用。", "调用失败");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(argsJson);
      parsed = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    } catch (error: unknown) {
      await showAlert(
        `参数 JSON 格式错误：${error instanceof Error ? error.message : String(error)}`,
        "调用失败",
      );
      return;
    }
    if (primaryKey && query.trim()) parsed[primaryKey] = query.trim();
    setExecuting(true);
    try {
      const response = await runtime.testCallTool(
        selected.sourceId,
        selected.tool.localName,
        parsed,
      );
      await onConfirm({
        target: selected,
        input: parsed,
        query: query.trim(),
        resultText: stringifyExternalToolResult(response.result),
        durationMs: response.durationMs,
      });
      onClose();
    } catch (error: unknown) {
      await showAlert(
        `调用 ${selected.tool.localName} 失败：${error instanceof Error ? error.message : String(error)}`,
        "调用失败",
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[86dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <div>
              <h4 className="text-sm font-bold text-foreground">调用外部能力</h4>
              <p className="text-[10px] text-muted-foreground">显式调用已启用的 MCP 工具，结果直接送入对话</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭能力调用面板"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取已启用的能力…
            </div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              还没有已启用并连通的 MCP 工具。
              <br />
              请先到工作台「扩展能力」里启用一个来源。
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <section key={group.sourceId} className="space-y-1.5">
                  <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">
                    {group.sourceName}
                  </p>
                  <div className="space-y-1.5">
                    {group.tools.map((tool) => {
                      const active = selected?.tool.qualifiedName === tool.qualifiedName;
                      return (
                        <button
                          key={tool.qualifiedName}
                          type="button"
                          onClick={() => selectTool(
                            { sourceId: group.sourceId, sourceName: group.sourceName, tool },
                            query,
                          )}
                          className={`w-full rounded-xl border p-2.5 text-left transition-all ${
                            active
                              ? "border-cyan-400/50 bg-cyan-500/10"
                              : "border-white/10 bg-white/5 hover:bg-white/10"
                          }`}
                        >
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {tool.localName}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-[10px] text-muted-foreground">
                            {tool.description || "无描述"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}

              {selected && (
                <div className="space-y-2 rounded-xl border border-cyan-400/25 bg-cyan-500/5 p-3">
                  <p className="text-[11px] font-semibold text-cyan-200">
                    已选择：{selected.sourceName} / {selected.tool.localName}
                  </p>
                  <label className="block text-[10px] text-muted-foreground">
                    {primaryKey ? `查询内容（写入参数 ${primaryKey}）` : "查询内容（该工具没有可识别的文本参数，请在下方直接编辑 JSON）"}
                  </label>
                  <textarea
                    value={query}
                    onChange={(event) => handleQueryChange(event.target.value)}
                    rows={2}
                    placeholder="例如：2001 年发生了什么大事"
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-foreground outline-none focus:border-cyan-400/40"
                  />

                  <button
                    type="button"
                    onClick={() => setShowAdvanced((prev) => !prev)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    高级：直接编辑参数 JSON
                  </button>
                  {showAdvanced && (
                    <textarea
                      value={argsJson}
                      onChange={(event) => setArgsJson(event.target.value)}
                      rows={5}
                      spellCheck={false}
                      className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-foreground outline-none focus:border-cyan-400/40"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selected || executing}
            onClick={() => void handleExecute()}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {executing ? "调用中…" : "调用并送入对话"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ExternalToolInvocationSheet;
