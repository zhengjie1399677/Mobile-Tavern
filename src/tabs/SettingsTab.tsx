import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import {
  Settings,
  Plus,
  Trash2,
  Brain,
  Download,
  Upload,
  KeySquare,
  HelpCircle,
  AlertCircle,
  UserCheck,
  Lock,
  Database,
  Sparkles,
  Plug,
  Puzzle,
} from "lucide-react";

import { DEFAULT_PRESETS } from "../App";
import { DEFAULT_SETTINGS } from "../hooks/useSettings";

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../components/ui/accordion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { UsageDisplay } from "../utils/useUsageTracking";
import PresetForm from "../components/PresetForm";

export default function SettingsTab() {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const getDeviceModel = () => {
    if (typeof navigator === "undefined") return "Unknown Device";
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) {
      const parts = ua.match(/\(([^)]+)\)/);
      if (parts && parts[1]) {
        const subParts = parts[1].split(';');
        const androidPart = subParts.find(p => p.includes('Android'));
        if (androidPart) {
          const modelPart = subParts[subParts.length - 1] || "";
          return `${modelPart.trim().replace(/Build\/.*/g, "")} (${androidPart.trim()})`;
        }
      }
      return "Android Device";
    }
    if (/iphone|ipad|ipod/i.test(ua)) {
      return "iOS Device";
    }
    return "PC Web/Browser";
  };
  const deviceModel = getDeviceModel();

  const {
    settings,
    currentTheme,
    handleThemeChange,
    availableModels,
    isFetchingModels,
    handleFetchModels,
    backupPass,
    setBackupPass,
    backupStatus,
    encryptBackup,
    setEncryptBackup,
    showBackupUI,
    setShowBackupUI,
    sillyInnerTab,
    setSillyInnerTab,
    updateSettings,
    switchUserPersona,
    addUserPersona,
    deleteUserPersona,
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
    handleExportLocalDataBackup,
    handleImportLocalDataBackup,
    connectionStatus,
    testApiConnection,
    setActiveTab,
    showCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
    activeCharacter,
  } = useContext(AppContext);
  const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);

  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const lastApiRef = React.useRef(JSON.stringify(settings.api));

  React.useEffect(() => {
    const apiStr = JSON.stringify(settings.api);
    if (apiStr !== lastApiRef.current) {
      lastApiRef.current = apiStr;
      setSaveState("saving");
      const timer1 = setTimeout(() => {
        setSaveState("saved");
      }, 550);
      return () => clearTimeout(timer1);
    }
  }, [settings.api]);

  React.useEffect(() => {
    if (saveState === "saved") {
      const timer2 = setTimeout(() => {
        setSaveState("idle");
      }, 2000);
      return () => clearTimeout(timer2);
    }
  }, [saveState]);

  return (
    <div className="px-4 pb-4 pt-1.5 flex flex-col h-full overflow-hidden">
      <div className="border-b border-border pb-3 mb-3 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-foreground tracking-tight">
            <Settings className="w-5 h-5 text-primary" /> 控制面板
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            系统参数与颗粒化规则调节
          </p>
        </div>
      </div>

      <Tabs
        defaultValue="general"
        className="flex-1 flex flex-col min-h-0 bg-transparent"
      >
        <TabsList className="grid grid-cols-4 w-full h-11 p-1 bg-muted/50 rounded-xl">
          <TabsTrigger
            value="general"
            className="text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap h-full rounded-lg"
          >
            <Sparkles className="w-3.5 h-3.5" /> 常规
          </TabsTrigger>
          <TabsTrigger
            value="persona"
            className="text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap h-full rounded-lg"
          >
            <UserCheck className="w-3.5 h-3.5" /> 角色
          </TabsTrigger>
          <TabsTrigger
            value="presets"
            className="text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap h-full rounded-lg"
          >
            <Puzzle className="w-3.5 h-3.5" /> 预设
          </TabsTrigger>
          <TabsTrigger
            value="memory"
            className="text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap h-full rounded-lg"
          >
            <Database className="w-3.5 h-3.5" /> 存储
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto mt-4 custom-scrollbar pb-10">
          {/* 1. GENERAL CONFIG (Theme + API + Persona) */}
          <TabsContent
            value="general"
            className="space-y-4 m-0 data-[state=inactive]:hidden outline-none"
          >


            {/* 2. API CONFIG (Collapsed by default) */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="api-config" className="glass-panel shadow-sm rounded-xl overflow-hidden">
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition">
                  <div className="flex items-center gap-2">
                    <KeySquare className="w-4 h-4 text-primary" />
                    <div className="flex flex-col items-start gap-1">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">API 服务端点配置</span>
                        {saveState === "saving" && (
                          <span className="text-[10px] text-sky-500 flex items-center gap-1 font-semibold animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                            正在自动保存...
                          </span>
                        )}
                        {saveState === "saved" && (
                          <span className="text-[10px] text-emerald-500 flex items-center gap-1 font-semibold animate-in fade-in duration-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            修改已自动保存
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-normal">配置大语言模型接口地址与授权凭证</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 pt-2 border-t border-border/50 space-y-4">
                  {/* API 通道配置档案选择与切换 */}
                  <div className="space-y-2 pb-3.5 mb-1.5 border-b border-border/40">
                    <label className="text-[11px] font-semibold text-muted-foreground block">
                      选择 API 配置通道 / 凭证档案
                    </label>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <Select
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
                                  },
                                }));
                              }
                            }
                          }}
                        >
                          <SelectTrigger className="h-9 bg-input/50 text-xs flex-1 truncate">
                            <SelectValue placeholder="选择通道...">
                              {(() => {
                                if (!settings.currentApiProfileId) return "💡 临时调试配置";
                                const currentProf = (settings.savedApiProfiles || []).find(
                                  (p) => p.id === settings.currentApiProfileId
                                );
                                return currentProf ? `🔌 ${currentProf.name}` : "💡 临时调试配置";
                              })()}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="temp" className="text-xs">
                              💡 临时调试配置
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
                              "请输入新 API 通道的别名（例如：DeepSeek官方、硅基流动）:",
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
                          另存当前配置为通道
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
                                "重命名通道别名:",
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
                            ✏️ 重命名
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const activeId = settings.currentApiProfileId;
                              const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                              if (!currentProf) return;
                              const ok = await showCustomConfirm(
                                `确定要删除通道【${currentProf.name}】吗？这不会影响当前已输入的连接配置。`
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
                            🗑️ 删除此通道
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
                      <span>接口代理地址 (Base URL)</span>
                      <span className="text-[9px] text-primary/70">提示：支持多组常用 API 历史地址自动记录</span>
                    </label>
                    <Input
                      list="saved-api-urls"
                      value={settings.api.baseUrl || ""}
                      onBlur={() => {
                        if (settings.api.baseUrl && !settings.api.savedUrls?.includes(settings.api.baseUrl)) {
                          const currentUrl = settings.api.baseUrl;
                          updateSettings((prev) => ({
                            ...prev,
                            api: {
                              ...prev.api,
                              savedUrls: [...(prev.api.savedUrls || []), currentUrl]
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
                          onClick={() => updateSettings((prev) => ({ ...prev, api: { ...prev.api, savedUrls: [] }}))}
                          className="text-[9px] bg-destructive/10 hover:bg-destructive/20 text-destructive px-1.5 py-0.5 rounded border border-destructive/20 ml-auto"
                        >
                          清空记录
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
                      <span>API 密钥 (API Key)</span>
                      <button
                        onClick={testApiConnection}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                      >
                        ⚡ 连通性测试
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
                        {isFetchingModels ? "获取中..." : "拉取模型列表"}
                      </button>
                    </div>
                    {!settings.api.apiKey || !settings.api.apiKey.trim() ? (
                      <p key="free-tier-warning" className="text-[10px] text-primary/80 flex items-center gap-1 font-medium bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                        💡 处于公共免 Key 体验渠道（已使用 {freeCount}/10 次）。清空 API Key 时自动启用此渠道。
                      </p>
                    ) : (
                      <p key="custom-key-info" className="text-[10px] text-muted-foreground">
                        已配置自定义 API 密钥，优先使用您的专属渠道。
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
                      <span>所选模型标识 (Model ID)</span>
                    </label>
                    {availableModels.length > 0 ? (
                      <Select
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
                          <SelectValue placeholder="选择已获取的模型" />
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

                  {/* bypassProxy Switch */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-0.5">
                      <label className="text-[13px] font-semibold text-foreground">
                        浏览器直连 API (Bypass CORS Proxy)
                      </label>
                      <p className="text-[10px] text-muted-foreground max-w-[450px]">
                        开启后，在电脑浏览器端运行时将绕过本地 Node 代理，直接由浏览器向目标 API 发起请求。若您在电脑上开启了代理工具（如 Clash/v2ray），或者 API 端点支持跨域请求，推荐开启此选项以解决超时或网络不通的问题。
                      </p>
                    </div>
                    <Switch
                      checked={settings.api.bypassProxy || false}
                      onCheckedChange={(checked) =>
                        updateSettings((prev) => ({
                          ...prev,
                          api: { ...prev.api, bypassProxy: checked },
                        }))
                      }
                      className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                    />
                  </div>

                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* 2. THEME CONFIG */}
            <Card className="glass-panel shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>阅读主题与色彩基调</span>
                </CardTitle>
                <CardDescription className="text-[11px]">
                  切换界面的高对比度和情绪感官
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <Select
                  value={currentTheme}
                  onValueChange={(val: any) => handleThemeChange(val)}
                >
                  <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-medium">
                    <SelectValue placeholder="选择主题">
                      {currentTheme === "snow"
                        ? "极简纯白"
                        : currentTheme === "sand"
                        ? "浅沙暮色"
                        : currentTheme === "ocean"
                        ? "荧光深海"
                        : currentTheme === "obsidian"
                        ? "黑曜石暗黑"
                        : "选择主题"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="snow" label="极简纯白" className="text-xs">
                      极简纯白
                    </SelectItem>
                    <SelectItem value="sand" label="浅沙暮色" className="text-xs">
                      浅沙暮色
                    </SelectItem>
                    <SelectItem value="ocean" label="荧光深海" className="text-xs">
                      荧光深海
                    </SelectItem>
                    <SelectItem value="obsidian" label="黑曜石暗黑" className="text-xs">
                      黑曜石暗黑
                    </SelectItem>
                  </SelectContent>
                </Select>

                <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    全局默认聊天背景图片 (当角色未设置专属背景时生效)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={settings.globalChatBg || ""}
                      onChange={(e) =>
                        updateSettings({ ...settings, globalChatBg: e.target.value })
                      }
                      className="h-9 text-xs bg-input/50 flex-1 truncate"
                      placeholder="未设置（使用默认主题底色）"
                    />
                    <label className="bg-muted text-muted-foreground text-xs px-3 rounded flex items-center justify-center cursor-pointer border border-border select-none shrink-0">
                      上传
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              updateSettings({ ...settings, globalChatBg: reader.result as string });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    {settings.globalChatBg && (
                      <button
                        type="button"
                        onClick={() => updateSettings({ ...settings, globalChatBg: "" })}
                        className="bg-rose-950/20 text-red-400 px-3 rounded border border-rose-900/35 hover:bg-rose-950/45 text-xs transition shrink-0"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>

                {/* 背景参数自定义选项与动效控制 */}
                <div className="mt-4 pt-4 border-t border-border/50 space-y-4.5">
                  {/* 模糊度调节（三档选项） */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-muted-foreground block">
                      背景图片模糊程度
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "清晰 (0px)", value: 0 },
                        { label: "适中 (10px)", value: 10 },
                        { label: "模糊 (25px)", value: 25 },
                      ].map((opt) => {
                        const active = (settings.chatBackgroundBlur ?? 10) === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              updateSettings((prev) => ({
                                ...prev,
                                chatBackgroundBlur: opt.value,
                              }))
                            }
                            className={`py-2 px-1 rounded text-xs border text-center transition-all ${
                              active
                                ? "bg-primary/20 border-primary text-primary font-semibold"
                                : "bg-muted/40 border-border/45 text-muted-foreground hover:bg-muted/65"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 变暗融合度调节（四档选项） */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-muted-foreground block">
                      背景融合变暗程度
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { label: "原色 (0%)", value: 0 },
                        { label: "微暗 (20%)", value: 20 },
                        { label: "适中 (50%)", value: 50 },
                        { label: "幽暗 (85%)", value: 85 },
                      ].map((opt) => {
                        const active = (settings.chatBackgroundDim ?? 50) === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              updateSettings((prev) => ({
                                ...prev,
                                chatBackgroundDim: opt.value,
                              }))
                            }
                            className={`py-2 px-0.5 rounded text-[10px] border text-center transition-all ${
                              active
                                ? "bg-primary/20 border-primary text-primary font-semibold"
                                : "bg-muted/40 border-border/45 text-muted-foreground hover:bg-muted/65"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 慢速位移动画开关 */}
                  <div className="flex items-center justify-between pt-1">
                    <label className="text-[11px] font-semibold text-muted-foreground">
                      启用背景慢速呼吸动效 (肯斯伯恩效果)
                    </label>
                    <input
                      type="checkbox"
                      checked={settings.enableChatBgAnimation ?? true}
                      onChange={(e) =>
                        updateSettings((prev) => ({
                          ...prev,
                          enableChatBgAnimation: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-border bg-input text-primary accent-primary cursor-pointer focus:ring-0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3. DEVELOPER PLAYGROUND */}
            <Card className="glass-panel shadow-sm border border-dashed border-primary/40">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2 text-primary font-bold">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  <span>系统运行沙盒</span>
                </CardTitle>
                <CardDescription className="text-[11px]">
                  实时观测 Prompt 编译原理、SSE 流式解析缓冲区以及世界书扫描流程
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("playground")}
                  className="w-full py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  🚀 进入系统运行沙盒 (Sandbox)
                </button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PERSONA CONFIG */}
          <TabsContent
            value="persona"
            className="space-y-4 m-0 data-[state=inactive]:hidden outline-none"
          >
            <Card className="glass-panel shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-primary" /> 角色信息
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* 活跃人设管理栏 */}
                <div className="space-y-1.5 pb-3 border-b border-border/40 mb-3 animate-in fade-in duration-300">
                  <label className="text-[11px] font-bold text-muted-foreground flex justify-between">
                    <span>当前活跃玩家设定 (User Persona)</span>
                  </label>
                  <div className="flex gap-2">
                    <div
                      key={`${settings.activePersonaId || "default-persona"}-${settings.userName || ""}`}
                      className="flex-1 min-w-0"
                    >
                      <Select
                        value={settings.activePersonaId || "default-persona"}
                        onValueChange={(val) => switchUserPersona(val)}
                      >
                        <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-semibold">
                          <SelectValue placeholder="选择玩家设定">
                            👤 {settings.userPersonas?.find(p => p.id === (settings.activePersonaId || "default-persona"))?.name || "选择玩家设定"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(settings.userPersonas || []).map((pers) => (
                            <SelectItem
                              key={pers.id}
                              value={pers.id}
                              className="text-xs font-semibold"
                            >
                              👤 {pers.name || "未命名人物"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <button
                      type="button"
                      onClick={addUserPersona}
                      className="h-9 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
                      title="新建人设"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteUserPersona(settings.activePersonaId || "")}
                      disabled={(settings.userPersonas || []).length <= 1}
                      className="h-9 px-3 bg-rose-950/15 border border-rose-900/35 hover:bg-rose-950/35 text-red-400 disabled:opacity-40 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
                      title="删除当前人设"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    玩家名称 (用于系统推断及占位符代称)
                  </label>
                  <Input
                    value={settings.userName}
                    onChange={(e) =>
                      updateSettings({ ...settings, userName: e.target.value })
                    }
                    className="h-9 text-xs bg-input/50"
                    placeholder="未知探客"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    玩家自定义头像 (支持 base64)
                  </label>
                  <div className="flex gap-2">
                    <div className="w-9 h-9 rounded-full bg-muted border border-border flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {settings.userAvatar ? (
                        <img src={settings.userAvatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <UserCheck className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <Input
                      value={settings.userAvatar || ""}
                      onChange={(e) =>
                        updateSettings({ ...settings, userAvatar: e.target.value })
                      }
                      className="h-9 text-xs bg-input/50 flex-1 truncate"
                      placeholder="data:image/png;base64,... 或空"
                    />
                    <label className="bg-muted text-muted-foreground text-xs px-3 rounded flex items-center justify-center cursor-pointer border border-border select-none shrink-0">
                      上传
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              updateSettings({ ...settings, userAvatar: reader.result as string });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    {settings.userAvatar && (
                      <button
                        type="button"
                        onClick={() => updateSettings({ ...settings, userAvatar: "" })}
                        className="bg-rose-950/20 text-red-400 px-3 rounded border border-rose-900/35 hover:bg-rose-950/45 text-xs transition shrink-0"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    玩家信息 (Persona: 世界观背景/外貌描述等)
                  </label>
                  <Textarea
                    value={settings.userInfo || ""}
                    onChange={(e) =>
                      updateSettings({ ...settings, userInfo: e.target.value })
                    }
                    className="text-sm bg-input/50 min-h-[160px]"
                    placeholder="例如: 身高180cm, 穿着黑色的风衣, 眼神冷漠..."
                  />
                </div>
                <div className="flex items-center justify-between border-t border-border/50 pt-4">
                  <div className="space-y-0.5">
                    <label className="text-[13px] font-semibold text-foreground">
                      开启富文本 HTML 渲染
                    </label>
                    <p className="text-[10px] text-muted-foreground">
                      允许角色卡通过 HTML/CSS
                      标签控制输出文本的独立样式，可能会影响部分对话气泡的排版。
                    </p>
                  </div>
                  <Switch
                    checked={settings.enableHtmlRendering || false}
                    onCheckedChange={(val) =>
                      updateSettings({ ...settings, enableHtmlRendering: val })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-border/50 pt-4">
                  <div className="space-y-0.5">
                    <label className="text-[13px] font-semibold text-foreground">
                      开启卡片 JavaScript 脚本执行（TavernHelper 兼容模式）
                    </label>
                    <p className="text-[10px] text-muted-foreground">
                      允许角色卡通过 Iframe 与内置的 TavernHelper 接口交互执行自定义 JS 脚本，用于动态状态卡展示。运行未知来源脚本具有一定安全风险。
                    </p>
                  </div>
                  <Switch
                    checked={settings.enableScriptExecution || false}
                    onCheckedChange={(val) =>
                      updateSettings({ ...settings, enableScriptExecution: val })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel shadow-sm mt-4">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>全局表情情绪匹配正则词典</span>
                  <button
                    type="button"
                    onClick={() => {
                      updateSettings({
                        ...settings,
                        expressionTriggers: {
                          joy: "笑了|微笑|开心|😊|smile|joy|happy",
                          happy: "笑了|微笑|开心|😊|smile|joy|happy",
                          smile: "笑了|微笑|开心|😊|smile|joy|happy",
                          sadness: "哭|流泪|伤心|😢|cry|sad",
                          sad: "哭|流泪|伤心|😢|cry|sad",
                          cry: "哭|流泪|伤心|😢|cry|sad",
                          anger: "生气|愤怒|😡|angry|rage",
                          angry: "生气|愤怒|😡|angry|rage",
                          rage: "生气|愤怒|😡|angry|rage",
                          blush: "脸红|害羞|😳|blush|shy",
                          shy: "脸红|害羞|😳|blush|shy",
                        }
                      });
                    }}
                    className="text-[10px] text-primary font-bold hover:underline"
                  >
                    重置词典
                  </button>
                </CardTitle>
                <CardDescription className="text-[11px]">
                  当导入的角色卡未配置具体的 triggers 规则时，系统将使用本正则表达式规则进行情绪表情切换匹配检测（可编辑或清空以关闭检测）
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                {[
                  { k: "joy", n: "狂喜 (Joy)" },
                  { k: "happy", n: "开心 (Happy)" },
                  { k: "smile", n: "微笑 (Smile)" },
                  { k: "sadness", n: "悲伤 (Sadness)" },
                  { k: "sad", n: "伤心 (Sad)" },
                  { k: "cry", n: "流泪 (Cry)" },
                  { k: "anger", n: "发怒 (Anger)" },
                  { k: "angry", n: "生气 (Angry)" },
                  { k: "rage", n: "暴怒 (Rage)" },
                  { k: "blush", n: "羞涩 (Blush)" },
                  { k: "shy", n: "害羞 (Shy)" },
                ].map((item) => (
                  <div key={item.k} className="flex items-center gap-3">
                    <span className="font-semibold text-muted-foreground w-24 shrink-0">{item.n}</span>
                    <Input
                      value={settings.expressionTriggers?.[item.k] ?? ""}
                      onChange={(e) => {
                        const nextTriggers = {
                          ...(settings.expressionTriggers || {}),
                          [item.k]: e.target.value,
                        };
                        updateSettings({
                          ...settings,
                          expressionTriggers: nextTriggers,
                        });
                      }}
                      className="h-8 text-xs font-mono bg-input/50 flex-1"
                      placeholder="表达式正则匹配串..."
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3. PRESETS */}
          <TabsContent
            value="presets"
            className="space-y-4 m-0 data-[state=inactive]:hidden outline-none"
          >
            <PresetForm />
          </TabsContent>

          {/* 4. MEMORY AND STORAGE CONFIG */}
          <TabsContent
            value="memory"
            className="space-y-4 m-0 data-[state=inactive]:hidden outline-none"
          >
            <Card className="bg-card border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" /> 上下文缓冲系统
                </CardTitle>
                <CardDescription className="text-[11px]">
                  设置短期直接传递与中远期大纲提取阈值
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-5 text-xs text-muted-foreground">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground text-[13px]">
                        上下文发送轮次 (Recent Turns)
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        直接发送全文保留的对话局数
                      </span>
                    </div>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      step="1"
                      value={settings.memory.recentTurns}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          memory: {
                            ...settings.memory,
                            recentTurns: parseInt(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-3 mt-4 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                          自动记忆整理 (Auto Summary){" "}
                          <Switch
                            checked={settings.memory.summaryTriggerTurns !== 0}
                            onCheckedChange={(val) =>
                              updateSettings({
                                ...settings,
                                memory: {
                                  ...settings.memory,
                                  summaryTriggerTurns: val ? 10 : 0,
                                },
                              })
                            }
                            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                          />
                        </span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          定期梳理记忆，否则默认与上方发送轮数同步整理
                        </span>
                      </div>
                    </div>
                    {settings.memory.summaryTriggerTurns !== 0 && (
                      <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                        <span className="text-[11px] text-muted-foreground font-semibold">
                          触发轮次 (满多少轮执行一次梳理)
                        </span>
                        <input
                          type="number"
                          min="2"
                          max="100"
                          step="1"
                          value={settings.memory.summaryTriggerTurns}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              memory: {
                                ...settings.memory,
                                summaryTriggerTurns:
                                  parseInt(e.target.value) || 2,
                              },
                            })
                          }
                          className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                        />
                      </div>
                    )}
                  </div>

                  {/* 3. 表格记忆（记忆档案柜）配置 */}
                  <div className="space-y-3 mt-4 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                          结构化记忆表格 (Table Memory){" "}
                          <Switch
                            checked={!!settings.enableTableMemory}
                            onCheckedChange={(val) =>
                              updateSettings({
                                ...settings,
                                enableTableMemory: val,
                              })
                            }
                            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                          />
                        </span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          将好感、人物关系等属性以表格形式整理并静默喂给 AI 记忆
                        </span>
                      </div>
                    </div>
                    {settings.enableTableMemory && (
                      <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                        <span className="text-[11px] text-muted-foreground font-semibold">
                          AI 表格检查更新频率 (每几轮对话让 AI 检查并修改数据)
                        </span>
                        <select
                          value={settings.tableMemoryCheckFrequency || 1}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              tableMemoryCheckFrequency: parseInt(e.target.value) || 1,
                            })
                          }
                          className="bg-muted border border-border rounded px-1.5 py-1 text-xs outline-none focus:border-primary font-bold text-foreground"
                        >
                          <option value="1">每 1 轮 (最实时)</option>
                          <option value="3">每 3 轮 (推荐)</option>
                          <option value="5">每 5 轮 (省 token)</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <Accordion type="single" collapsible className="w-full mt-4 border-t border-border/50 pt-4">
                    <AccordionItem value="advanced-templates" className="border-none">
                      <AccordionTrigger className="py-2 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                        <span className="text-[11px] font-semibold text-foreground">
                          高级整理模板与指令 (Advanced Templates & Prompts)
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-3 pb-0 space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-foreground">
                            时间轴幕数命名模板 (Time Tag Template)
                          </label>
                          <Input
                            value={settings.memory.timeTagTemplate || ""}
                            onChange={(e) =>
                              updateSettings({
                                ...settings,
                                memory: {
                                  ...settings.memory,
                                  timeTagTemplate: e.target.value,
                                },
                              })
                            }
                            className="h-9 text-xs bg-input/50"
                            placeholder="第{{index}}幕"
                          />
                          <p className="text-[9px] text-muted-foreground">
                            使用 <code className="text-primary bg-primary/10 px-1 rounded">{"{{index}}"}</code> 作为当前剧情序号的替换标记
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-foreground">
                            自动记忆归纳指导指令 (Summary System Prompt)
                          </label>
                          <Textarea
                            value={settings.memory.summarySystemPrompt || ""}
                            onChange={(e) =>
                              updateSettings({
                                ...settings,
                                memory: {
                                  ...settings.memory,
                                  summarySystemPrompt: e.target.value,
                                },
                              })
                            }
                            className="text-xs bg-input/50 min-h-[140px] leading-relaxed font-sans"
                            placeholder="输入总结大纲指示词..."
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                                onClick={() => {
                                  updateSettings({
                                    ...settings,
                                    memory: {
                                      ...settings.memory,
                                      summarySystemPrompt: DEFAULT_SETTINGS.memory.summarySystemPrompt,
                                    }
                                  });
                                }}
                              className="text-[10px] text-primary font-bold hover:underline"
                            >
                              重置总结指令为系统默认
                            </button>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border shadow-sm">
              <CardHeader
                className="py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setShowBackupUI(!showBackupUI)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2 text-foreground">
                    <Lock className="w-4 h-4 text-emerald-500" />{" "}
                    离线数据全库备份/还原
                  </CardTitle>
                  <span className="text-muted-foreground text-xs">
                    {showBackupUI ? "收起" : "展开"}
                  </span>
                </div>
              </CardHeader>
              {showBackupUI && (
                <CardContent className="pt-4 space-y-4 bg-muted/10 border-t border-border/50 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center justify-between border-b border-border/50 pb-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold flex items-center gap-2 text-destructive">
                        加密导出保护 (XOR强加密)
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-1">
                        推荐开启以防配置文件侧链泄露
                      </span>
                    </div>
                    <Switch
                      checked={encryptBackup}
                      onCheckedChange={setEncryptBackup}
                      className="data-[state=checked]:bg-destructive"
                    />
                  </div>

                  {encryptBackup && (
                    <div className="space-y-1.5 animate-in fade-in duration-300">
                      <label className="text-[11px] font-semibold text-foreground">
                        离线全文件核心密钥
                      </label>
                      <Input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        autoCorrect="off"
                        value={backupPass}
                        onChange={(e) => setBackupPass(e.target.value)}
                        placeholder="务必牢记，否则无法恢复..."
                        className="h-9 placeholder:text-muted-foreground/50 bg-background border-destructive/30 focus-visible:ring-destructive/40 text-xs font-mono"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
                    <button
                      onClick={handleExportLocalDataBackup}
                      className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 text-primary" />{" "}
                      包裹归档提取
                    </button>
                    <label className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5 text-emerald-500" />{" "}
                      还原覆盖数据
                      <input
                        type="file"
                        onChange={handleImportLocalDataBackup}
                        accept=".backup,.json"
                        className="hidden"
                      />
                    </label>
                  </div>

                  {backupStatus && (
                    <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
                      {backupStatus}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            <UsageDisplay />

            <div className="mt-8 text-center space-y-1 pb-4 opacity-50 select-text">
              <p className="text-[10px] text-muted-foreground font-mono">
                安装包版本: v1.5.0 • 运行平台: {isTauri ? "Tauri Android 客户端" : "Web 网页端"}
              </p>
              <p className="text-[9px] text-muted-foreground/80 font-mono">
                诊断设备型号: {deviceModel}
              </p>
            </div>
          </TabsContent>
        </div>
      </Tabs>

    </div>
  );
}
