import { useMemo, useState } from "react";
import { AlertTriangle, Copy, Cpu, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useKernel } from "../../contexts/KernelContext";
import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  KernelServices,
  type IRuntimeProfileService,
} from "../../application/serviceContracts";
import type {
  RuntimeProfileCapabilities,
  RuntimeProfileRecord,
} from "../../application/runtimeProfiles/contracts";
import { getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";

export default function RuntimeProfileManagerSection() {
  const kernel = useKernel();
  const service = kernel.getService<IRuntimeProfileService>(KernelServices.RuntimeProfiles);
  const {
    activeSession,
    settings,
    showCustomAlert,
    showCustomConfirm,
    showCustomPrompt,
  } = useUnifiedApp((state) => ({
    activeSession: state.activeSession,
    settings: state.settings,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    showCustomPrompt: state.showCustomPrompt,
  }));
  const [catalog, setCatalog] = useState(() => service.listProfiles());
  const [inspectedId, setInspectedId] = useState(catalog.selectedProfileId);
  const [busy, setBusy] = useState(false);
  const inspected = catalog.profiles.find((profile) => profile.id === inspectedId)
    ?? catalog.profiles[0];
  const diagnostics = useMemo(
    () => inspected ? service.getDiagnostics(inspected.id, settings.api.type) : null,
    [inspected, service, settings.api.type, catalog],
  );

  const refresh = () => setCatalog(service.listProfiles());
  const isActive = (profile: RuntimeProfileRecord) =>
    catalog.activeProfileId === profile.id && catalog.activeProfileVersion === profile.version;

  const copyProfile = async (source: RuntimeProfileRecord) => {
    const name = await showCustomPrompt("请输入复制后的 Agent Profile 名称", `${source.name} 副本`);
    if (!name) return;
    try {
      const copy = service.copyProfile(source.id, name);
      refresh();
      setInspectedId(copy.id);
    } catch (error: unknown) {
      await showCustomAlert(normalizeError(error), "复制 Profile 失败");
    }
  };

  const updateCapability = (
    profile: RuntimeProfileRecord,
    patch: Partial<RuntimeProfileCapabilities>,
  ) => {
    try {
      service.updateCapabilities(profile.id, patch);
      refresh();
    } catch (error: unknown) {
      void showCustomAlert(normalizeError(error), "更新 Profile 失败");
    }
  };

  const activateProfile = async (profile: RuntimeProfileRecord) => {
    if (busy || isActive(profile)) return;
    const sessionProfileId = getSessionRuntimeProfileId(activeSession);
    const sessionProfileVersion = activeSession?.compositionSnapshot?.profileVersion;
    const sessionWarning = activeSession && (
      sessionProfileId !== profile.id
      || (sessionProfileVersion !== undefined && sessionProfileVersion !== profile.version)
    )
      ? `\n\n当前会话固定使用 ${sessionProfileId} v${sessionProfileVersion ?? "legacy"}。切换后请新建会话；继续在旧会话发送会被安全阻止。`
      : "";
    const confirmed = await showCustomConfirm(
      `切换到「${profile.name}」需要重启应用运行时。${sessionWarning}\n\n是否继续？`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      service.selectProfile(profile.id);
      window.location.reload();
    } catch (error: unknown) {
      setBusy(false);
      await showCustomAlert(normalizeError(error), "切换 Profile 失败");
    }
  };

  const deleteProfile = async (profile: RuntimeProfileRecord) => {
    if (profile.builtin) return;
    if (!await showCustomConfirm(`确定删除「${profile.name}」吗？已绑定该 Profile 的会话仍会保留快照，但无法继续运行。`)) return;
    try {
      service.deleteProfile(profile.id);
      const next = service.listProfiles();
      setCatalog(next);
      setInspectedId(next.selectedProfileId);
    } catch (error: unknown) {
      await showCustomAlert(normalizeError(error), "删除 Profile 失败");
    }
  };

  if (!inspected || !diagnostics) return null;

  return (
    <section className="rounded-xl border border-primary/25 bg-card/70 p-3 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Cpu className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold text-foreground">Agent Runtime Profiles</h2>
          <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
            组合 Provider、媒体降级与受信兼容能力；用户安装的 .mtplugin 不会进入这里。
          </p>
        </div>
        <button type="button" onClick={refresh} aria-label="刷新 Profile" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {catalog.profiles.map((profile) => {
          const active = isActive(profile);
          const selected = inspected.id === profile.id;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => setInspectedId(profile.id)}
              className={`rounded-xl border p-2.5 text-left ${selected ? "border-primary bg-primary/10" : "border-border bg-background/70"}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{profile.name}</span>
                {active && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[8px] font-bold text-emerald-700 dark:text-emerald-300">运行中</span>}
                {profile.builtin && <span className="text-[8px] text-muted-foreground">内置</span>}
              </div>
              <div className="mt-1 truncate font-mono text-[8px] text-muted-foreground">{profile.id}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border border-border bg-background/75 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold">{inspected.name}</div>
            <div className="mt-0.5 text-[8px] text-muted-foreground">Profile v{inspected.version} · Schema v{inspected.schemaVersion}</div>
          </div>
          <button type="button" onClick={() => void copyProfile(inspected)} className="flex min-h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-[9px] font-bold">
            <Copy className="h-3.5 w-3.5" />复制
          </button>
          {!inspected.builtin && (
            <button type="button" onClick={() => void deleteProfile(inspected)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 text-destructive" aria-label="删除 Profile">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <CapabilityToggle label="SillyTavern Compatibility Runtime" checked={inspected.capabilities.sillyTavernCompatibility} disabled={inspected.builtin} onChange={(checked) => updateCapability(inspected, { sillyTavernCompatibility: checked })} />
          <CapabilityToggle label="音频 → ASR 文本降级" checked={inspected.capabilities.audioAsrFallback} disabled={inspected.builtin} onChange={(checked) => updateCapability(inspected, { audioAsrFallback: checked })} />
          <CapabilityToggle label="视频 → 关键帧图片降级" checked={inspected.capabilities.videoKeyframeFallback} disabled={inspected.builtin} onChange={(checked) => updateCapability(inspected, { videoKeyframeFallback: checked })} />
        </div>

        <div className="mt-3 grid gap-2 text-[9px] sm:grid-cols-2">
          <DiagnosticRow label="Provider" value={`${diagnostics.provider.id}${diagnostics.provider.available ? "" : "（缺失）"}`} />
          <DiagnosticRow label="输入模态" value={diagnostics.provider.inputModalities.join(" / ") || "无"} />
          <DiagnosticRow label="Tools" value={diagnostics.tools.join("、") || "未注册"} />
          <DiagnosticRow label="Prompt Sections" value={diagnostics.promptSections.join("、") || "无"} />
          <DiagnosticRow label="Renderer" value={diagnostics.renderers.join("、") || "普通文本"} />
          <DiagnosticRow label="音频/视频策略" value={`${diagnostics.mediaFallbacks.audio} / ${diagnostics.mediaFallbacks.video}`} />
        </div>

        {diagnostics.warnings.map((warning) => (
          <div key={warning} className="mt-2 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[9px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}
          </div>
        ))}

        <button
          type="button"
          disabled={busy || isActive(inspected)}
          onClick={() => void activateProfile(inspected)}
          className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[10px] font-bold text-primary-foreground disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />
          {isActive(inspected) ? "当前运行中" : busy ? "正在切换…" : "切换并重启运行时"}
        </button>
      </div>

      <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
        Runtime Plugin 目前只允许随安装包分发的受信实现。签名、来源验证与回滚机制完成前，不开放任意 Runtime Plugin 安装。
      </p>
    </section>
  );
}

function CapabilityToggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border px-2.5 text-[9px]">
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
    </label>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/70 p-2"><div className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 break-words font-mono text-[8.5px]">{value}</div></div>;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
