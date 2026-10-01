import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeySquare,
  Layers,
  Link2,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
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

  return (
    <AccordionItem value="api-config" className="settings-connection-item overflow-hidden">
      <AccordionTrigger className="settings-panel-trigger px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center justify-between w-full pr-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="settings-panel-icon"><KeySquare className="w-4 h-4 text-primary" /></span>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-[13px] font-semibold text-foreground">{t("api.title")}</span>
                {saveState === "saving" && (
                  <span className="text-[9px] text-sky-500 flex items-center gap-1 font-semibold animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                    {t("api.saving")}
                  </span>
                )}
                {saveState === "saved" && (
                  <span className="text-[9px] text-emerald-500 flex items-center gap-1 font-semibold animate-in fade-in duration-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t("api.saved")}
                  </span>
                )}
              </div>
              <span className="text-[10.5px] text-muted-foreground/75 font-normal truncate">{t("api.subtitle")}</span>
            </div>
          </div>
          {connectionStatus?.testing ? (
            <span className="shrink-0 items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-sky-500 animate-pulse">
              测试中...
            </span>
          ) : connectionStatus?.success === true ? (
            <span className="shrink-0 items-center rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 max-w-[150px] truncate">
              已连接 · {settings.api.modelName || settings.api.type || "OK"}
            </span>
          ) : connectionStatus?.success === false ? (
            <span className="shrink-0 items-center rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-rose-600 dark:text-rose-400">
              连接异常
            </span>
          ) : settings.api.modelName ? (
            <span className="shrink-0 items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary max-w-[150px] truncate">
              {settings.api.modelName}
            </span>
          ) : settings.api.type ? (
            <span className="shrink-0 items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary">
              {settings.api.type}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>
      <AccordionContent className="settings-panel-content settings-form p-0 border-t border-border/50">
        {/* 1. API 通道配置档案选择与切换 */}
        <section className="settings-form-group">
          <div className="flex items-center justify-between mb-2 select-none">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-bold text-foreground">API 通道档案</h3>
            </div>
            {settings.currentApiProfileId && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const activeId = settings.currentApiProfileId;
                    const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                    if (!currentProf) return;
                    const newName = await showCustomPrompt(
                      "Rename profile / 重命名通道别名:",
                      currentProf.name
                    );
                    if (newName && newName.trim()) {
                      updateSettings((prev) => ({
                        ...prev,
                        savedApiProfiles: (prev.savedApiProfiles || []).map((p) =>
                          p.id === activeId ? { ...p, name: newName.trim() } : p
                        ),
                      }));
                    }
                  }}
                  className="text-[10px] text-muted-foreground hover:text-primary transition font-medium"
                >
                  {t("api.rename")}
                </button>
                <span className="text-border text-[10px]">|</span>
                <button
                  type="button"
                  onClick={async () => {
                    const activeId = settings.currentApiProfileId;
                    const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                    if (!currentProf) return;
                    const ok = await showCustomConfirm(
                      `确定要删除通道【${currentProf.name}】吗？`
                    );
                    if (ok) {
                      updateSettings((prev) => ({
                        ...prev,
                        savedApiProfiles: (prev.savedApiProfiles || []).filter((p) => p.id !== activeId),
                        currentApiProfileId: "",
                      }));
                    }
                  }}
                  className="text-[10px] text-rose-500 hover:text-rose-700 transition font-medium"
                >
                  {t("api.delete")}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
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
                <SelectTrigger className="h-9 rounded-xl bg-background/80 border-border/70 text-xs w-full truncate shadow-2xs font-medium">
                  <SelectValue placeholder={t("api.select_profile")}>
                    {(() => {
                      if (!settings.currentApiProfileId) return t("api.temp_profile");
                      const currentProf = (settings.savedApiProfiles || []).find(
                        (p) => p.id === settings.currentApiProfileId
                      );
                      return currentProf ? `🔌 ${currentProf.name}` : t("api.temp_profile");
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
              className="h-9 px-3 bg-primary/10 border border-primary/25 text-primary text-xs font-bold rounded-xl hover:bg-primary/20 transition shrink-0 active:scale-95 shadow-2xs flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>另存为通道</span>
            </button>
          </div>
        </section>

        {/* 2. 连接端点与密钥 */}
        <section className="settings-form-group">
          <div className="flex items-center gap-1.5 mb-2.5 select-none">
            <Link2 className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">连接与密钥</h3>
          </div>

          <div className="space-y-3.5">
            {/* Base URL */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-semibold text-muted-foreground">
                <span>{t("api.base_url")}</span>
                <span className="text-[10px] text-muted-foreground/60 font-normal">支持自动记录历史地址</span>
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
                className="h-9 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
                placeholder="https://api.openai.com/v1"
              />
              <datalist id="saved-api-urls">
                {settings.api.savedUrls?.map((url, idx) => (
                  <option key={idx} value={url} />
                ))}
              </datalist>

              {/* 快捷服务商预设芯片 */}
              <div className="flex gap-1.5 flex-wrap pt-0.5 items-center">
                <span className="text-[10px] text-muted-foreground/70 shrink-0 font-medium">快捷填入:</span>
                {[
                  { n: "DeepSeek", u: "https://api.deepseek.com/v1" },
                  { n: "OpenAI", u: "https://api.openai.com/v1" },
                  { n: "Gemini", u: "https://generativelanguage.googleapis.com/v1beta/openai/" },
                  { n: "Together", u: "https://api.together.xyz/v1" },
                  { n: "Groq", u: "https://api.groq.com/openai/v1" },
                ].map((preset) => (
                  <button
                    key={preset.n}
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({
                        ...prev,
                        currentApiProfileId: "",
                        api: { ...prev.api, baseUrl: preset.u },
                      }))
                    }
                    className="text-[10px] font-medium font-mono bg-muted/40 hover:bg-primary/10 text-muted-foreground hover:text-primary px-2 py-0.5 rounded-md border border-border/50 hover:border-primary/30 active:scale-95 transition-all"
                  >
                    {preset.n}
                  </button>
                ))}
                {settings.api.savedUrls && settings.api.savedUrls.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateSettings((prev) => ({ ...prev, api: { ...prev.api, savedUrls: [] } }))}
                    className="text-[9.5px] text-muted-foreground/60 hover:text-destructive ml-auto transition-colors"
                  >
                    {t("api.clear_history")}
                  </button>
                )}
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-semibold text-muted-foreground">
                <span>{t("api.api_key")}</span>
                <span className="text-[10px] text-muted-foreground/60 font-normal">保存在本地受控存储中</span>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    className="font-mono text-xs h-9 rounded-xl bg-background/80 border-border/70 pr-8 shadow-2xs"
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
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                  className="h-9 px-3.5 bg-primary/10 border border-primary/30 text-primary text-xs font-bold rounded-xl hover:bg-primary/20 hover:border-primary/40 disabled:opacity-50 whitespace-nowrap active:scale-95 transition-all shadow-2xs flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? "animate-spin" : ""}`} />
                  <span>{isFetchingModels ? t("api.fetching_models") : t("api.fetch_models")}</span>
                </button>
              </div>

              {!settings.api.apiKey || !settings.api.apiKey.trim() ? (
                <div className="text-[10px] text-primary/90 flex items-center gap-1.5 font-medium bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20">
                  <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>{t("api.free_tier", { count: String(freeCount) })}</span>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/75 leading-tight pt-0.5">
                  {t("api.exclusive_tier")}
                </p>
              )}

              {connectionStatus?.message && (
                <div
                  className={`mt-2 flex items-start gap-2 rounded-xl p-2.5 text-xs font-mono border backdrop-blur-xs ${
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
                  <div className="min-w-0 flex-1 break-all text-[10.5px] leading-relaxed">
                    {connectionStatus.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 3. 模型与上下文容量 */}
        <section className="settings-form-group">
          <div className="flex items-center gap-1.5 mb-2.5 select-none">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">模型与容量</h3>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
                <span>{t("api.model_id")}</span>
                {availableModels.length > 0 && (
                  <span className="text-[10px] font-mono text-primary">已获取 {availableModels.length} 个可用模型</span>
                )}
              </label>
              {availableModels.length > 0 ? (
                <Select
                  aria-label={t("api.model_id")}
                  value={settings.api.modelName || ""}
                  onValueChange={(val) =>
                    updateSettings((prev) => ({
                      ...prev,
                      currentApiProfileId: "",
                      api: { ...prev.api, modelName: val ?? "" },
                    }))
                  }
                >
                  <SelectTrigger className="w-full text-xs h-9 rounded-xl bg-background/80 border-border/70 font-mono shadow-2xs">
                    <SelectValue placeholder={t("api.select_model_placeholder")}>
                      {settings.api.modelName || t("api.select_model_placeholder")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {availableModels.map((m) => (
                      <SelectItem
                        key={m}
                        value={m}
                        className="text-xs font-mono"
                      >
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
                      currentApiProfileId: "",
                      api: { ...prev.api, modelName: val },
                    }));
                  }}
                  className="h-9 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
                  placeholder="gpt-4o / deepseek-chat"
                />
              )}
            </div>

            {/* contextLimit Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
                <span>{t("api.context_limit")}</span>
                <span className="text-[10px] text-muted-foreground/60">{t("api.context_limit_tip")}</span>
              </label>
              <Input
                type="number"
                value={settings.api.contextLimit ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : undefined;
                  updateSettings((prev) => ({
                    ...prev,
                    api: { ...prev.api, contextLimit: val },
                  }));
                }}
                className="h-9 rounded-xl text-xs font-mono bg-background/80 border-border/70 shadow-2xs"
                placeholder="留空则自动匹配大模型默认容量限制"
              />
            </div>
          </div>
        </section>

        {/* 4. 请求与输出格式 */}
        <section className="settings-form-group">
          <div className="flex items-center gap-1.5 mb-2.5 select-none">
            <Sliders className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">格式与结构</h3>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
              <span>{t("api.prompt_format")}</span>
              <span className="text-[10px] text-muted-foreground/60">{t("api.prompt_format_tip")}</span>
            </label>
            <Select
              aria-label={t("api.prompt_format")}
              value={settings.promptConfig?.renderingFormat || "auto"}
              onValueChange={(val: "auto" | "xml" | "markdown") =>
                updateSettings((prev) => ({
                  ...prev,
                  promptConfig: { ...prev.promptConfig, renderingFormat: val },
                }))
              }
            >
              <SelectTrigger className="w-full text-xs h-9 rounded-xl bg-background/80 border-border/70 shadow-2xs">
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
        </section>

        {/* 5. 能力开关与底层兼容行为 */}
        <section className="settings-form-group settings-form-group-last">
          <div className="flex items-center gap-1.5 mb-2.5 select-none">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">特性与行为</h3>
          </div>

          <div className="space-y-2">
            <SettingsToggleRow
              label="模型直接听语音"
              description="仅在当前模型支持 OpenAI-compatible input_audio 时启用；它不等同于语音转文字，也不会改变“+”里的音频附件。"
              checked={settings.api.supportsAudioInput === true}
              onCheckedChange={(checked) => updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, supportsAudioInput: checked },
              }))}
            />

            <SettingsToggleRow
              label="图片输入能力"
              description="仅在当前模型明确支持视觉输入时启用；缺省关闭，避免向文本模型误发图片。"
              checked={settings.api.supportsVision === true}
              onCheckedChange={(checked) => updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, supportsVision: checked },
              }))}
            />

            <SettingsToggleRow
              label={t("api.fallback_title")}
              description={t("api.fallback_desc")}
              checked={settings.api.forceBasicParams || false}
              onCheckedChange={(checked) => updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, forceBasicParams: checked },
              }))}
            />

            <SettingsToggleRow
              label={t("api.send_names_title")}
              description={t("api.send_names_desc")}
              checked={settings.api.sendNames || false}
              onCheckedChange={(checked) => updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, sendNames: checked },
              }))}
            />

            <ReasoningStrengthRow
              label={t("api.reasoning_strength_title")}
              description={t("api.reasoning_strength_desc")}
              value={settings.api.reasoningStrength ?? (settings.api.disableReasoning ? "off" : "auto")}
              modelId={settings.api.modelName}
              baseUrl={settings.api.baseUrl}
              onChange={(value) => updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, reasoningStrength: value },
              }))}
            />
          </div>
        </section>
      </AccordionContent>
    </AccordionItem>
  );
}
