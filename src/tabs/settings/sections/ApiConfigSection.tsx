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
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

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
    <AccordionItem value="api-config" className="glass-panel shadow-sm rounded-xl overflow-hidden">
      <AccordionTrigger className="px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <KeySquare className="w-4 h-4 text-primary" />
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">{t("api.title")}</span>
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
            <span className="text-[10px] text-muted-foreground font-normal">{t("api.subtitle")}</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* API 通道配置档案选择与切换 */}
        <div className="space-y-1.5 pb-2.5 mb-1 border-b border-border/30">
          <label className="text-[11px] font-semibold text-muted-foreground block">
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
                        currentApiProfileId: val,
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
                        },
                      }));
                    }
                  }
                }}
              >
                <SelectTrigger className="h-9 bg-input/50 text-xs flex-1 truncate">
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
                    };
                    updateSettings((prev) => ({
                      ...prev,
                      savedApiProfiles: [...(prev.savedApiProfiles || []), newProfile],
                      currentApiProfileId: newId,
                    }));
                  }
                }}
                className="h-9 px-3 bg-primary/10 border border-primary/25 text-primary text-xs font-medium rounded-md hover:bg-primary/20 transition shrink-0 tap-scale"
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

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
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
            className="h-9 text-xs font-mono bg-input/50"
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
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
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
              className="font-mono text-xs h-9 bg-input/50 flex-1"
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
              className="h-9 px-3 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
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

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
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
                  api: { ...prev.api, modelName: val },
                }))
              }
            >
              <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-mono">
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
              className="h-9 text-xs font-mono bg-input/50"
              placeholder="gpt-4o"
            />
          )}
        </div>

        {/* contextLimit Input */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
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
            className="h-9 text-xs font-mono bg-input/50"
            placeholder="e.g. 100000 (100k)"
          />
        </div>

        {/* renderingFormat Select */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
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
            <SelectTrigger className="w-full text-xs h-9 bg-input/50">
              <SelectValue placeholder={t("api.format_auto")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">{t("api.format_auto")}</SelectItem>
              <SelectItem value="xml" className="text-xs">{t("api.format_xml")}</SelectItem>
              <SelectItem value="markdown" className="text-xs">{t("api.format_markdown")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* forceBasicParams Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("api.fallback_title")}
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              {t("api.fallback_desc")}
            </p>
          </div>
          <Switch
            aria-label={t("api.fallback_title")}
            checked={settings.api.forceBasicParams || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, forceBasicParams: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {/* sendNames Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("api.send_names_title")}
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              {t("api.send_names_desc")}
            </p>
          </div>
          <Switch
            aria-label={t("api.send_names_title")}
            checked={settings.api.sendNames || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, sendNames: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {/* disableReasoning Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("api.disable_reasoning_title")}
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              {t("api.disable_reasoning_desc")}
            </p>
          </div>
          <Switch
            aria-label={t("api.disable_reasoning_title")}
            checked={settings.api.disableReasoning || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, disableReasoning: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

      </AccordionContent>
    </AccordionItem>
  );
}
