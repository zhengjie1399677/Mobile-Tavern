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
  } = useContext(AppContext);
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
              <AccordionItem value="api-config" className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition">
                  <div className="flex items-center gap-2">
                    <KeySquare className="w-4 h-4 text-primary" />
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-sm font-semibold">API 服务端点配置</span>
                      <span className="text-[10px] text-muted-foreground font-normal">配置大语言模型接口地址与授权凭证</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 pt-2 border-t border-border/50 space-y-4">
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
                          updateSettings({
                            ...settings,
                            api: {
                              ...settings.api,
                              savedUrls: [...(settings.api.savedUrls || []), settings.api.baseUrl]
                            }
                          });
                        }
                      }}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          api: { ...settings.api, baseUrl: e.target.value },
                        })
                      }
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
                            updateSettings({
                              ...settings,
                              api: { ...settings.api, baseUrl: preset.u },
                            })
                          }
                          className="text-[9px] bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border"
                        >
                          {preset.n}
                        </button>
                      ))}
                      {settings.api.savedUrls && settings.api.savedUrls.length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateSettings({ ...settings, api: { ...settings.api, savedUrls: [] }})}
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
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            api: { ...settings.api, apiKey: e.target.value },
                          })
                        }
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
                          updateSettings({
                            ...settings,
                            api: { ...settings.api, modelName: val },
                          })
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
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            api: { ...settings.api, modelName: e.target.value },
                          })
                        }
                        className="h-9 text-xs font-mono bg-input/50"
                        placeholder="gpt-4o"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/30">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">
                        对话接口路径 (Chat Path)
                      </label>
                      <Input
                        value={settings.api.chatPath || ""}
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            api: { ...settings.api, chatPath: e.target.value },
                          })
                        }
                        className="h-8 text-xs font-mono bg-input/50"
                        placeholder="/chat/completions"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">
                        模型拉取路径 (Models Path)
                      </label>
                      <Input
                        value={settings.api.modelsPath || ""}
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            api: { ...settings.api, modelsPath: e.target.value },
                          })
                        }
                        className="h-8 text-xs font-mono bg-input/50"
                        placeholder="/models"
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* 2. THEME CONFIG */}
            <Card className="bg-card border-border shadow-sm">
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
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* 3. DEVELOPER PLAYGROUND */}
            <Card className="bg-card border-border shadow-sm border-dashed border-primary/30">
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
            <Card className="bg-card border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-primary" /> 角色信息
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
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
                    玩家信息 (Persona: 世界观背景/外貌描述等)
                  </label>
                  <Textarea
                    value={settings.userInfo || ""}
                    onChange={(e) =>
                      updateSettings({ ...settings, userInfo: e.target.value })
                    }
                    className="text-xs bg-input/50 min-h-[80px]"
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
              </CardContent>
            </Card>

            <Card className="bg-card border-border shadow-sm mt-4">
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
            <div className="border border-border/70 rounded-xl overflow-hidden bg-card shadow-sm flex flex-col">
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
                          max="30000"
                          step="500"
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
                              className="min-h-[120px] text-[11px] font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
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
                              className="min-h-[120px] text-[11px] font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
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
                              className="min-h-[120px] text-[11px] font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
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
                                  className="min-h-[140px] text-[11px] font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground font-sans shadow-inner"
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
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
