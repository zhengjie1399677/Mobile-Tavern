import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  Wrench,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
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
  const [editorOpen, setEditorOpen] = useState(false);
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
      setEditorOpen(false);
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
      setEditorOpen(false);
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

  return (
    <section className="runtime-profile-shell space-y-3 pb-2">
      {/* 顶部标题与导入 */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          选择运行模式 / Profile
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
            className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline active:scale-95"
          >
            <Upload className="h-3 w-3" />
            <span>导入 Agent</span>
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
      </div>

      {/* 核心自包含 Agent 模式卡片列表（直观切换与直接装配，拒绝重复大卡片） */}
      <div className="space-y-2.5">
        {catalog.profiles.map((profile) => {
          const active = isActive(profile);
          const isTavern = profile.capabilities.sillyTavernCompatibility;
          const profileBoundCharacter = characters.find((c) => c.id === profile.agent?.characterId);
          const profileBoundPreset = (settings.savedPresets ?? []).find((p) => p.id === profile.agent?.promptPresetId);
          const profileToolsCount = profile.agent?.toolMounts.length ?? 0;

          return (
            <div
              key={profile.id}
              className={`surface-card rounded-2xl p-4 transition-all space-y-3 ${
                active
                  ? "border-primary/60 bg-primary/10 ring-1 ring-primary/25 shadow-xs"
                  : "border-border/60 bg-card/60 hover:border-primary/30"
              }`}
            >
              {/* 头部：图标、名称、状态徽章与操作按钮 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    isTavern ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-primary/15 text-primary"
                  }`}>
                    {isTavern ? <Sparkles className="h-4.5 w-4.5" /> : <Bot className="h-4.5 w-4.5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-foreground truncate">
                        {profile.name}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
                        v{profile.version}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {isTavern ? "SillyTavern 兼容扩展 · 角色卡/世界书/宏" : "纯净原生通用 Agent · 零外部规则干扰"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {active ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      运行中
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void activateProfile(profile, "切换并应用")}
                      className="flex h-8 items-center gap-1 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-3 text-xs font-bold transition-all active:scale-95 shadow-xs"
                    >
                      <Power className="h-3.5 w-3.5" />
                      <span>切换运行</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 紧凑装配插槽与快捷操作行 */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground flex-wrap min-w-0">
                  <span className="inline-flex items-center gap-1 truncate">
                    <User className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                    <span>{profileBoundCharacter?.name || "通用助手"}</span>
                  </span>
                  <span className="text-border/80">·</span>
                  <span className="inline-flex items-center gap-1 truncate">
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                    <span>{profileBoundPreset?.preset.name || "默认预设"}</span>
                  </span>
                  {profileToolsCount > 0 && (
                    <>
                      <span className="text-border/80">·</span>
                      <span className="inline-flex items-center gap-1 truncate">
                        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                        <span>{profileToolsCount} 个工具</span>
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setInspectedId(profile.id);
                      setEditorOpen(true);
                    }}
                    className="flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-background/60 hover:bg-muted px-2 text-[11px] font-semibold text-foreground transition-all active:scale-95"
                  >
                    <Settings2 className="h-3 w-3 text-primary" />
                    <span>装配</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyProfile(profile)}
                    className="p-1.5 rounded-lg border border-border/60 bg-background/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
                    title="复制 Agent"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setInspectedId(profile.id);
                      void exportProfile();
                    }}
                    className="p-1.5 rounded-lg border border-border/60 bg-background/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
                    title="导出 Agent"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  {!profile.builtin && (
                    <button
                      type="button"
                      onClick={() => void deleteProfile(profile)}
                      className="p-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-all active:scale-95"
                      title="删除 Agent"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 诊断与降级策略折叠抽屉 */}
      <details className="group border border-border/60 bg-card/40 rounded-2xl p-3 backdrop-blur-md">
        <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-bold text-muted-foreground hover:text-foreground transition select-none">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            底层能力与技术诊断参数
          </span>
          <span className="text-[10px] font-mono group-open:rotate-90 transition-transform">▶</span>
        </summary>

        <div className="pt-3 space-y-3">
          {inspected.builtin ? (
            <div className="flex flex-wrap gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
                inspected.capabilities.sillyTavernCompatibility
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-muted/80 text-muted-foreground"
              }`}>
                {inspected.capabilities.sillyTavernCompatibility ? "✓ SillyTavern 兼容插件" : "✕ 纯净底座 (无兼容插件)"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                ✓ 音频 ASR 降级
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                ✓ 视频关键帧提取降级
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <SettingsToggleRow
                label="SillyTavern 兼容能力贡献"
                description="自定义 Profile 可独立启用 SillyTavern 兼容贡献。"
                checked={inspected.capabilities.sillyTavernCompatibility}
                disabled={busy}
                onCheckedChange={(checked) => updateCapability(inspected, { sillyTavernCompatibility: checked })}
                badge="自定义"
              />
              <SettingsToggleRow
                label="音频 → ASR 文本降级"
                description="当模型不支持音频输入时，自动转换为文本发送。"
                checked={inspected.capabilities.audioAsrFallback}
                disabled={busy}
                onCheckedChange={(checked) => updateCapability(inspected, { audioAsrFallback: checked })}
              />
              <SettingsToggleRow
                label="视频 → 关键帧图片降级"
                description="当模型不支持视频输入时，自动提取关键帧发送。"
                checked={inspected.capabilities.videoKeyframeFallback}
                disabled={busy}
                onCheckedChange={(checked) => updateCapability(inspected, { videoKeyframeFallback: checked })}
              />
            </div>
          )}

          <div className="grid gap-1.5 text-xs sm:grid-cols-2 pt-2 border-t border-border/40">
            <DiagnosticRow label="Provider" value={`${diagnostics.provider.id}${diagnostics.provider.available ? "" : "（缺失）"}`} />
            <DiagnosticRow label="输入模态" value={diagnostics.provider.inputModalities.join(" / ") || "无"} />
            <DiagnosticRow label="Tools" value={diagnostics.tools.join("、") || "未注册"} />
            <DiagnosticRow label="Renderer" value={diagnostics.renderers.join("、") || "普通文本"} />
          </div>

          {diagnostics.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="text-xs">{warning}</span>
            </div>
          ))}
        </div>
      </details>

      {/* 4. Agent 编辑 Dialog 弹窗（避免在设置列表内直接内嵌庞大表单） */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-4 custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              <span>装配与编辑 Agent - {inspected.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">
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
          </div>
        </DialogContent>
      </Dialog>

      <p className="text-xs leading-relaxed text-muted-foreground/75 px-1">
        Runtime Plugin 目前只允许随安装包分发的受信实现。签名、来源验证与回滚机制完成前，不开放任意 Runtime Plugin 安装。
      </p>
    </section>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/50 p-2 border border-border/40 shadow-2xs">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 break-words font-mono text-[10px] leading-relaxed text-foreground">{value}</div>
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
