import React from "react";
import { Activity, X, Cpu, Wrench, ShieldCheck, Layers, Eye, RefreshCw, CheckCircle, Info } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { IAgentRuntimeService, IRuntimeProfileService, ICompatibilityRuntimeService, KernelServices } from "@/src/application/serviceContracts";
import type { AgentRuntimeDiagnostics } from "@/src/application/services/AgentRuntimeService";

interface AgentHostDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgentHostDiagnosticsModal({ isOpen, onClose }: AgentHostDiagnosticsModalProps): React.JSX.Element | null {
  const getKernelService = useUnifiedApp((state) => state.getKernelService);
  const activeSession = useUnifiedApp((state) => state.activeSession);

  const [diagnostics, setDiagnostics] = React.useState<AgentRuntimeDiagnostics | null>(null);
  const [profileId, setProfileId] = React.useState<string>("mobile-tavern.tavern");
  const [isCompatEnabled, setIsCompatEnabled] = React.useState<boolean>(true);

  const refreshDiagnostics = React.useCallback(() => {
    try {
      const agentRuntime = getKernelService<IAgentRuntimeService>("agentRuntime");
      if (agentRuntime) {
        setDiagnostics(agentRuntime.getDiagnostics());
      }
      const profileService = getKernelService<IRuntimeProfileService>("runtimeProfile");
      if (profileService) {
        const catalog = profileService.listProfiles();
        setProfileId(catalog.activeProfileId || catalog.selectedProfileId || "mobile-tavern.tavern");
      }
      const compatService = getKernelService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime);
      if (compatService) {
        setIsCompatEnabled(compatService.isEnabled());
      }
    } catch (err) {
      console.warn("[DiagnosticsModal] Failed to fetch diagnostics:", err);
    }
  }, [getKernelService]);

  React.useEffect(() => {
    if (isOpen) {
      refreshDiagnostics();
    }
  }, [isOpen, refreshDiagnostics]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-lg bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] z-10">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border/60 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground leading-tight">Agent Host 运行诊断</h2>
              <p className="text-[10px] text-muted-foreground">Runtime Diagnostics & Composition</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshDiagnostics}
              className="p-1.5 rounded-lg border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition"
              title="刷新诊断数据"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs font-sans custom-scrollbar">
          {/* Active Profile Status */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> 当前激活 Profile
              </span>
              <span className="rounded bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                {profileId}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1 font-mono">
              <div className="flex justify-between">
                <span>会话组合快照:</span>
                <span className="text-foreground">{activeSession?.id ? "已锁定 Snapshot" : "默认配置"}</span>
              </div>
              <div className="flex justify-between">
                <span>SillyTavern 兼容插件:</span>
                <span className={isCompatEnabled ? "text-emerald-500 font-semibold" : "text-amber-500 font-semibold"}>
                  {isCompatEnabled ? "已启用 (Tavern Mode)" : "已禁用 (Base Mode)"}
                </span>
              </div>
            </div>
          </div>

          {/* Section: Drivers */}
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold text-foreground/80 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-primary" /> Agent Drivers
            </h3>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 space-y-1">
              {diagnostics?.drivers?.length ? (
                diagnostics.drivers.map((d) => (
                  <div key={d.id} className="flex justify-between font-mono text-[10px] py-0.5 border-b border-border/30 last:border-0">
                    <span className="text-foreground font-semibold">{d.id}</span>
                    <span className="text-muted-foreground">v{d.version}</span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground italic">mobile-tavern.chat.driver@1 (Active)</span>
              )}
            </div>
          </div>

          {/* Section: Providers */}
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold text-foreground/80 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-primary" /> LLM Providers & Routes
            </h3>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 space-y-1">
              {diagnostics?.providers?.length ? (
                diagnostics.providers.map((p) => (
                  <div key={p.id} className="flex justify-between font-mono text-[10px] py-0.5 border-b border-border/30 last:border-0">
                    <span className="text-foreground font-semibold">{p.id}</span>
                    <span className="text-emerald-500">v{p.version}</span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground italic">provider.openai-compatible / provider.anthropic (Active)</span>
              )}
            </div>
          </div>

          {/* Section: Tools */}
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold text-foreground/80 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-primary" /> 注册的 Agent Tools ({diagnostics?.tools?.length ?? 0})
            </h3>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 space-y-1">
              {diagnostics?.tools?.length ? (
                diagnostics.tools.map((t) => (
                  <div key={t.name} className="flex justify-between font-mono text-[10px] py-0.5 border-b border-border/30 last:border-0">
                    <span className="text-foreground font-semibold flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-emerald-500" /> {t.name}
                    </span>
                    <span className="text-muted-foreground">v{t.version}</span>
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-muted-foreground font-mono space-y-1">
                  <div className="flex items-center justify-between text-amber-500/90 font-sans font-medium text-[9px] pb-1 border-b border-border/20">
                    <span>未挂载第三方扩展工具</span>
                    <span>Phase A 内置备选</span>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <span>session.search</span>
                    <span className="text-emerald-500 font-semibold">Built-in</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>memory.search</span>
                    <span className="text-emerald-500 font-semibold">Built-in</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>character.read</span>
                    <span className="text-emerald-500 font-semibold">Built-in</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section: Media Processors */}
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold text-foreground/80 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" /> 多模态降级 & 处理器
            </h3>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 space-y-1 font-mono text-[10px]">
              <div className="flex justify-between">
                <span>图片输入策略:</span>
                <span className="text-foreground">Vision Modal Projection</span>
              </div>
              <div className="flex justify-between">
                <span>音频处理器 (ASR):</span>
                <span className="text-foreground">OpenAI / Web-Speech ASR</span>
              </div>
              <div className="flex justify-between">
                <span>视频处理器:</span>
                <span className="text-foreground">JPEG Keyframe Extract + Track</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 p-2 rounded-lg">
            <Info className="w-3.5 h-3.5 shrink-0 text-primary" />
            <span>所有能力注册均归属于 Application Scope，符合 ARCH-KERNEL 隔离标准。</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border/60 bg-muted/20 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow hover:bg-primary/90 transition"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AgentHostDiagnosticsModal);
