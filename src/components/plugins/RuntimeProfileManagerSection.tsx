import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useKernel } from "../../contexts/KernelContext";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { destroyApplicationRuntime } from "../../application/runtime";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IRuntimeProfileService,
  type IToolPluginRuntimeService,
} from "../../application/serviceContracts";
import {
  BUILTIN_BASE_PROFILE_ID,
  BUILTIN_TAVERN_PROFILE_ID,
  type RuntimeProfileCapabilities,
  type RuntimeProfileAgentSettings,
  type RuntimeProfileRecord,
  type RuntimeProfileToolMount,
} from "../../application/runtimeProfiles/contracts";
import { getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";
import { prepareAgentProfileBundleExport } from "../../application/useCases/prepareAgentProfileBundleExport";
import { prepareAgentProfileBundleImport } from "../../application/useCases/prepareAgentProfileBundleImport";
import { prepareRuntimeProfileAgentLaunch } from "../../application/useCases/runtimeProfileAgentLaunch";
import {
  CHARACTER_READ_TOOL_NAME,
  SESSION_BRANCH_TOOL_NAME,
} from "../../application/tools/builtinAgentTools";
import SettingsToggleRow from "../../tabs/settings/SettingsToggleRow";
import AgentProfileEditor from "./AgentProfileEditor";

const MAX_AGENT_PROFILE_FILE_SIZE = 512 * 1024;
const BUILTIN_TOOLS: readonly RuntimeProfileToolMount[] = [
  { name: CHARACTER_READ_TOOL_NAME, version: "1.0.0" },
  { name: SESSION_BRANCH_TOOL_NAME, version: "1.0.0" },
];

export default function RuntimeProfileManagerSection() {
  const kernel = useKernel();
  const service = kernel.getService<IRuntimeProfileService>(KernelServices.RuntimeProfiles);
  const {
    activeSession,
    characters,
    settings,
    showCustomAlert,
    showCustomConfirm,
    showCustomPrompt,
  } = useUnifiedApp((state) => ({
    activeSession: state.activeSession,
    characters: state.characters,
    settings: state.settings,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    showCustomPrompt: state.showCustomPrompt,
  }));
  const [catalog, setCatalog] = useState(() => service.listProfiles());
  const [inspectedId, setInspectedId] = useState(catalog.selectedProfileId);
  const [busy, setBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
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
  const editableTools = useMemo(
    () => inspected
      ? mergeToolMounts(inspected.agent?.toolMounts ?? [], listToolsForProfile(kernel, inspected.id))
      : [...BUILTIN_TOOLS],
    [inspected, kernel, catalog],
  );
  const unavailableToolNames = useMemo(() => {
    if (!inspected) return [];
    const available = new Set(listToolsForProfile(kernel, inspected.id).map((tool) => tool.name));
    return (inspected.agent?.toolMounts ?? [])
      .map((tool) => tool.name)
      .filter((name) => !available.has(name));
  }, [inspected, kernel, catalog]);

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

  const saveAgent = async (agent: RuntimeProfileAgentSettings) => {
    if (busy) return;
    setBusy(true);
    try {
      service.updateAgentSettings(inspected.id, agent);
      refresh();
      await showCustomAlert("Agent 配置已保存。", "保存成功");
    } catch (error: unknown) {
      await showCustomAlert(normalizeError(error), "保存 Agent 失败");
    } finally {
      setBusy(false);
    }
  };

  const saveAgentAndStart = async (agent: RuntimeProfileAgentSettings) => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = service.updateAgentSettings(inspected.id, agent);
      const result = prepareRuntimeProfileAgentLaunch({
        service,
        profile: updated,
        availableCharacterIds: characters.map((character) => character.id),
        availablePromptPresetIds: (settings.savedPresets ?? []).map((preset) => preset.id),
        availableTools: listToolsForProfile(kernel, updated.id),
      });
      if (result.status === "unavailable") {
        refresh();
        setBusy(false);
        await showCustomAlert(result.message, "无法开始 Agent");
        return;
      }
      await destroyApplicationRuntime();
      window.location.reload();
    } catch (error: unknown) {
      setBusy(false);
      await showCustomAlert(normalizeError(error), "启动 Agent 失败");
    }
  };

  const exportProfile = async () => {
    try {
      const character = characters.find((candidate) => candidate.id === inspected.agent?.characterId);
      const promptPreset = (settings.savedPresets ?? []).find(
        (candidate) => candidate.id === inspected.agent?.promptPresetId,
      );
      const characterId = inspected.agent?.characterId;
      const promptPresetId = inspected.agent?.promptPresetId;
      const prepared = prepareAgentProfileBundleExport({
        profile: inspected,
        character: character
          ? { id: character.id, name: character.name }
          : characterId ? { id: characterId, name: characterId } : undefined,
        promptPreset: promptPreset
          ? { id: promptPreset.id, name: promptPreset.preset.name }
          : promptPresetId ? { id: promptPresetId, name: promptPresetId } : undefined,
      });
      const location = saveJsonFile(prepared.fileName, JSON.stringify(prepared.data, null, 2));
      await showCustomAlert(
        location ? `Agent Profile 已保存：${location}` : `Agent Profile 已下载：${prepared.fileName}`,
        "导出成功",
      );
    } catch (error: unknown) {
      await showCustomAlert(normalizeError(error), "导出 Agent 失败");
    }
  };

  const importProfile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_AGENT_PROFILE_FILE_SIZE) throw new Error("AGENT_PROFILE_FILE_TOO_LARGE");
      const input = JSON.parse(await file.text()) as unknown;
      const prepared = prepareAgentProfileBundleImport({
        input,
        existingProfileIds: catalog.profiles.map((profile) => profile.id),
        availableCharacterIds: characters.map((character) => character.id),
        availablePromptPresetIds: (settings.savedPresets ?? []).map((preset) => preset.id),
        availableTools: listAllKnownTools(kernel),
      });
      const created = service.createProfile(prepared.profile);
      refresh();
      setInspectedId(created.id);
      const diagnosticText = prepared.diagnostics.length > 0
        ? `\n\n需要处理：\n${prepared.diagnostics.map((item) => `• ${item.message}`).join("\n")}`
        : "";
      await showCustomAlert(`已导入「${created.name}」。${diagnosticText}`, "导入完成");
    } catch (error: unknown) {
      await showCustomAlert(
        normalizeImportError(error),
        "导入 Agent 失败",
      );
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
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

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background/70 px-3 text-xs font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary active:bg-muted disabled:opacity-50"
          >
            <Upload aria-hidden="true" className="h-4 w-4" />导入 Agent 文件
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportProfile()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background/70 px-3 text-xs font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary active:bg-muted disabled:opacity-50"
          >
            <Download aria-hidden="true" className="h-4 w-4" />导出当前 Agent
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="导入 Agent Profile JSON 文件"
            className="hidden"
            onChange={(event) => void importProfile(event.target.files?.[0])}
          />
        </div>

        <AgentProfileEditor
          profile={inspected}
          characters={characters}
          promptPresets={settings.savedPresets ?? []}
          fallbackSampling={settings.preset}
          tools={editableTools}
          unavailableToolNames={unavailableToolNames}
          busy={busy}
          onSave={saveAgent}
          onSaveAndStart={saveAgentAndStart}
        />

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

function listToolsForProfile(
  kernel: ReturnType<typeof useKernel>,
  profileId: string,
): RuntimeProfileToolMount[] {
  const all = listAllKnownTools(kernel);
  if (!kernel.hasService(KernelServices.ToolConnectors)) return all.filter(isBuiltinTool);
  const enabled = new Set(
    kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors)
      .getEnabledToolNames(profileId),
  );
  return all.filter((tool) => isBuiltinTool(tool) || enabled.has(tool.name));
}

function listAllKnownTools(kernel: ReturnType<typeof useKernel>): RuntimeProfileToolMount[] {
  const versions = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool.version]));
  if (kernel.hasService(KernelServices.AgentRuntime)) {
    kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      .listTools()
      .forEach((tool) => versions.set(tool.name, tool.version));
  }
  return [...versions.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isBuiltinTool(tool: RuntimeProfileToolMount): boolean {
  return tool.name === CHARACTER_READ_TOOL_NAME || tool.name === SESSION_BRANCH_TOOL_NAME;
}

function mergeToolMounts(
  first: readonly RuntimeProfileToolMount[],
  second: readonly RuntimeProfileToolMount[],
): RuntimeProfileToolMount[] {
  const tools = new Map<string, RuntimeProfileToolMount>();
  [...first, ...second].forEach((tool) => {
    if (!tools.has(tool.name)) tools.set(tool.name, { ...tool });
  });
  return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
}

interface AndroidFileBridge {
  saveFile?: (fileName: string, content: string) => string;
}

function saveJsonFile(fileName: string, content: string): string | null {
  const bridge = (window as Window & { AndroidThemeBridge?: AndroidFileBridge }).AndroidThemeBridge;
  if (typeof bridge?.saveFile === "function") {
    const path = bridge.saveFile(fileName, content);
    if (!path || path.startsWith("error:")) throw new Error("AGENT_PROFILE_EXPORT_FAILED");
    return path;
  }
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return null;
}

function normalizeImportError(error: unknown): string {
  const message = normalizeError(error);
  if (message.includes("AGENT_PROFILE_FILE_TOO_LARGE")) return "文件超过 512 KB，请选择有效的 Agent Profile 文件。";
  if (message.includes("AGENT_PROFILE_BUNDLE_INVALID") || error instanceof SyntaxError) {
    return "文件格式无效。请选择由 Mobile Tavern 导出的 Agent Profile JSON。";
  }
  return message;
}
