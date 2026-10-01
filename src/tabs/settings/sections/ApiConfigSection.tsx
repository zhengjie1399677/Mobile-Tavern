import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Edit2,
  Eye,
  EyeOff,
  KeySquare,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../../components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import SettingsToggleRow from "../SettingsToggleRow";
import ReasoningStrengthRow from "../ReasoningStrengthRow";

export type SaveState = "idle" | "saving" | "saved";

export interface ApiConfigSectionProps
  extends Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "availableModels"
    | "isFetchingModels"
    | "handleFetchModels"
    | "testApiConnection"
    | "connectionStatus"
    | "showCustomPrompt"
    | "showCustomConfirm"
  > {
  saveState: SaveState;
  freeCount: number;
}

const PRESET_PROVIDERS = [
  { n: "DeepSeek", u: "https://api.deepseek.com/v1", m: "deepseek-chat" },
  { n: "OpenAI", u: "https://api.openai.com/v1", m: "gpt-4o" },
  { n: "Gemini", u: "https://generativelanguage.googleapis.com/v1beta/openai/", m: "gemini-2.0-flash" },
  { n: "Together", u: "https://api.together.xyz/v1", m: "" },
  { n: "Groq", u: "https://api.groq.com/openai/v1", m: "" },
];

export default function ApiConfigSection({
  settings,
  updateSettings,
  availableModels,
  isFetchingModels,
  handleFetchModels,
  testApiConnection,
  connectionStatus,
  showCustomPrompt,
  showCustomConfirm,
  saveState,
  freeCount,
}: ApiConfigSectionProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [isManualInput, setIsManualInput] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeProfile = (settings.savedApiProfiles || []).find(
    (p) => p.id === settings.currentApiProfileId
  );

  const isTesting = Boolean(connectionStatus?.testing);

  return (
    <AccordionItem value="api-config" className="settings-connection-item overflow-hidden">
      <AccordionTrigger className="settings-panel-trigger px-3 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="settings-panel-icon shrink-0">
              <KeySquare className="w-4 h-4 text-primary" />
            </span>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs sm:text-[13px] font-bold text-foreground shrink-0">
                  {t("api.title")}
                </span>
                {saveState === "saving" && (
                  <span className="text-[10px] text-sky-500 flex items-center gap-1 font-semibold animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                    {t("api.saving")}
                  </span>
                )}
                {saveState === "saved" && (
                  <span className="text-[10px] text-emerald-500 flex items-center gap-1 font-semibold animate-in fade-in duration-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t("api.saved")}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground/75 font-normal truncate max-w-[150px] sm:max-w-none">
                {t("api.subtitle")}
              </span>
            </div>
          </div>
          {connectionStatus?.testing ? (
            <span className="shrink-0 items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-500 animate-pulse">
              测试中...
            </span>
          ) : connectionStatus?.success === true ? (
            <span className="shrink-0 items-center rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 max-w-[120px] sm:max-w-[160px] truncate">
              已连接 · {settings.api.modelName || settings.api.type || "OK"}
            </span>
          ) : connectionStatus?.success === false ? (
            <span className="shrink-0 items-center rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-600 dark:text-rose-400">
              连接异常
            </span>
          ) : settings.api.modelName ? (
            <span className="shrink-0 items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary max-w-[120px] sm:max-w-[160px] truncate">
              {settings.api.modelName}
            </span>
          ) : settings.api.type ? (
            <span className="shrink-0 items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
              {settings.api.type}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>

      <AccordionContent className="p-3 space-y-3 border-t border-border/50 bg-card/25">
        {/* 1. 通道档案紧凑选择栏 (单行高度，告别大黑块) */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border/60">
          <div className="flex-1 min-w-0">
            <Select
              aria-label={t("api.select_profile")}
              value={settings.currentApiProfileId || "temp"}
              onValueChange={(val) => {
                if (val === "temp") {
                  updateSettings((prev) => ({
                    ...prev,
                    currentApiProfileId: "",
                  }));
                } else {
                  const target = (settings.savedApiProfiles || []).find((p) => p.id === val);
                  if (target) {
                    updateSettings((prev) => ({
                      ...prev,
                      currentApiProfileId: val ?? "",
                      api: {
                        ...prev.api,
                        type: target.type,
                        baseUrl: target.baseUrl,
                        apiKey: target.apiKey,
                        modelName: target.modelName,
                        chatPath: target.chatPath,
                        modelsPath: target.modelsPath,
                        bypassProxy: target.bypassProxy,
                        disableReasoning: target.disableReasoning,
                        reasoningStrength: target.reasoningStrength,
                        forceBasicParams: target.forceBasicParams,
                        supportsVision: target.supportsVision,
                        supportsAudioInput: target.supportsAudioInput,
                      },
                    }));
                  }
                }
              }}
            >
              <SelectTrigger className="h-7.5 rounded-lg bg-background/90 border-none text-xs w-full truncate shadow-none font-medium">
                <SelectValue placeholder={t("api.select_profile")}>
                  {(() => {
                    if (!settings.currentApiProfileId) return t("api.temp_profile");
                    return activeProfile ? `🔌 ${activeProfile.name}` : t("api.temp_profile");
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="temp" className="text-xs">
                  {t("api.temp_profile")}
                </SelectItem>
                {(settings.savedApiProfiles || []).map((prof) => (
                  <SelectItem key={prof.id} value={prof.id} className="text-xs font-mono">
                    🔌 {prof.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            onClick={async () => {
              const name = await showCustomPrompt(
                "Enter profile name / 请输入新 API 通道的别名:",
                ""
              );
              if (name && name.trim()) {
                const newId = "profile_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
                const newProfile = {
                  id: newId,
                  name: name.trim(),
                  type: settings.api.type,
                  baseUrl: settings.api.baseUrl,
                  apiKey: settings.api.apiKey,
                  modelName: settings.api.modelName,
                  chatPath: settings.api.chatPath,
                  modelsPath: settings.api.modelsPath,
                  bypassProxy: settings.api.bypassProxy,
                  disableReasoning: settings.api.disableReasoning,
                  reasoningStrength: settings.api.reasoningStrength,
                  forceBasicParams: settings.api.forceBasicParams,
                  supportsVision: settings.api.supportsVision,
                  supportsAudioInput: settings.api.supportsAudioInput,
                };
                updateSettings((prev) => ({
                  ...prev,
                  savedApiProfiles: [...(prev.savedApiProfiles || []), newProfile],
                  currentApiProfileId: newId,
                }));
              }
            }}
            className="h-7.5 px-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/25 text-primary text-xs font-semibold rounded-lg transition shrink-0 active:scale-95 flex items-center gap-1"
            title={t("api.save_profile")}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>另存</span>
          </button>

          {settings.currentApiProfileId && activeProfile && (
            <>
              <button
                type="button"
                onClick={async () => {
                  const newName = await showCustomPrompt(
                    "Rename profile / 重命名通道别名:",
                    activeProfile.name
                  );
                  if (newName && newName.trim()) {
                    updateSettings((prev) => ({
                      ...prev,
                      savedApiProfiles: (prev.savedApiProfiles || []).map((p) =>
                        p.id === settings.currentApiProfileId ? { ...p, name: newName.trim() } : p
                      ),
                    }));
                  }
                }}
                className="h-7.5 w-7.5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 shrink-0 transition"
                title={t("api.rename")}
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await showCustomConfirm(
                    `Are you sure you want to delete profile【${activeProfile.name}】? / 确定要删除通道吗？`
                  );
                  if (ok) {
                    updateSettings((prev) => ({
                      ...prev,
                      savedApiProfiles: (prev.savedApiProfiles || []).filter(
                        (p) => p.id !== settings.currentApiProfileId
                      ),
                      currentApiProfileId: "",
                    }));
                  }
                }}
                className="h-7.5 w-7.5 flex items-center justify-center text-rose-500 hover:text-rose-600 rounded-lg hover:bg-rose-500/10 shrink-0 transition"
                title={t("api.delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* 2. 快捷服务商预设芯片 (横向滚动的轻量级胶囊) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">服务商:</span>
          {PRESET_PROVIDERS.map((preset) => {
            const isCurrent = settings.api.baseUrl === preset.u;
            return (
              <button
                key={preset.n}
                type="button"
                onClick={() => {
                  updateSettings((prev) => ({
                    ...prev,
                    currentApiProfileId: "",
                    api: {
                      ...prev.api,
                      baseUrl: preset.u,
                      ...(preset.m &&
                      (!prev.api.modelName ||
                        prev.api.modelName === "gpt-4o" ||
                        prev.api.modelName === "deepseek-chat" ||
                        prev.api.modelName === "gemini-2.0-flash")
                        ? { modelName: preset.m }
                        : {}),
                    },
                  }));
                }}
                className={`h-7 px-2.5 rounded-lg text-xs font-mono shrink-0 transition-all active:scale-95 border ${
                  isCurrent
                    ? "bg-primary text-primary-foreground border-primary font-semibold shadow-xs"
                    : "bg-background/80 text-muted-foreground hover:text-foreground border-border/70 hover:border-primary/40 font-medium"
                }`}
              >
                {preset.n}
              </button>
            );
          })}
        </div>

        {/* 3. 核心连接输入三项 (紧凑整合，无需嵌套小节) */}
        <div className="space-y-2.5">
          {/* Base URL */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-foreground">
                {t("api.base_url")}
              </label>
              {settings.api.savedUrls && settings.api.savedUrls.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    updateSettings((prev) => ({ ...prev, api: { ...prev.api, savedUrls: [] } }))
                  }
                  className="text-[11px] text-destructive/80 hover:text-destructive font-medium"
                >
                  {t("api.clear_history")}
                </button>
              )}
            </div>
            <Input
              list="saved-api-urls"
              value={settings.api.baseUrl || ""}
              onBlur={() => {
                const trimmedUrl = settings.api.baseUrl?.trim();
                if (trimmedUrl && trimmedUrl !== settings.api.baseUrl) {
                  updateSettings((prev) => ({
                    ...prev,
                    api: { ...prev.api, baseUrl: trimmedUrl },
                  }));
                }
                if (trimmedUrl && !settings.api.savedUrls?.includes(trimmedUrl)) {
                  updateSettings((prev) => ({
                    ...prev,
                    api: {
                      ...prev.api,
                      savedUrls: [...(prev.api.savedUrls || []), trimmedUrl],
                    },
                  }));
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "",
                  api: { ...prev.api, baseUrl: val },
                }));
              }}
              className="h-8.5 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
              placeholder="https://api.openai.com/v1"
            />
            <datalist id="saved-api-urls">
              {settings.api.savedUrls?.map((url, idx) => (
                <option key={idx} value={url} />
              ))}
            </datalist>
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground block">
              {t("api.api_key")}
            </label>
            <div className="relative w-full">
              <Input
                type={showKey ? "text" : "password"}
                className="font-mono text-xs h-8.5 rounded-xl bg-background/80 border-border/70 pr-9 shadow-2xs w-full"
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                value={settings.api.apiKey || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  updateSettings((prev) => ({
                    ...prev,
                    currentApiProfileId: "",
                    api: { ...prev.api, apiKey: val },
                  }));
                }}
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {!settings.api.apiKey || !settings.api.apiKey.trim() ? (
              <p className="text-[11px] text-primary/90 flex items-center gap-1.5 font-medium bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{t("api.free_tier", { count: String(freeCount) })}</span>
              </p>
            ) : null}
          </div>

          {/* Model Selection */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-foreground flex items-center gap-1.5">
                <span>{t("api.model_id")}</span>
                {availableModels.length > 0 && (
                  <span className="text-[10px] font-mono text-primary font-semibold bg-primary/10 px-1.5 py-0.2 rounded-md">
                    {availableModels.length} 个
                  </span>
                )}
              </label>
              {availableModels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsManualInput(!isManualInput)}
                  className="text-xs text-muted-foreground hover:text-primary font-medium transition-colors underline-offset-2 hover:underline"
                >
                  {isManualInput ? "选择预设列表" : "手动输入"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {availableModels.length > 0 && !isManualInput ? (
                  <Select
                    aria-label={t("api.model_id")}
                    value={settings.api.modelName || ""}
                    onValueChange={(val) =>
                      updateSettings((prev) => ({
                        ...prev,
                        api: { ...prev.api, modelName: val ?? "" },
                      }))
                    }
                  >
                    <SelectTrigger className="w-full text-xs h-8.5 rounded-xl bg-background/80 border-border/70 font-mono shadow-2xs font-medium">
                      <SelectValue placeholder={t("api.select_model_placeholder")}>
                        {settings.api.modelName || t("api.select_model_placeholder")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m} value={m} className="text-xs font-mono">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={settings.api.modelName || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateSettings((prev) => ({
                        ...prev,
                        api: { ...prev.api, modelName: val },
                      }));
                    }}
                    className="h-8.5 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
                    placeholder="gpt-4o / deepseek-chat"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={isFetchingModels}
                className="h-8.5 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/25 text-primary text-xs font-semibold rounded-xl disabled:opacity-50 active:scale-95 transition-all flex items-center gap-1 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? "animate-spin" : ""}`} />
                <span>
                  {isFetchingModels
                    ? t("api.fetching_models")
                    : availableModels.length > 0
                      ? "刷新模型"
                      : t("api.fetch_models")}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 4. 核心操作与测试反馈栏 */}
        <div className="pt-1 space-y-2">
          <button
            type="button"
            onClick={testApiConnection}
            disabled={isTesting}
            className="w-full h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
          >
            <Zap className={`w-4 h-4 ${isTesting ? "animate-bounce" : ""}`} />
            <span>{isTesting ? "正在测试连接与验证端点..." : "测试连接并保存"}</span>
          </button>

          {connectionStatus?.message && (
            <div
              className={`flex items-start gap-2 rounded-xl p-2.5 text-xs font-mono border backdrop-blur-xs ${
                connectionStatus.success
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              {connectionStatus.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1 break-all text-[11px] leading-relaxed">
                {connectionStatus.message}
              </div>
            </div>
          )}
        </div>

        {/* 5. 高级参数与模型特性 (轻量折叠收纳，不挤占核心视图) */}
        <div className="rounded-xl border border-border/50 bg-background/50 overflow-hidden mt-1">
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-primary" />
              高级参数与特性兼容 (容量、格式、多模态)
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showAdvanced ? "rotate-180" : ""
              }`}
            />
          </button>

          {showAdvanced && (
            <div className="p-3 border-t border-border/40 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
              {/* contextLimit Input */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  {t("api.context_limit")}
                </label>
                <Input
                  type="number"
                  value={settings.api.contextLimit ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, contextLimit: val },
                    }));
                  }}
                  className="h-8.5 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
                  placeholder="留空则自动匹配大模型默认容量限制 (如 128k)"
                />
              </div>

              {/* Prompt Rendering Format */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  {t("api.prompt_format")}
                </label>
                <Select
                  aria-label={t("api.prompt_format")}
                  value={settings.promptConfig?.renderingFormat || "auto"}
                  onValueChange={(val: "auto" | "xml" | "markdown") =>
                    updateSettings((prev) => ({
                      ...prev,
                      promptConfig: {
                        ...prev.promptConfig,
                        renderingFormat: val,
                      },
                    }))
                  }
                >
                  <SelectTrigger className="w-full text-xs h-8.5 rounded-xl bg-background/80 border-border/70 shadow-2xs font-medium">
                    <SelectValue placeholder={t("api.format_auto")}>
                      {settings.promptConfig?.renderingFormat === "xml"
                        ? t("api.format_xml")
                        : settings.promptConfig?.renderingFormat === "markdown"
                          ? t("api.format_markdown")
                          : t("api.format_auto")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs">{t("api.format_auto")}</SelectItem>
                    <SelectItem value="xml" className="text-xs">{t("api.format_xml")}</SelectItem>
                    <SelectItem value="markdown" className="text-xs">{t("api.format_markdown")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Capability Toggles */}
              <div className="space-y-2 pt-1 border-t border-border/40">
                <SettingsToggleRow
                  label="模型直接听语音"
                  description="仅在当前模型支持 OpenAI-compatible input_audio 时启用"
                  checked={settings.api.supportsAudioInput === true}
                  onCheckedChange={(checked) =>
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, supportsAudioInput: checked },
                    }))
                  }
                />

                <SettingsToggleRow
                  label="图片输入能力"
                  description="仅在当前模型明确支持视觉输入时启用；缺省关闭"
                  checked={settings.api.supportsVision === true}
                  onCheckedChange={(checked) =>
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, supportsVision: checked },
                    }))
                  }
                />

                <SettingsToggleRow
                  label={t("api.fallback_title")}
                  description={t("api.fallback_desc")}
                  checked={settings.api.forceBasicParams || false}
                  onCheckedChange={(checked) =>
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, forceBasicParams: checked },
                    }))
                  }
                />

                <SettingsToggleRow
                  label={t("api.send_names_title")}
                  description={t("api.send_names_desc")}
                  checked={settings.api.sendNames || false}
                  onCheckedChange={(checked) =>
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, sendNames: checked },
                    }))
                  }
                />

                <ReasoningStrengthRow
                  label={t("api.reasoning_strength_title")}
                  description={t("api.reasoning_strength_desc")}
                  value={
                    settings.api.reasoningStrength ??
                    (settings.api.disableReasoning ? "off" : "auto")
                  }
                  modelId={settings.api.modelName}
                  baseUrl={settings.api.baseUrl}
                  onChange={(value) =>
                    updateSettings((prev) => ({
                      ...prev,
                      api: { ...prev.api, reasoningStrength: value },
                    }))
                  }
                />
              </div>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
