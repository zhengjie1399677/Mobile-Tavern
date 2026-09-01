import { KeySquare } from "lucide-react";
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
  return (
    <AccordionItem value="api-config" className="settings-connection-item overflow-hidden">
      <AccordionTrigger className="settings-panel-trigger px-3.5 py-3 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <span className="settings-panel-icon"><KeySquare className="w-5 h-5 text-primary" /></span>
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-3">
              <span className="text-base font-bold">{t("api.title")}</span>
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
            <span className="text-xs text-muted-foreground font-normal">{t("api.subtitle")}</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="settings-panel-content settings-form p-0 border-t border-border/50">
        {/* API 通道配置档案选择与切换 */}
        <section className="settings-form-group">
          <h3 className="settings-form-group-title">通道</h3>
          <div className="settings-profile-section space-y-2.5">
          <label className="text-xs font-semibold text-muted-foreground block">
            {t("api.select_profile")}
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
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
                          forceBasicParams: target.forceBasicParams,
                          supportsVision: target.supportsVision,
                          supportsAudioInput: target.supportsAudioInput,
                        },
                      }));
                    }
                  }
                }}
              >
                <SelectTrigger className="h-10 rounded-xl bg-input/50 text-sm flex-1 truncate">
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
                className="h-10 px-3.5 bg-primary/10 border border-primary/25 text-primary text-xs font-semibold rounded-xl hover:bg-primary/20 transition shrink-0 tap-scale"
              >
                {t("api.save_profile")}
              </button>
            </div>

            {settings.currentApiProfileId && (
              <div className="flex gap-3 justify-end pt-0.5">
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
                  className="text-[10px] text-muted-foreground hover:text-primary transition flex items-center gap-1 font-medium"
                >
                  {t("api.rename")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const activeId = settings.currentApiProfileId;
                    const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                    if (!currentProf) return;
                    const ok = await showCustomConfirm(
                      `Are you sure you want to delete profile【${currentProf.name}】? / 确定要删除通道吗？`
                    );
                    if (ok) {
                      updateSettings((prev) => ({
                        ...prev,
                        savedApiProfiles: (prev.savedApiProfiles || []).filter((p) => p.id !== activeId),
                        currentApiProfileId: "",
                      }));
                    }
                  }}
                  className="text-[10px] text-rose-500 hover:text-rose-700 transition flex items-center gap-1 font-medium"
                >
                  {t("api.delete")}
                </button>
              </div>
            )}
          </div>
          </div>
        </section>

        <section className="settings-form-group">
          <h3 className="settings-form-group-title">连接</h3>
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-xs font-semibold text-muted-foreground flex justify-between items-center">
            <span>{t("api.base_url")}</span>
            <span className="text-[9px] text-primary/70">{t("api.base_url_tip")}</span>
          </label>
          <Input
            list="saved-api-urls"
            value={settings.api.baseUrl || ""}
            onBlur={() => {
              // CR-URLFIX：失焦时 trim 首尾空格，规范化存储，避免多余空格导致请求失败
              const trimmedUrl = settings.api.baseUrl?.trim();
              if (trimmedUrl && trimmedUrl !== settings.api.baseUrl) {
                updateSettings((prev) => ({
                  ...prev,
                  api: { ...prev.api, baseUrl: trimmedUrl }
                }));
              }
              if (trimmedUrl && !settings.api.savedUrls?.includes(trimmedUrl)) {
                updateSettings((prev) => ({
                  ...prev,
                  api: {
                    ...prev.api,
                    savedUrls: [...(prev.api.savedUrls || []), trimmedUrl]
                  }
                }));
              }
            }}
            onChange={(e) => {
              const val = e.target.value;
              updateSettings((prev) => ({
                ...prev,
                currentApiProfileId: "", // 修改时自动脱离通道绑定
                api: { ...prev.api, baseUrl: val },
              }));
            }}
            className="h-10 rounded-xl text-sm font-mono bg-input/50"
            placeholder="https://api.openai.com/v1"
          />
          <datalist id="saved-api-urls">
            {settings.api.savedUrls?.map((url, idx) => (
              <option key={idx} value={url} />
            ))}
          </datalist>
          <div className="flex gap-1 flex-wrap pt-1">
            {[
              { n: "Gemini", u: "https://generativelanguage.googleapis.com/v1beta/openai/" },
              { n: "DeepSeek", u: "https://api.deepseek.com/v1" },
              { n: "OpenAI", u: "https://api.openai.com/v1" },
              { n: "Together", u: "https://api.together.xyz/v1" },
              { n: "Groq", u: "https://api.groq.com/openai/v1" },
            ].map((preset) => (
              <button
                key={preset.n}
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    currentApiProfileId: "", // 快捷填入时自动脱离通道绑定
                    api: { ...prev.api, baseUrl: preset.u },
                  }))
                }
                className="text-[9px] bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border"
              >
                {preset.n}
              </button>
            ))}
            {settings.api.savedUrls && settings.api.savedUrls.length > 0 && (
              <button
                type="button"
                onClick={() => updateSettings((prev) => ({ ...prev, api: { ...prev.api, savedUrls: [] } }))}
                className="text-[9px] bg-destructive/10 hover:bg-destructive/20 text-destructive px-1.5 py-0.5 rounded border border-destructive/20 ml-auto"
              >
                {t("api.clear_history")}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-xs font-semibold text-muted-foreground flex justify-between">
            <span>{t("api.api_key")}</span>
            <button
              aria-label={t("api.test_conn")}
              onClick={testApiConnection}
              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-bold"
            >
              {t("api.test_conn")}
            </button>
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              className="font-mono text-sm h-10 rounded-xl bg-input/50 flex-1"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              value={settings.api.apiKey || ""}
              onChange={(e) => {
                const val = e.target.value;
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, apiKey: val },
                }));
              }}
              placeholder="sk-..."
            />
            <button
              onClick={handleFetchModels}
              disabled={isFetchingModels}
              className="h-10 px-3.5 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
            >
              {isFetchingModels ? t("api.fetching_models") : t("api.fetch_models")}
            </button>
          </div>
          {!settings.api.apiKey || !settings.api.apiKey.trim() ? (
            <p key="free-tier-warning" className="text-[10px] text-primary/80 flex items-center gap-1 font-medium bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
              {t("api.free_tier", { count: String(freeCount) })}
            </p>
          ) : (
            <p key="custom-key-info" className="text-[10px] text-muted-foreground">
              {t("api.exclusive_tier")}
            </p>
          )}
          {connectionStatus?.message && (
            <div className={`mt-2 text-[11px] p-2 rounded-md ${connectionStatus.success ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
              {connectionStatus.message}
            </div>
          )}
        </div>
        </section>

        <section className="settings-form-group">
          <h3 className="settings-form-group-title">模型</h3>
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-xs font-semibold text-muted-foreground flex justify-between">
            <span>{t("api.model_id")}</span>
          </label>
          {availableModels.length > 0 ? (
            <Select
              aria-label={t("api.model_id")}
              value={settings.api.modelName || ""}
              onValueChange={(val) =>
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, modelName: val ?? "" },
                }))
              }
            >
              <SelectTrigger className="w-full text-sm h-10 rounded-xl bg-input/50 font-mono">
                <SelectValue placeholder={t("api.select_model_placeholder")} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
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
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, modelName: val },
                }));
              }}
              className="h-10 rounded-xl text-sm font-mono bg-input/50"
              placeholder="gpt-4o"
            />
          )}
        </div>

        {/* contextLimit Input */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-xs font-semibold text-muted-foreground flex justify-between">
            <span>{t("api.context_limit")}</span>
            <span className="text-[9px] text-muted-foreground/80">{t("api.context_limit_tip")}</span>
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
            className="h-10 rounded-xl text-sm font-mono bg-input/50"
            placeholder="e.g. 100000 (100k)"
          />
        </div>
        </section>

        <section className="settings-form-group">
          <h3 className="settings-form-group-title">请求格式</h3>
        {/* renderingFormat Select */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-xs font-semibold text-muted-foreground flex justify-between">
            <span>{t("api.prompt_format")}</span>
            <span className="text-[9px] text-muted-foreground/80">{t("api.prompt_format_tip")}</span>
          </label>
          <Select
            aria-label={t("api.prompt_format")}
            value={settings.promptConfig?.renderingFormat || "auto"}
            onValueChange={(val: 'auto' | 'xml' | 'markdown') =>
              updateSettings((prev) => ({
                ...prev,
                promptConfig: { ...prev.promptConfig, renderingFormat: val },
              }))
            }
          >
            <SelectTrigger className="w-full text-sm h-10 rounded-xl bg-input/50">
              <SelectValue placeholder={t("api.format_auto")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">{t("api.format_auto")}</SelectItem>
              <SelectItem value="xml" className="text-xs">{t("api.format_xml")}</SelectItem>
              <SelectItem value="markdown" className="text-xs">{t("api.format_markdown")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </section>

        <section className="settings-form-group settings-form-group-last">
          <h3 className="settings-form-group-title">能力与行为</h3>
        <SettingsToggleRow
          label="模型直接听语音"
          description="仅在当前模型支持 OpenAI-compatible input_audio 时启用；它不等同于语音转文字，也不会改变“+”里的音频附件。"
          checked={settings.api.supportsAudioInput === true}
          onCheckedChange={(checked) => updateSettings((prev) => ({
            ...prev,
            api: { ...prev.api, supportsAudioInput: checked },
          }))}
        />

        {/* forceBasicParams Switch */}
        <SettingsToggleRow
          label="图片输入能力"
          description="仅在当前模型明确支持视觉输入时启用；缺省关闭，避免向文本模型误发图片。"
          checked={settings.api.supportsVision === true}
          onCheckedChange={(checked) => updateSettings((prev) => ({
            ...prev,
            api: { ...prev.api, supportsVision: checked },
          }))}
        />

        {/* forceBasicParams Switch */}
        <SettingsToggleRow
          label={t("api.fallback_title")}
          description={t("api.fallback_desc")}
          checked={settings.api.forceBasicParams || false}
          onCheckedChange={(checked) => updateSettings((prev) => ({
            ...prev,
            api: { ...prev.api, forceBasicParams: checked },
          }))}
        />

        {/* sendNames Switch */}
        <SettingsToggleRow
          label={t("api.send_names_title")}
          description={t("api.send_names_desc")}
          checked={settings.api.sendNames || false}
          onCheckedChange={(checked) => updateSettings((prev) => ({
            ...prev,
            api: { ...prev.api, sendNames: checked },
          }))}
        />

        {/* disableReasoning Switch */}
        <SettingsToggleRow
          label={t("api.disable_reasoning_title")}
          description={t("api.disable_reasoning_desc")}
          checked={settings.api.disableReasoning || false}
          onCheckedChange={(checked) => updateSettings((prev) => ({
            ...prev,
            api: { ...prev.api, disableReasoning: checked },
          }))}
        />
        </section>
      </AccordionContent>
    </AccordionItem>
  );
}
