import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useKernel } from "../../contexts/KernelContext";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { destroyApplicationRuntime } from "../../application/runtime";
import {
  KernelServices,
  type IRuntimeProfileService,
} from "../../application/serviceContracts";
import {
  BUILTIN_BASE_PROFILE_ID,
  BUILTIN_TAVERN_PROFILE_ID,
  type RuntimeProfileCapabilities,
  type RuntimeProfileRecord,
} from "../../application/runtimeProfiles/contracts";
import { getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";
import SettingsToggleRow from "../../tabs/settings/SettingsToggleRow";

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
  const activeProfile = catalog.profiles.find((profile) =>
    catalog.activeProfileId === profile.id && catalog.activeProfileVersion === profile.version,
  );
  const compatibilityProfile = catalog.profiles.find((profile) => profile.id === BUILTIN_TAVERN_PROFILE_ID);
  const baseProfile = catalog.profiles.find((profile) => profile.id === BUILTIN_BASE_PROFILE_ID);
  const diagnostics = useMemo(
    () => inspected ? service.getDiagnostics(inspected.id, settings.api.type) : null,
    [inspected, service, settings.api.type, catalog],
  );

  const refresh = () => {
    const next = service.listProfiles();
    setCatalog(next);
    if (!next.profiles.some((profile) => profile.id === inspectedId)) {
      setInspectedId(next.selectedProfileId);
    }
  };

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

  const activateProfile = async (profile: RuntimeProfileRecord, actionLabel = "切换 Profile") => {
    if (busy || isActive(profile)) return;
    const sessionProfileId = getSessionRuntimeProfileId(activeSession);
    const sessionProfileVersion = activeSession?.compositionSnapshot?.profileVersion;
    const sessionWarning = activeSession && (
      sessionProfileId !== profile.id
      || (sessionProfileVersion !== undefined && sessionProfileVersion !== profile.version)
    )
      ? `\n\n当前会话固定使用 ${sessionProfileId} v${sessionProfileVersion ?? "legacy"}。切换后该会话仍保留原组合；再次打开时会自动恢复其 Profile。`
      : "";
    const confirmed = await showCustomConfirm(
      `${actionLabel}到「${profile.name}」会先卸载当前 Runtime Plugin，再重启应用运行时。${sessionWarning}\n\n是否继续？`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      service.selectProfile(profile.id);
      await destroyApplicationRuntime();
      window.location.reload();
    } catch (error: unknown) {
      setBusy(false);
      await showCustomAlert(normalizeError(error), `${actionLabel}失败`);
    }
  };

  const toggleCompatibility = (enabled: boolean) => {
    const target = enabled ? compatibilityProfile : baseProfile;
    if (!target) {
      void showCustomAlert("内置兼容 Profile 不可用，当前设置未改变。", "切换兼容插件失败");
      return;
    }
    void activateProfile(target, enabled ? "开启兼容插件并切换" : "关闭兼容插件并切换");
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

  const compatibilityEnabled = activeProfile?.capabilities.sillyTavernCompatibility ?? false;

  return (
    <section className="runtime-profile-shell p-3.5 sm:p-4">
      <header className="flex items-start gap-3">
        <span className="settings-header-icon shrink-0 text-primary">
          <Cpu className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-foreground sm:text-base">Agent Runtime</h2>
            <span className="settings-toggle-badge">Profile 组合</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            选择聊天底座与可撤销能力。Compatibility Runtime 是独立的受信插件，不会进入 Base Agent 或 Kernel。
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="刷新 Profile"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background/70 text-muted-foreground transition hover:text-primary active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      {activeProfile && (
        <div className="runtime-profile-active-card mt-4">
          <div className="flex items-start gap-3">
            <div className="runtime-profile-active-icon">
              {compatibilityEnabled ? <Sparkles className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{activeProfile.name}</span>
                <span className="runtime-profile-status"><span className="settings-status-dot" />运行中</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                v{activeProfile.version} · {compatibilityEnabled ? "兼容聊天能力已装载" : "通用聊天底座"}
              </p>
            </div>
          </div>
          <SettingsToggleRow
            label="SillyTavern Compatibility Runtime"
            description="开启会切换到 Tavern Agent；关闭会回到 Base Agent。切换会卸载当前插件并重载运行时，会话数据不会被删除。"
            checked={compatibilityEnabled}
            disabled={busy}
            onCheckedChange={toggleCompatibility}
            badge="独立插件"
            tone={compatibilityEnabled ? "warning" : "default"}
          />
          <div className="runtime-profile-reload-note">
            <Power className="h-3.5 w-3.5 shrink-0" />
            <span>{busy ? "正在保存 Profile 并重载运行时…" : "开关只改变 Profile 组合，不会安装用户代码。"}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {catalog.profiles.map((profile) => {
          const active = isActive(profile);
          const selected = inspected.id === profile.id;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => setInspectedId(profile.id)}
              className={`runtime-profile-choice ${selected ? "runtime-profile-choice-selected" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{profile.name}</span>
                {active && <span className="runtime-profile-status">运行中</span>}
                {profile.builtin && <span className="text-[10px] text-muted-foreground">内置</span>}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                <span>v{profile.version}</span>
                <span>·</span>
                <span>{profile.capabilities.sillyTavernCompatibility ? "兼容插件" : "通用底座"}</span>
                {!profile.builtin && <span>· 自定义</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="runtime-profile-detail mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{inspected.name}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Profile v{inspected.version} · Schema v{inspected.schemaVersion}</div>
          </div>
          <button type="button" onClick={() => void copyProfile(inspected)} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-background/60 px-3 text-xs font-bold transition hover:border-primary/40 hover:text-primary active:scale-95">
            <Copy className="h-3.5 w-3.5" />复制
          </button>
          {!inspected.builtin && (
            <button type="button" onClick={() => void deleteProfile(inspected)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/25 text-destructive transition hover:bg-destructive/10 active:scale-95" aria-label="删除 Profile">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <SettingsToggleRow
            label="Compatibility capability"
            description={inspected.builtin ? "内置 Profile 的插件组合固定不变；请使用上方开关在 Base/Tavern 之间切换。" : "自定义 Profile 可独立启用 SillyTavern 兼容贡献。"}
            checked={inspected.capabilities.sillyTavernCompatibility}
            disabled={inspected.builtin || busy}
            onCheckedChange={(checked) => updateCapability(inspected, { sillyTavernCompatibility: checked })}
            badge={inspected.builtin ? "内置锁定" : "自定义"}
          />
          <SettingsToggleRow
            label="音频 → ASR 文本降级"
            description="当 Provider 不接收音频时，将音频转换为可发送的文本。"
            checked={inspected.capabilities.audioAsrFallback}
            disabled={inspected.builtin || busy}
            onCheckedChange={(checked) => updateCapability(inspected, { audioAsrFallback: checked })}
            badge={inspected.builtin ? "内置锁定" : undefined}
          />
          <SettingsToggleRow
            label="视频 → 关键帧图片降级"
            description="当 Provider 不支持视频时，提取关键帧并按图片发送。"
            checked={inspected.capabilities.videoKeyframeFallback}
            disabled={inspected.builtin || busy}
            onCheckedChange={(checked) => updateCapability(inspected, { videoKeyframeFallback: checked })}
            badge={inspected.builtin ? "内置锁定" : undefined}
          />
        </div>

        <div className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2">
          <DiagnosticRow label="Provider" value={`${diagnostics.provider.id}${diagnostics.provider.available ? "" : "（缺失）"}`} />
          <DiagnosticRow label="输入模态" value={diagnostics.provider.inputModalities.join(" / ") || "无"} />
          <DiagnosticRow label="Tools" value={diagnostics.tools.join("、") || "未注册"} />
          <DiagnosticRow label="Prompt Sections" value={diagnostics.promptSections.join("、") || "无"} />
          <DiagnosticRow label="Renderer" value={diagnostics.renderers.join("、") || "普通文本"} />
          <DiagnosticRow label="音频/视频策略" value={`${diagnostics.mediaFallbacks.audio} / ${diagnostics.mediaFallbacks.video}`} />
        </div>

        {diagnostics.warnings.map((warning) => (
          <div key={warning} className="mt-2 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning}
          </div>
        ))}

        <button
          type="button"
          disabled={busy || isActive(inspected)}
          onClick={() => void activateProfile(inspected)}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:brightness-105 active:scale-[0.99] disabled:opacity-50"
        >
          {isActive(inspected) ? <Check className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {isActive(inspected) ? "当前运行中" : busy ? "正在切换…" : "切换并重载运行时"}
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Runtime Plugin 目前只允许随安装包分发的受信实现。签名、来源验证与回滚机制完成前，不开放任意 Runtime Plugin 安装。
      </p>
    </section>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtime-profile-diagnostic-row">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 break-words font-mono text-[10px] leading-relaxed">{value}</div>
    </div>
  );
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
