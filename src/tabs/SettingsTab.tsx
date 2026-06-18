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

  // 全局正则脚本管理器状态
  const [editingRegex, setEditingRegex] = React.useState<any>(null);
  const [isRegexModalOpen, setIsRegexModalOpen] = React.useState(false);

  const toggleRegexDisabled = (id: string, disabled: boolean, scope: "global" | "preset") => {
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      const list = (prev as any)[field] || [];
      return {
        ...prev,
        [field]: list.map((r: any) => (r.id === id ? { ...r, disabled } : r)),
      };
    });
  };

  const deleteRegex = async (id: string, name: string, scope: "global" | "preset") => {
    const scopeName = scope === "global" ? "全局" : "预设专属";
    const ok = await showCustomConfirm(`确定要删除${scopeName}正则脚本【${name}】吗？`);
    if (!ok) return;
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      const list = (prev as any)[field] || [];
      return {
        ...prev,
        [field]: list.filter((r: any) => r.id !== id),
      };
    });
  };

  const saveRegex = (reg: any) => {
    if (!reg.scriptName || !reg.scriptName.trim() || !reg.findRegex || !reg.findRegex.trim()) {
      showCustomAlert("脚本名称和正则表达式匹配串不能为空！");
      return;
    }
    const scope = reg.scope || "global";
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      const list = (prev as any)[field] || [];
      const exists = list.some((r: any) => r.id === reg.id);
      let nextList;
      if (exists) {
        nextList = list.map((r) => (r.id === reg.id ? reg : r));
      } else {
        nextList = [...list, reg];
      }
      return {
        ...prev,
        [field]: nextList,
      };
    });
    setIsRegexModalOpen(false);
    setEditingRegex(null);
  };

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
            {/* Sub-Tabs for Presets */}
            <div className="glass-panel rounded-xl overflow-hidden shadow-sm flex flex-col">
              <div className="flex border-b border-border bg-muted/30 shrink-0">
                <button
                  type="button"
                  onClick={() => setSillyInnerTab("samplers")}
                  className={`flex-1 py-2.5 text-xs font-bold transition border-b-2 ${
                    sillyInnerTab === "samplers"
                      ? "border-primary text-primary bg-background"
                      : "border-transparent text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  🎛️ 模型调节器
                </button>
                <button
                  type="button"
                  onClick={() => setSillyInnerTab("prompts")}
                  className={`flex-1 py-2.5 text-xs font-bold transition border-b-2 ${
                    sillyInnerTab === "prompts"
                      ? "border-primary text-primary bg-background"
                      : "border-transparent text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  🧩 颗粒预设配置
                </button>
              </div>

              <div className="p-4 bg-background/50 flex-1">
                {sillyInnerTab === "samplers" && (
                  <div className="space-y-5 animate-in fade-in duration-300">
                    {/* Inner Params */}
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-muted-foreground block mb-2">
                        内置模板基座切换
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.values(DEFAULT_PRESETS).map((p) => {
                          const isSelect = settings.preset.id === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() =>
                                updateSettings({ ...settings, preset: p })
                              }
                              className={`py-1.5 px-1 border rounded-lg text-center font-bold text-[10px] transition ${
                                isSelect
                                  ? "bg-primary/20 border-primary text-primary"
                                  : "bg-muted/40 border-border hover:border-primary/50 text-muted-foreground"
                              }`}
                            >
                              {p.name.split(" ")[0]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border/50 text-xs">
                      <div className="space-y-2">
                        <div className="flex justify-between text-muted-foreground">
                          <span className="font-semibold">温度 (Temp)</span>
                          <span className="font-mono">
                            {settings.preset.temperature}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.5"
                          step="0.05"
                          value={settings.preset.temperature}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              preset: {
                                ...settings.preset,
                                id: "custom",
                                temperature: parseFloat(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-muted-foreground">
                          <span className="font-semibold">核采样 (Top P)</span>
                          <span className="font-mono">
                            {settings.preset.topP}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={settings.preset.topP}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              preset: {
                                ...settings.preset,
                                id: "custom",
                                topP: parseFloat(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-muted-foreground">
                          <span className="font-semibold">
                            重复惩罚 (Rep Penalty)
                          </span>
                          <span className="font-mono">
                            {settings.preset.repetitionPenalty}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1.0"
                          max="1.3"
                          step="0.01"
                          value={settings.preset.repetitionPenalty}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              preset: {
                                ...settings.preset,
                                id: "custom",
                                repetitionPenalty: parseFloat(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-muted-foreground">
                          <span className="font-semibold">
                            长度上限 (Max Tokens)
                          </span>
                          <span className="font-mono">
                            {settings.preset.maxTokens}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="150000"
                          step="1000"
                          value={settings.preset.maxTokens}
                          onChange={(e) =>
                            updateSettings({
                              ...settings,
                              preset: {
                                ...settings.preset,
                                id: "custom",
                                maxTokens: parseInt(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* IO section embedded in presets */}
                    <div className="pt-4 border-t border-border/50 space-y-3">
                      <span className="block text-[11px] font-bold text-primary">
                        存档与酒馆交互管理
                      </span>
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2 relative">
                          <select
                            className="flex-1 bg-muted/40 border border-border text-xs text-foreground rounded-md px-3 font-semibold h-9 outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                            value={settings.preset.id || ""}
                            onChange={(e) => {
                              if (e.target.value === "new")
                                handleSaveNewPresetBundle();
                              else handleLoadPresetBundle(e.target.value);
                            }}
                          >
                            <option value="" disabled>
                              当前正在编辑: {settings.preset.name}
                            </option>
                            <option
                              value="new"
                              className="text-primary font-bold"
                            >
                              ➕ 保存副本
                            </option>
                            {(settings.savedPresets || []).map((p) => (
                              <option key={p.id} value={p.id}>
                                📄 {p.preset.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() =>
                              handleDeletePresetBundle(settings.preset.id)
                            }
                            disabled={
                              (settings.savedPresets || []).length === 0 ||
                              !settings.preset.id
                            }
                            className="shrink-0 bg-destructive/10 border border-destructive/20 text-destructive disabled:opacity-30 p-2 rounded-md transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
                          <label className="bg-muted cursor-pointer hover:bg-muted/80 text-foreground py-2 border border-border rounded-md text-center transition flex justify-center items-center gap-1">
                            <Download className="w-3.5 h-3.5" /> 导入配置
                            <input
                              type="file"
                              onChange={handleImportPresetJSON}
                              accept=".json"
                              className="hidden"
                            />
                          </label>
                          <button
                            onClick={handleExportPresetJSON}
                            className="bg-muted hover:bg-muted/80 text-foreground py-2 border border-border rounded-md transition flex justify-center items-center gap-1"
                          >
                            <Upload className="w-3.5 h-3.5" /> 导出酒馆
                          </button>
                        </div>
                      </div>

                      {/* 全局正则脚本管理器 */}
                      <div className="pt-5 border-t border-border/50 space-y-5 animate-in fade-in duration-300">
                        {/* 轨1. 全局正则 */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <div className="space-y-0.5">
                              <span className="block text-[11px] font-bold text-primary">
                                🌌 全局正则脚本 (Global Regex)
                              </span>
                              <span className="text-[9.5px] text-muted-foreground block">
                                对所有角色和所有预设生效，保存在全局设置中
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRegex({
                                  id: "reg_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
                                  scriptName: "",
                                  findRegex: "",
                                  replaceString: "",
                                  disabled: false,
                                  placement: [2],
                                  runOnEdit: true,
                                  markdownOnly: false,
                                  promptOnly: false,
                                  scope: "global",
                                });
                                setIsRegexModalOpen(true);
                              }}
                              className="text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 border border-primary/25 rounded-md flex items-center gap-1 transition tap-scale"
                            >
                              <Plus className="w-2.5 h-2.5" /> 新建全局
                            </button>
                          </div>

                          {(!settings.globalRegexScripts || settings.globalRegexScripts.length === 0) ? (
                            <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                              <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                                暂无全局正则脚本，可手动新建过滤 {"<think>"} 标签。
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                              {settings.globalRegexScripts.map((r) => (
                                <div
                                  key={r.id}
                                  className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                                    r.disabled ? "opacity-60" : ""
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[11px] font-bold truncate max-w-[150px] ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                        {r.scriptName}
                                      </span>
                                      <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                                        {r.placement?.includes(1) && r.placement?.includes(2)
                                          ? "双向"
                                          : r.placement?.includes(1)
                                          ? "输入"
                                          : "输出"}
                                      </span>
                                    </div>
                                    <div className="text-[9.5px] text-muted-foreground font-mono truncate mt-0.5 max-w-[220px]">
                                      {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 scale-90">
                                    <Switch
                                      checked={!r.disabled}
                                      onCheckedChange={(checked) => toggleRegexDisabled(r.id, !checked, "global")}
                                      className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingRegex({ ...r, scope: "global" });
                                        setIsRegexModalOpen(true);
                                      }}
                                      className="text-[9.5px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                                    >
                                      编辑
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteRegex(r.id, r.scriptName, "global")}
                                      className="text-[9.5px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                                    >
                                      删除
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 轨2. 预设正则 */}
                        <div className="space-y-3 pt-3 border-t border-border/40">
                          <div className="flex justify-between items-center">
                            <div className="space-y-0.5">
                              <span className="block text-[11px] font-bold text-primary">
                                📋 预设专属正则 (Preset Regex)
                              </span>
                              <span className="text-[9.5px] text-muted-foreground block">
                                仅在当前预设 [{settings.preset.name}] 激活时生效，随预设一同保存导出
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRegex({
                                  id: "reg_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
                                  scriptName: "",
                                  findRegex: "",
                                  replaceString: "",
                                  disabled: false,
                                  placement: [2],
                                  runOnEdit: true,
                                  markdownOnly: false,
                                  promptOnly: false,
                                  scope: "preset",
                                });
                                setIsRegexModalOpen(true);
                              }}
                              className="text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 border border-primary/25 rounded-md flex items-center gap-1 transition tap-scale"
                            >
                              <Plus className="w-2.5 h-2.5" /> 新建预设
                            </button>
                          </div>

                          {(!settings.presetRegexScripts || settings.presetRegexScripts.length === 0) ? (
                            <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                              <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                                暂无预设专属正则脚本，导入预设时会自动解析导入。
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                              {settings.presetRegexScripts.map((r) => (
                                <div
                                  key={r.id}
                                  className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                                    r.disabled ? "opacity-60" : ""
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[11px] font-bold truncate max-w-[150px] ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                        {r.scriptName}
                                      </span>
                                      <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                                        {r.placement?.includes(1) && r.placement?.includes(2)
                                          ? "双向"
                                          : r.placement?.includes(1)
                                          ? "输入"
                                          : "输出"}
                                      </span>
                                    </div>
                                    <div className="text-[9.5px] text-muted-foreground font-mono truncate mt-0.5 max-w-[220px]">
                                      {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 scale-90">
                                    <Switch
                                      checked={!r.disabled}
                                      onCheckedChange={(checked) => toggleRegexDisabled(r.id, !checked, "preset")}
                                      className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingRegex({ ...r, scope: "preset" });
                                        setIsRegexModalOpen(true);
                                      }}
                                      className="text-[9.5px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                                    >
                                      编辑
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteRegex(r.id, r.scriptName, "preset")}
                                      className="text-[9.5px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                                    >
                                      删除
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 轨3. 角色局部正则（只读展示） */}
                        <div className="space-y-3 pt-3 border-t border-border/40">
                          <div className="space-y-0.5">
                            <span className="block text-[11px] font-bold text-primary">
                              🎭 活跃角色专属局部正则 (Character Local Regex)
                            </span>
                            <span className="text-[9.5px] text-muted-foreground block">
                              仅当活跃角色 [{activeCharacter?.name || "未选择"}] 开启时生效，保存在角色卡 extensions 中 (只读展示)
                            </span>
                          </div>

                          {(!activeCharacter || !activeCharacter.extensions?.regex_scripts || activeCharacter.extensions.regex_scripts.length === 0) ? (
                            <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                              <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                                当前角色暂无专属局部正则。可导出角色卡 JSON 手动修改 extensions.regex_scripts 声明。
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1 opacity-75">
                              {activeCharacter.extensions.regex_scripts.map((r: any) => (
                                <div
                                  key={r.id || r.scriptName}
                                  className={`border border-border/30 rounded-lg p-2 bg-muted/5 flex items-center justify-between gap-3 ${
                                    r.disabled ? "opacity-50" : ""
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[11px] font-semibold truncate max-w-[150px] ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                        {r.scriptName}
                                      </span>
                                      <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                                        {r.placement?.includes(1) && r.placement?.includes(2)
                                          ? "双向"
                                          : r.placement?.includes(1)
                                          ? "输入"
                                          : "输出"}
                                      </span>
                                    </div>
                                    <div className="text-[9.5px] text-muted-foreground font-mono truncate mt-0.5 max-w-[250px]">
                                      {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                                    </div>
                                  </div>
                                  <div className="text-[9.5px] text-muted-foreground shrink-0 select-none">
                                    {r.disabled ? "已禁用" : "已启用"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {sillyInnerTab === "prompts" && (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="bg-muted/50 p-3 rounded-lg border border-border/50 text-[11px] text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        注入环境兼容 ST 标签：
                        <code className="text-primary bg-primary/10 px-1 rounded">
                          {"{{char}}"}, {"{{user}}"}
                        </code>{" "}
                        等规则动态匹配宏处理。
                      </p>
                    </div>

                    {/* CORE PROMPT BLOCKS */}
                    <span className="block text-xs font-bold font-mono text-foreground">CORE PROMPTS</span>
                    <Accordion type="multiple" className="space-y-2">

                      {/* 1. 底层扮演指令 (Main System Prompt) */}
                      <AccordionItem value="main-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
                        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                          <div className="flex items-center gap-2 flex-1">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-foreground">底层扮演指令</span>
                              <span className="text-[9px] font-mono text-muted-foreground">system · 最顶部注入</span>
                            </div>
                          </div>
                          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
                        </div>
                        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                          <div className="pt-3">
                            <Textarea
                              value={settings.promptConfig.mainPrompt || ""}
                              onChange={(e) =>
                                updateSettings({
                                  ...settings,
                                  promptConfig: {
                                    ...settings.promptConfig,
                                    mainPrompt: e.target.value,
                                  },
                                })
                              }
                              className="min-h-[240px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
                              placeholder="输入底层角色扮演系统指令..."
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {/* 2. 破限提示词 (Jailbreak) */}
                      <AccordionItem value="jailbreak-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
                        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                          <div className="flex items-center gap-2 flex-1">
                            <Switch
                              checked={settings.promptConfig.useJailbreak}
                              onCheckedChange={(checked) =>
                                updateSettings({
                                  ...settings,
                                  promptConfig: {
                                    ...settings.promptConfig,
                                    useJailbreak: checked,
                                  },
                                })
                              }
                              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                            />
                            <div className="flex flex-col">
                              <span className={`text-xs font-bold truncate ${settings.promptConfig.useJailbreak ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                                破限提示词 (Jailbreak)
                              </span>
                              <span className="text-[9px] font-mono text-muted-foreground">system · beforeLast 前注入</span>
                            </div>
                          </div>
                          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
                        </div>
                        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                          <div className="pt-3">
                            <Textarea
                              value={settings.promptConfig.jailbreakPrompt || ""}
                              onChange={(e) =>
                                updateSettings({
                                  ...settings,
                                  promptConfig: {
                                    ...settings.promptConfig,
                                    jailbreakPrompt: e.target.value,
                                  },
                                })
                              }
                              className="min-h-[240px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
                              placeholder="输入破限提示词..."
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {/* 3. 生成纪律提醒 (Post-History) */}
                      <AccordionItem value="post-history-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
                        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                          <div className="flex items-center gap-2 flex-1">
                            <Switch
                              checked={settings.promptConfig.usePostHistory}
                              onCheckedChange={(checked) =>
                                updateSettings({
                                  ...settings,
                                  promptConfig: {
                                    ...settings.promptConfig,
                                    usePostHistory: checked,
                                  },
                                })
                              }
                              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                            />
                            <div className="flex flex-col">
                              <span className={`text-xs font-bold truncate ${settings.promptConfig.usePostHistory ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                                生成纪律提醒 (Post-History)
                              </span>
                              <span className="text-[9px] font-mono text-muted-foreground">system · 历史记录末尾压轴</span>
                            </div>
                          </div>
                          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
                        </div>
                        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                          <div className="pt-3">
                            <Textarea
                              value={settings.promptConfig.postHistoryPrompt || ""}
                              onChange={(e) =>
                                updateSettings({
                                  ...settings,
                                  promptConfig: {
                                    ...settings.promptConfig,
                                    postHistoryPrompt: e.target.value,
                                  },
                                })
                              }
                              className="min-h-[200px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
                              placeholder="输入尾部纪律提醒指令..."
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    <div className="flex justify-between items-center mb-1 pt-2 border-t border-border/50">
                      <span className="text-xs font-bold font-mono text-foreground">
                        PROMPT MODULES
                      </span>
                      <button
                        onClick={handleAddNewCustomPrompt}
                        className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20 flex items-center gap-1 transition"
                      >
                        <Plus className="w-3 h-3" /> 新建模组
                      </button>
                    </div>

                    {!settings.promptConfig.customPrompts ||
                    settings.promptConfig.customPrompts.length === 0 ? (
                      <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                        <HelpCircle className="w-6 h-6 opacity-50" />
                        <span className="text-xs font-semibold">
                          无挂载规则组件
                        </span>
                      </div>
                    ) : (
                      <Accordion type="multiple" className="space-y-2">
                        {settings.promptConfig.customPrompts.map((p) => (
                          <AccordionItem
                            value={p.id}
                            key={p.id}
                            className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 [&[data-state=open]]:shadow-sm [&[data-state=open]]:ring-1 [&[data-state=open]]:ring-primary/10 transition-all duration-200"
                          >
                            <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                              <div className="flex items-center gap-2 flex-1">
                                <Switch
                                  checked={p.enabled}
                                  onCheckedChange={(checked) =>
                                    handleToggleCustomPrompt(p.id, checked)
                                  }
                                  className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                                />
                                <span
                                  className={`text-xs font-bold truncate max-w-[120px] ${p.enabled ? "text-foreground" : "text-muted-foreground opacity-70"}`}
                                >
                                  {p.name}
                                </span>
                                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 border border-border/70 rounded bg-background text-muted-foreground shrink-0">
                                  {p.role.toUpperCase()}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCustomPrompt(p.id);
                                  }}
                                  className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground rounded transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
                              </div>
                            </div>
                            <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                              <div className="pt-3 space-y-3">
                                <div className="flex gap-2">
                                  <Input
                                    value={p.name}
                                    onChange={(e) =>
                                      handleUpdateCustomPrompt(
                                        p.id,
                                        e.target.value,
                                        p.role,
                                        p.content,
                                      )
                                    }
                                    className="h-8 text-xs bg-input/50 focus-visible:ring-1"
                                  />
                                  <Select
                                    value={p.role}
                                    onValueChange={(v) =>
                                      handleUpdateCustomPrompt(
                                        p.id,
                                        p.name,
                                        v,
                                        p.content,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-28 h-8 text-xs bg-input/50 focus:ring-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem
                                        value="system"
                                        className="text-xs"
                                      >
                                        SYSTEM
                                      </SelectItem>
                                      <SelectItem
                                        value="user"
                                        className="text-xs"
                                      >
                                        USER
                                      </SelectItem>
                                      <SelectItem
                                        value="assistant"
                                        className="text-xs"
                                      >
                                        ASSIST
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Textarea
                                  value={p.content}
                                  onChange={(e) =>
                                    handleUpdateCustomPrompt(
                                      p.id,
                                      p.name,
                                      p.role,
                                      e.target.value,
                                    )
                                  }
                                  className="min-h-[220px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground font-sans shadow-inner"
                                  placeholder="Enter strict instructions here..."
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </div>
                )}

              </div>
            </div>
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

      {/* 新建/编辑正则 Modal 浮窗 */}
      {isRegexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-background border border-border rounded-xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">
                {editingRegex?.id?.startsWith("reg_") ? "新建全局正则脚本" : "编辑全局正则脚本"}
              </h3>
              <button
                onClick={() => {
                  setIsRegexModalOpen(false);
                  setEditingRegex(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition font-semibold"
              >
                关闭
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">脚本名称</label>
                <Input
                  value={editingRegex?.scriptName || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, scriptName: e.target.value }))
                  }
                  placeholder="例如：隐藏思维链"
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">匹配正则表达式 (支持 /pattern/flags 格式)</label>
                <Input
                  value={editingRegex?.findRegex || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, findRegex: e.target.value }))
                  }
                  placeholder="例如：/<think>[\s\S]*?<\/think>/gi"
                  className="h-9 text-xs font-mono bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">替换文本 (可以使用 $1, $2 占位符)</label>
                <Input
                  value={editingRegex?.replaceString || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, replaceString: e.target.value }))
                  }
                  placeholder="例如：（留空代表直接删除匹配内容）"
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">作用阶段 (Placement)</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingRegex?.placement?.includes(1) || false}
                      onChange={(e) => {
                        const current = editingRegex?.placement || [2];
                        let next;
                        if (e.target.checked) {
                          next = [...current.filter((x: any) => x !== 1), 1];
                        } else {
                          next = current.filter((x: any) => x !== 1);
                        }
                        setEditingRegex((prev: any) => ({ ...prev, placement: next }));
                      }}
                      className="w-3.5 h-3.5 rounded border-border bg-input text-primary accent-primary"
                    />
                    输入阶段 (拦截发送)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingRegex?.placement?.includes(2) || false}
                      onChange={(e) => {
                        const current = editingRegex?.placement || [2];
                        let next;
                        if (e.target.checked) {
                          next = [...current.filter((x: any) => x !== 2), 2];
                        } else {
                          next = current.filter((x: any) => x !== 2);
                        }
                        setEditingRegex((prev: any) => ({ ...prev, placement: next }));
                      }}
                      className="w-3.5 h-3.5 rounded border-border bg-input text-primary accent-primary"
                    />
                    输出阶段 (渲染渲染)
                  </label>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsRegexModalOpen(false);
                  setEditingRegex(null);
                }}
                className="px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted rounded-md transition"
              >
                取消
              </button>
              <button
                onClick={() => saveRegex(editingRegex)}
                className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
