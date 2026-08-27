import React from "react";
import { Activity, X, Cpu, Wrench, ShieldCheck, Layers, Eye, RefreshCw, CheckCircle, Info } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { IAgentRuntimeService, IRuntimeProfileService, ICompatibilityRuntimeService, KernelServices } from "@/src/application/serviceContracts";
import type { AgentRuntimeDiagnostics } from "@/src/application/services/AgentRuntimeService";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";

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

  useMobileBackHandler(isOpen, () => {
    onClose();
    return true;
  }, 850);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="flex max-h-[85dvh] w-full max-w-lg select-none flex-col gap-0 overflow-hidden rounded-2xl border border-border/80 bg-card p-0 shadow-2xl"
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border/60 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground leading-tight">Agent Host 运行诊断</DialogTitle>
              <p className="text-[10px] text-muted-foreground">Runtime Diagnostics & Composition</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshDiagnostics}
              className="flex size-11 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="刷新诊断数据"
              aria-label="刷新诊断数据"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭运行诊断"
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
                    <span className="text-muted-foreground">v{t.version} · {t.policy} · {t.riskLevel}</span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground italic">当前 Profile 未注册 Agent Tool</span>
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
            className="min-h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            完成
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default React.memo(AgentHostDiagnosticsModal);
