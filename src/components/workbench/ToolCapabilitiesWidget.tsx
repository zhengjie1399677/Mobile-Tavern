import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Wrench,
  Check,
  Power,
  ShieldCheck,
  Sparkles,
  Globe,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Plus,
  Trash2,
  Gauge,
  Play,
} from "lucide-react";
import { toolPluginManagementUseCases } from "../../application/useCases/toolPluginManagementUseCases";
import { syncExternalSourceToolMounts } from "../../application/useCases/externalSourceToolMounting";
import { externalSourceUseCases } from "../../application/externalSources/externalSourceUseCases";
import {
  candidateToExternalSource,
  type ParsedMcpSourceCandidate,
} from "../../application/externalSources/thirdPartyMcpParser";
import { ThirdPartyMcpImportModal } from "./ThirdPartyMcpImportModal";
import { ToolPlaygroundModal } from "./ToolPlaygroundModal";
import type { InstalledToolPlugin } from "../../domain/toolPlugins";
import type {
  ExternalCapabilitySnapshot,
  ExternalSourceRuntimeDiagnostics,
  ExternalToolDescriptor,
} from "../../domain/externalSources/contracts";
import type { StoredExternalSource } from "../../infrastructure/externalSources/externalSourceStorage";
import {
  KernelServices,
  type IExternalSourceRuntimeService,
} from "../../application/serviceContracts";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useOptionalKernel } from "../../contexts/KernelContext";

interface ToolCapabilitiesWidgetProps {
  className?: string;
}

export const ToolCapabilitiesWidget: React.FC<ToolCapabilitiesWidgetProps> = ({
  className = "",
}) => {
  // 组件可能在无 KernelProvider 的隔离测试里渲染，这里用可选内核，缺失时跳过挂载同步。
  const kernel = useOptionalKernel();
  const { showCustomAlert, showCustomConfirm, getKernelService } = useUnifiedApp((state) => ({
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    getKernelService: state.getKernelService,
  }));

  // 默认标签为 mcp（以第三方兼容为主）
  const [activeTab, setActiveTab] = useState<"mcp" | "plugin">("mcp");

  // 原生插件状态
  const [plugins, setPlugins] = useState<InstalledToolPlugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);

  // MCP 外部能力源状态
  const [mcpSources, setMcpSources] = useState<StoredExternalSource[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ExternalSourceRuntimeDiagnostics | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, ExternalCapabilitySnapshot>>({});

  // 延迟测速状态
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const [isPingingAll, setIsPingingAll] = useState(false);

  // 单工具轻量测试沙盒 (Playground)
  const [testingTool, setTestingTool] = useState<{
    sourceId: string;
    sourceName: string;
    tool: ExternalToolDescriptor;
  } | null>(null);
  const [testInputText, setTestInputText] = useState("{}");
  const [testOutput, setTestOutput] = useState<{
    result: unknown;
    durationMs: number;
    error?: string;
  } | null>(null);
  const [isExecutingTest, setIsExecutingTest] = useState(false);

  // 导入/添加弹窗
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const getRuntime = useCallback((): IExternalSourceRuntimeService | null => {
    try {
      return getKernelService
        ? getKernelService<IExternalSourceRuntimeService>(KernelServices.ExternalSources)
        : null;
    } catch {
      return null;
    }
  }, [getKernelService]);

  const loadPlugins = useCallback(async () => {
    try {
      setPluginsLoading(true);
      const list = await toolPluginManagementUseCases.list();
      setPlugins(list);
    } catch {
      // ignore
    } finally {
      setPluginsLoading(false);
    }
  }, []);

  const loadMcpSources = useCallback(async () => {
    try {
      setMcpLoading(true);
      const sources = await externalSourceUseCases.list();
      setMcpSources(sources);

      const runtime = getRuntime();
      if (runtime) {
        const diags = runtime.getDiagnostics();
        setDiagnostics(diags);

        // 已连接来源的能力快照直接从运行时内存缓存取，不发网络请求
        const snapshotMap: Record<string, ExternalCapabilitySnapshot> = {};
        for (const source of sources) {
          const cached = runtime.getSnapshot(source.id);
          if (cached) snapshotMap[source.id] = cached;
        }
        setSnapshots((prev) => ({ ...prev, ...snapshotMap }));
      }
    } catch {
      // ignore
    } finally {
      setMcpLoading(false);
    }
  }, [getRuntime]);

  // 首次挂载只加载一次：getKernelService 的引用一旦变化就会重算 loadPlugins / loadMcpSources，
  // 无守卫时会把这两处加载变成「effect → setState → 重新渲染 → effect」的无限环。
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void loadPlugins();
    void loadMcpSources();
  }, [loadPlugins, loadMcpSources]);

  // 原生插件启停
  const handleTogglePlugin = async (plugin: InstalledToolPlugin) => {
    try {
      const nextEnabled = !plugin.enabled;
      await toolPluginManagementUseCases.setEnabled(plugin.id, nextEnabled);
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, enabled: nextEnabled } : p))
      );
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), "切换插件状态失败");
    }
  };

  // MCP 外部能力启停
  const handleToggleMcpSource = async (source: StoredExternalSource) => {
    try {
      const nextEnabled = !source.enabled;
      await externalSourceUseCases.setEnabled(source.id, nextEnabled);
      const runtime = getRuntime();
      if (runtime) {
        await runtime.reload();
      }
      // 启用即自动挂载 / 停用即卸载：自定义 Profile 的显式工具清单跟随变更；
      // 内置 Profile 本身隐式包含所有启用来源，无需改动。
      try {
        if (kernel) {
          const result = syncExternalSourceToolMounts({ kernel, sourceId: source.id, enabled: nextEnabled });
          if (result.reason === "updated") {
            showCustomAlert(
              nextEnabled
                ? "已启用并自动挂载到当前 Profile；新建会话即可使用。"
                : "已停用并从当前 Profile 卸载。",
              "外部能力",
            );
          }
        }
      } catch (syncError) {
        console.warn("[ToolCapabilitiesWidget] 同步 Profile 工具挂载失败:", syncError);
      }
      await loadMcpSources();
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), "切换外部能力状态失败");
    }
  };

  // 单独触发 MCP 探针与测速
  const handleProbeMcpSource = async (source: StoredExternalSource) => {
    const runtime = getRuntime();
    if (!runtime) return;
    try {
      setProbingId(source.id);
      const t0 = performance.now();
      const snapshot = await runtime.probe(source.id);
      const t1 = performance.now();
      setLatencies((prev) => ({ ...prev, [source.id]: Math.round(t1 - t0) }));
      setSnapshots((prev) => ({ ...prev, [source.id]: snapshot }));
      setDiagnostics(runtime.getDiagnostics());
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), `探测 ${source.displayName} 失败`);
    } finally {
      setProbingId(null);
    }
  };

  // 全局巡检与并行测速
  const handlePingAll = async () => {
    const runtime = getRuntime();
    if (!runtime) return;
    setIsPingingAll(true);
    try {
      const enabledSources = mcpSources.filter((s) => s.enabled);
      const latencyUpdates: Record<string, number> = {};
      await Promise.allSettled(
        enabledSources.map(async (source) => {
          const t0 = performance.now();
          await runtime.probe(source.id);
          const t1 = performance.now();
          latencyUpdates[source.id] = Math.round(t1 - t0);
        })
      );
      setLatencies((prev) => ({ ...prev, ...latencyUpdates }));
      setDiagnostics(runtime.getDiagnostics());
    } finally {
      setIsPingingAll(false);
    }
  };

  // 打开单工具测试沙盒
  const handleOpenToolTest = (source: StoredExternalSource, tool: ExternalToolDescriptor) => {
    setTestingTool({
      sourceId: source.id,
      sourceName: source.displayName,
      tool,
    });
    try {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> })?.properties;
      if (properties && typeof properties === "object") {
        const sample: Record<string, string> = {};
        for (const key of Object.keys(properties)) {
          sample[key] = "";
        }
        setTestInputText(JSON.stringify(sample, null, 2));
      } else {
        setTestInputText("{}");
      }
    } catch {
      setTestInputText("{}");
    }
    setTestOutput(null);
  };

  // 执行单工具测试
  const handleExecuteToolTest = async () => {
    if (!testingTool) return;
    const runtime = getRuntime();
    if (!runtime) {
      showCustomAlert("外部能力运行时未就绪，无法测试调用", "提示");
      return;
    }
    let parsedInput: unknown = {};
    try {
      parsedInput = JSON.parse(testInputText);
    } catch (e) {
      showCustomAlert(`入参 JSON 格式错误: ${e instanceof Error ? e.message : String(e)}`, "提示");
      return;
    }

    setIsExecutingTest(true);
    setTestOutput(null);
    try {
      const res = await runtime.testCallTool(
        testingTool.sourceId,
        testingTool.tool.localName,
        parsedInput
      );
      setTestOutput(res);
    } catch (e) {
      setTestOutput({
        result: null,
        durationMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsExecutingTest(false);
    }
  };

  // 删除 MCP 来源
  const handleDeleteMcpSource = async (source: StoredExternalSource) => {
    const confirmed = await showCustomConfirm(
      `确定要删除外部能力源「${source.displayName}」吗？已配置的凭据也将一并移除。`,
      "删除外部能力源"
    );
    if (!confirmed) return;

    try {
      await externalSourceUseCases.remove(source.id);
      const runtime = getRuntime();
      if (runtime) await runtime.reload();
      if (expandedSourceId === source.id) setExpandedSourceId(null);
      await loadMcpSources();
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), "删除外部能力源失败");
    }
  };

  // 保存解析出的第三方服务
  const handleSaveCandidates = async (candidates: readonly ParsedMcpSourceCandidate[]) => {
    try {
      const runtime = getRuntime();
      for (const candidate of candidates) {
        const source = candidateToExternalSource(candidate);
        await externalSourceUseCases.save(source);
        if (candidate.rawSecret) {
          await externalSourceUseCases.setCredential(candidate, candidate.rawSecret);
        }
      }
      if (runtime) await runtime.reload();
      await loadMcpSources();
      setIsImportModalOpen(false);
      showCustomAlert(`成功导入并启用 ${candidates.length} 个第三方 MCP 服务`, "导入完成");
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), "导入保存失败");
    }
  };

  // 统计信息
  const activeMcpCount = mcpSources.filter((s) => s.enabled).length;
  const activePluginsCount = plugins.filter((p) => p.enabled).length;

  return (
    <div
      data-ui="tool-capabilities-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-3.5 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

      {/* 头部标题与简洁分类切签 */}
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">扩展能力</h3>
            <p className="text-[10px] text-muted-foreground">第三方 MCP 与宿主 Tool</p>
          </div>
        </div>

        {/* 紧凑切换胶囊 (默认 MCP) */}
        <div className="flex rounded-lg border border-white/10 bg-black/20 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setActiveTab("mcp")}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-all ${
              activeTab === "mcp"
                ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-2.5 w-2.5" />
            <span>MCP</span>
            <span className="font-mono text-[9px] opacity-70">({mcpSources.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("plugin")}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-all ${
              activeTab === "plugin"
                ? "bg-purple-500/20 text-purple-300 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wrench className="h-2.5 w-2.5" />
            <span>插件</span>
            <span className="font-mono text-[9px] opacity-70">({plugins.length})</span>
          </button>
        </div>
      </div>

      {/* 1. MCP 外部能力视界（默认展示） */}
      {activeTab === "mcp" && (
        <div className="space-y-2">
          {mcpSources.length === 0 ? (
            <div className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-muted-foreground">
              <Sparkles className="mb-1 h-4 w-4 text-cyan-400/60" />
              <span>{mcpLoading ? "正在读取 MCP 状态..." : "暂无已接入的第三方 MCP 服务"}</span>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="mt-2 flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/25 active:scale-95"
              >
                <Plus className="h-3 w-3" />
                接入第三方 MCP
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {mcpSources.map((source) => {
                const isExpanded = expandedSourceId === source.id;
                const isProbing = probingId === source.id;
                const isConnected =
                  diagnostics?.connectedSources?.includes(source.id) ?? false;
                const failureMsg = diagnostics?.failures?.[source.id];
                const snapshot = snapshots[source.id];
                const toolCount = snapshot?.tools?.length ?? 0;
                const latency = latencies[source.id];

                return (
                  <div
                    key={source.id}
                    className="overflow-hidden rounded-xl border border-white/5 bg-white/5 transition-all hover:bg-white/8"
                  >
                    {/* 极简主行：单行紧凑展示 */}
                    <div className="flex items-center justify-between gap-2 p-2">
                      {/* 左侧可点击展开折叠 */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSourceId(isExpanded ? null : source.id)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {/* 状态指示圆点 */}
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            !source.enabled
                              ? "bg-muted-foreground/40"
                              : isConnected
                              ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                              : failureMsg
                              ? "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.6)]"
                              : "bg-amber-400"
                          }`}
                        />

                        {/* 标题与紧凑徽标 */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {source.displayName}
                            </span>
                            {isConnected && toolCount > 0 && (
                              <span className="rounded bg-cyan-500/10 px-1 py-0.2 text-[9px] font-mono font-medium text-cyan-300 border border-cyan-500/20">
                                {toolCount} 工具
                              </span>
                            )}
                            {latency !== undefined && (
                              <span
                                className={`rounded px-1 py-0.2 text-[9px] font-mono font-medium border ${
                                  latency < 300
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                    : latency < 1000
                                    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                    : "bg-rose-500/10 text-rose-300 border-rose-500/20"
                                }`}
                              >
                                {latency}ms
                              </span>
                            )}
                            {failureMsg && (
                              <span className="rounded bg-rose-500/10 px-1 py-0.2 text-[9px] font-medium text-rose-300 border border-rose-500/20">
                                异常
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {source.endpoint}
                          </p>
                        </div>

                        {/* 展开指示箭头 */}
                        <div className="text-muted-foreground/60 transition-transform">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </div>
                      </button>

                      {/* 右侧启停切换 */}
                      <button
                        type="button"
                        onClick={() => handleToggleMcpSource(source)}
                        className={`flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold transition-all active:scale-95 shrink-0 ${
                          source.enabled
                            ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                            : "border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                        }`}
                      >
                        {source.enabled ? (
                          <>
                            <Check className="h-2.5 w-2.5" />
                            已启用
                          </>
                        ) : (
                          <>
                            <Power className="h-2.5 w-2.5" />
                            停用
                          </>
                        )}
                      </button>
                    </div>

                    {/* 二次展开详情（点击展开后查看工具与诊断） */}
                    {isExpanded && (
                      <div className="border-t border-white/5 bg-black/20 p-2.5 space-y-2 text-xs">
                        {/* 异常警示信息 */}
                        {failureMsg && (
                          <div className="flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-[10px] text-rose-300">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <div className="flex-1 break-all">
                              <p className="font-semibold">连接异常：</p>
                              <p>{failureMsg}</p>
                            </div>
                          </div>
                        )}

                        {/* 工具清单概览与单工具沙盒测试按钮 */}
                        {snapshot?.tools && snapshot.tools.length > 0 ? (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-1">
                              已发现工具 ({snapshot.tools.length})：
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {snapshot.tools.map((t) => (
                                <div
                                  key={t.qualifiedName}
                                  className="flex items-center gap-1 rounded-md bg-white/5 pl-2 pr-1 py-0.5 text-[9px] font-mono text-cyan-200 border border-white/10 hover:border-cyan-400/30 transition-all"
                                >
                                  <span title={t.description || t.qualifiedName}>
                                    {t.localName}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenToolTest(source, t);
                                    }}
                                    className="flex items-center gap-0.5 rounded px-1 py-0.2 bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 active:scale-95 transition-colors"
                                    title="测试此工具"
                                  >
                                    <Play className="h-2 w-2" />
                                    <span>测试</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : isConnected ? (
                          <p className="text-[10px] text-muted-foreground">
                            已连通，尚未发现暴露的工具
                          </p>
                        ) : null}

                        {/* 操作栏 */}
                        <div className="flex items-center justify-between pt-1 text-[10px]">
                          <span className="text-muted-foreground font-mono">
                            协议世代: {source.era}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isProbing}
                              onClick={() => handleProbeMcpSource(source)}
                              className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-foreground hover:bg-white/10 active:scale-95"
                            >
                              <RefreshCw
                                className={`h-2.5 w-2.5 ${isProbing ? "animate-spin" : ""}`}
                              />
                              {isProbing ? "探测中..." : "重新探测"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMcpSource(source)}
                              className="flex items-center gap-0.5 rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-1 text-rose-300 hover:bg-rose-500/20 active:scale-95"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 底部快捷导入入口与巡检测速 */}
              <div className="pt-1 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-mono">
                  {activeMcpCount} / {mcpSources.length} 来源已启用
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isPingingAll || activeMcpCount === 0}
                    onClick={handlePingAll}
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-50"
                  >
                    <Gauge className={`h-3 w-3 ${isPingingAll ? "animate-spin text-cyan-400" : ""}`} />
                    <span>{isPingingAll ? "测速中..." : "一键巡检"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-1 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/20 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    接入第三方 MCP
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. 原生 Tool 插件视界 */}
      {activeTab === "plugin" && (
        <div>
          {plugins.length === 0 ? (
            <div className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-muted-foreground">
              <Sparkles className="mb-1 h-4 w-4 text-purple-400/60" />
              <span>{pluginsLoading ? "正在读取插件状态..." : "暂无已安装的本地 Tool 插件"}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 p-2 transition-all hover:bg-white/8"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {plugin.manifest.name}
                      </span>
                      <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-mono text-muted-foreground">
                        v{plugin.manifest.version}
                      </span>
                      {plugin.sourceVerification?.trustLevel === "official" && (
                        <span className="flex items-center gap-0.5 rounded-full bg-cyan-500/10 px-1.5 py-0.2 text-[9px] font-medium text-cyan-400 border border-cyan-500/20">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          官方
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {plugin.manifest.description || "无描述"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTogglePlugin(plugin)}
                    className={`flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold transition-all active:scale-95 ${
                      plugin.enabled
                        ? "border border-purple-500/30 bg-purple-500/15 text-purple-400 hover:bg-purple-500/25"
                        : "border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    }`}
                  >
                    {plugin.enabled ? (
                      <>
                        <Check className="h-2.5 w-2.5" />
                        已启用
                      </>
                    ) : (
                      <>
                        <Power className="h-2.5 w-2.5" />
                        停用
                      </>
                    )}
                  </button>
                </div>
              ))}
              <div className="pt-1 text-right">
                <span className="text-[10px] text-muted-foreground font-mono">
                  {activePluginsCount} / {plugins.length} 插件已启用
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. 接入第三方 MCP 弹窗 */}
      {isImportModalOpen && (
        <ThirdPartyMcpImportModal
          onClose={() => setIsImportModalOpen(false)}
          onSaveCandidates={handleSaveCandidates}
          showAlert={showCustomAlert}
        />
      )}

      {/* 4. 单工具轻量测试沙盒抽屉/弹窗 (Tool Playground) */}
      {testingTool && (
        <ToolPlaygroundModal
          testingTool={testingTool}
          testInputText={testInputText}
          onTestInputTextChange={setTestInputText}
          isExecutingTest={isExecutingTest}
          onExecuteTest={handleExecuteToolTest}
          onClose={() => setTestingTool(null)}
          testOutput={testOutput}
        />
      )}
    </div>
  );
};

export default ToolCapabilitiesWidget;
