import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { DEFAULT_PRESETS } from "../App";
import { cn } from "../../lib/utils";
import {
  Plus,
  Trash2,
  Brain,
  Download,
  Upload,
  HelpCircle,
  AlertCircle,
  Sparkles,
  Puzzle,
  Sliders,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../components/ui/accordion";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

export default function PresetForm() {
  const {
    settings,
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
    showCustomConfirm,
    showCustomAlert,
    activeCharacter,
  } = useContext(AppContext);

  // 子条目多选状态
  const [selectedPromptIds, setSelectedPromptIds] = React.useState<string[]>([]);
  const [selectedGlobalRegexIds, setSelectedGlobalRegexIds] = React.useState<string[]>([]);
  const [selectedPresetRegexIds, setSelectedPresetRegexIds] = React.useState<string[]>([]);

  // 批量删除编辑模式状态
  const [isBatchDeletingPrompts, setIsBatchDeletingPrompts] = React.useState(false);
  const [isBatchDeletingGlobalRegex, setIsBatchDeletingGlobalRegex] = React.useState(false);
  const [isBatchDeletingPresetRegex, setIsBatchDeletingPresetRegex] = React.useState(false);

  // 表单折叠状态（默认折叠，通过 localStorage 持久化记住操作）
  const [isSamplersFolded, setIsSamplersFolded] = React.useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_samplers");
    return val !== null ? val === "true" : true;
  });
  const [isPromptsFolded, setIsPromptsFolded] = React.useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_prompts");
    return val !== null ? val === "true" : true;
  });
  const [isRegexFolded, setIsRegexFolded] = React.useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_regex");
    return val !== null ? val === "true" : true;
  });

  const handleToggleSamplersFold = () => {
    setIsSamplersFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_samplers", String(next));
      return next;
    });
  };
  const handleTogglePromptsFold = () => {
    setIsPromptsFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_prompts", String(next));
      return next;
    });
  };
  const handleToggleRegexFold = () => {
    setIsRegexFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_regex", String(next));
      return next;
    });
  };

  // 计算卡片折叠状态摘要信息
  const activeCustomPrompts = (settings.promptConfig?.customPrompts || []).filter((p: any) => p.enabled).length;
  const systemOn = settings.promptConfig?.useMainPrompt;
  const jailbreakOn = settings.promptConfig?.useJailbreak;
  const postHistoryOn = settings.promptConfig?.usePostHistory;
  
  const coreStatusText = [
    systemOn ? "Sys" : null,
    jailbreakOn ? "Jb" : null,
    postHistoryOn ? "Post" : null
  ].filter(Boolean).join("+") || "无";

  const activeGlobalRegex = (settings.globalRegexScripts || []).filter((r: any) => !r.disabled).length;
  const activePresetRegex = (settings.presetRegexScripts || []).filter((r: any) => !r.disabled).length;
  const activeCharRegex = (activeCharacter?.extensions?.regex_scripts || []).filter((r: any) => !r.disabled).length;

  // 正则脚本编辑器局部状态
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

  // 批量删除处理逻辑
  const handleBatchDeletePrompts = async () => {
    if (selectedPromptIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedPromptIds.length} 个提示词模组吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: (prev.promptConfig.customPrompts || []).filter(
          (p: any) => !selectedPromptIds.includes(p.id)
        ),
      },
    }));
    setSelectedPromptIds([]);
    setIsBatchDeletingPrompts(false);
  };

  const handleBatchDeleteGlobalRegex = async () => {
    if (selectedGlobalRegexIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedGlobalRegexIds.length} 个全局正则脚本吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      globalRegexScripts: (prev.globalRegexScripts || []).filter(
        (r: any) => !selectedGlobalRegexIds.includes(r.id)
      ),
    }));
    setSelectedGlobalRegexIds([]);
    setIsBatchDeletingGlobalRegex(false);
  };

  const handleBatchDeletePresetRegex = async () => {
    if (selectedPresetRegexIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedPresetRegexIds.length} 个预设专属正则脚本吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      presetRegexScripts: (prev.presetRegexScripts || []).filter(
        (r: any) => !selectedPresetRegexIds.includes(r.id)
      ),
    }));
    setSelectedPresetRegexIds([]);
    setIsBatchDeletingPresetRegex(false);
  };

  return (
    <div className="space-y-4">
      {/* 1. 预设选择与管理 */}
      <Card className="glass-panel shadow-sm p-3">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 relative">
            <select
              className="flex-1 bg-muted/40 border border-border text-xs text-foreground rounded-md px-3 font-semibold h-9 outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
              value={settings.preset.id || ""}
              onChange={(e) => handleLoadPresetBundle(e.target.value)}
            >
              <option value="" disabled>
                当前预设: {settings.preset.name}
              </option>
              <option value="default">
                ⚙️ 基本预设
              </option>
              {(settings.savedPresets || []).map((p) => (
                <option key={p.id} value={p.id}>
                  📄 {p.preset.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleSaveNewPresetBundle}
              title="另存为新预设副本"
              className="shrink-0 bg-primary/10 border border-primary/20 hover:border-primary/30 text-primary p-2 rounded-md transition tap-scale flex items-center justify-center"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                handleDeletePresetBundle(settings.preset.id)
              }
              disabled={
                (settings.savedPresets || []).length === 0 ||
                !settings.preset.id ||
                settings.preset.id === "default" ||
                Object.keys(DEFAULT_PRESETS).includes(settings.preset.id)
              }
              title="删除当前自定义预设"
              className="shrink-0 bg-muted hover:bg-destructive/10 border border-border hover:border-destructive/20 text-muted-foreground hover:text-destructive disabled:opacity-20 disabled:bg-muted/30 disabled:border-transparent p-2 rounded-md transition tap-scale flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
            <label className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 py-2 rounded-md text-center transition flex justify-center items-center gap-1 cursor-pointer tap-scale shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
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
              className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 py-2 rounded-md transition flex justify-center items-center gap-1 tap-scale shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
            >
              <Upload className="w-3.5 h-3.5" /> 导出配置
            </button>
          </div>
        </div>
      </Card>

      {/* 2. 温度与采样参数 */}
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isSamplersFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isSamplersFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleToggleSamplersFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 shrink-0">
              <Sliders className="w-4 h-4 text-primary" /> 温度与采样参数
            </CardTitle>
            <div className="flex items-center gap-2 overflow-hidden">
              {isSamplersFolded && (
                <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                  T: {settings.preset.temperature} | P: {settings.preset.topP} | Max: {settings.preset.maxTokens}
                </span>
              )}
              {isSamplersFolded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          </div>
          {!isSamplersFolded && (
            <CardDescription className="text-[11px] mt-1">
              调节模型生成时的随机性、惩罚与最大长度等采样参数
            </CardDescription>
          )}
        </CardHeader>
        {!isSamplersFolded && (
          <CardContent className="pt-4 space-y-5 overflow-hidden w-full">
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

          <div className="space-y-4 pt-4 border-t border-border/50 text-xs w-full overflow-hidden">
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold">温度 (Temp)</span>
                <span className="font-mono w-12 text-right">
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
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold">核采样 (Top P)</span>
                <span className="font-mono w-12 text-right">
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
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold">
                  重复惩罚 (Rep Penalty)
                </span>
                <span className="font-mono w-12 text-right">
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
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold">
                  长度上限 (Max Tokens)
                </span>
                <span className="font-mono w-16 text-right">
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
        </CardContent>
        )}
      </Card>

      {/* 3. 预设提示词配置 */}
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isPromptsFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isPromptsFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleTogglePromptsFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 shrink-0">
              <Brain className="w-4 h-4 text-primary" /> 预设提示词配置
            </CardTitle>
            <div className="flex items-center gap-2 overflow-hidden">
              {isPromptsFolded && (
                <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                  核心: {coreStatusText} | 模组: {activeCustomPrompts}
                </span>
              )}
              {isPromptsFolded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          </div>
          {!isPromptsFolded && (
            <CardDescription className="text-[11px] mt-1">
              配置底层扮演指令、破限提示以及颗粒化扩展提示词模组
            </CardDescription>
          )}
        </CardHeader>
        {!isPromptsFolded && (
          <CardContent className="pt-4 space-y-4">
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
                  <Switch
                    checked={settings.promptConfig.useMainPrompt}
                    onCheckedChange={(checked) =>
                      updateSettings({
                        ...settings,
                        promptConfig: {
                          ...settings.promptConfig,
                          useMainPrompt: checked,
                        },
                      })
                    }
                    className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                  />
                  <div className="flex flex-col">
                    <span className={`text-xs font-bold truncate ${settings.promptConfig.useMainPrompt ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                      底层扮演系统指令 (System Prompt)
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground">system · 处于上下文最顶部</span>
                  </div>
                </div>
                <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
              </div>
              <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                <div className="pt-3">
                  <Textarea
                    value={settings.promptConfig.mainSystemPrompt || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        promptConfig: {
                          ...settings.promptConfig,
                          mainSystemPrompt: e.target.value,
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

          <div className="flex justify-between items-center mb-1 pt-2 border-t border-border/50 flex-wrap gap-2">
            <span className="text-xs font-bold font-mono text-foreground">
              PROMPT MODULES
            </span>
            <div className="flex gap-2">
              {isBatchDeletingPrompts ? (
                <>
                  <button
                    type="button"
                    onClick={handleBatchDeletePrompts}
                    disabled={selectedPromptIds.length === 0}
                    className="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 确认删除 ({selectedPromptIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsBatchDeletingPrompts(false);
                      setSelectedPromptIds([]);
                    }}
                    className="text-xs font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 rounded border border-border flex items-center gap-1 transition tap-scale"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  {settings.promptConfig.customPrompts && settings.promptConfig.customPrompts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsBatchDeletingPrompts(true)}
                      className="text-xs font-bold text-rose-500 bg-rose-500/5 hover:bg-rose-500/10 px-2 py-1 rounded border border-rose-500/10 flex items-center gap-1 transition tap-scale"
                    >
                      批量删除
                    </button>
                  )}
                  <button
                    onClick={handleAddNewCustomPrompt}
                    className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                  >
                    <Plus className="w-3 h-3" /> 新建模组
                  </button>
                </>
              )}
            </div>
          </div>

          {!settings.promptConfig.customPrompts ||
          settings.promptConfig.customPrompts.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
              <HelpCircle className="w-6 h-6 opacity-50" />
              <span className="text-xs font-semibold">
                无挂规则组件
              </span>
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {settings.promptConfig.customPrompts.map((p) => (
                <AccordionItem
                  value={p.id}
                  key={p.id}
                  className="group/accordion-item border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 [&[data-state=open]]:shadow-sm [&[data-state=open]]:ring-1 [&[data-state=open]]:ring-primary/10 transition-all duration-200"
                >
                  <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                    <div className="flex items-center gap-2 flex-1">
                      {isBatchDeletingPrompts && (
                        <input
                          type="checkbox"
                          checked={selectedPromptIds.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPromptIds((prev) => [...prev, p.id]);
                            } else {
                              setSelectedPromptIds((prev) => prev.filter((id) => id !== p.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-border bg-input text-primary accent-primary cursor-pointer focus:ring-0 shrink-0"
                        />
                      )}
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(checked) =>
                          handleToggleCustomPrompt(p.id, checked)
                        }
                        className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                      />
                      <span
                        className={cn(
                          "text-[10px] font-bold transition-all duration-200 block",
                          p.enabled ? "text-foreground" : "text-muted-foreground opacity-70",
                          "truncate max-w-[120px]",
                          "group-data-[state=open]/accordion-item:max-w-none group-data-[state=open]/accordion-item:whitespace-normal group-data-[state=open]/accordion-item:overflow-visible"
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="text-[8px] font-mono font-semibold px-1.5 py-0.5 border border-border/70 rounded bg-background text-muted-foreground shrink-0">
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
        </CardContent>
        )}
      </Card>

      {/* 4. 正则过滤脚本管理 */}
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isRegexFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isRegexFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 shrink-0">
              <Sparkles className="w-4 h-4 text-primary" /> 正则过滤脚本管理
            </CardTitle>
            <div className="flex items-center gap-2 overflow-hidden">
              {isRegexFolded && (
                <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                  全局: {activeGlobalRegex} | 预设: {activePresetRegex} | 角色: {activeCharRegex}
                </span>
              )}
              {isRegexFolded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          </div>
          {!isRegexFolded && (
            <CardDescription className="text-[11px] mt-1">
              配置全局和预设专属正则表达式过滤规则，在发送或展示前对文本进行净化
            </CardDescription>
          )}
        </CardHeader>
        {!isRegexFolded && (
          <CardContent className="pt-4 space-y-5">
          {/* 轨1. 全局正则 */}
          <div className="space-y-3">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-[11px] font-bold text-primary">
                  🌌 全局正则脚本 (Global Regex)
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  对所有角色和所有预设生效，保存在全局设置中
                </span>
              </div>
              <div className="flex gap-2">
                {isBatchDeletingGlobalRegex ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeleteGlobalRegex}
                      disabled={selectedGlobalRegexIds.length === 0}
                      className="text-[10px] font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                    >
                      <Trash2 className="w-3 h-3" /> 确认删除 ({selectedGlobalRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingGlobalRegex(false);
                        setSelectedGlobalRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {settings.globalRegexScripts && settings.globalRegexScripts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingGlobalRegex(true)}
                        className="text-[10px] font-bold text-rose-500 bg-rose-500/5 hover:bg-rose-500/10 px-2 py-1 border border-rose-500/10 flex items-center gap-1 transition tap-scale"
                      >
                        批量删除
                      </button>
                    )}
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
                  </>
                )}
              </div>
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
                    {isBatchDeletingGlobalRegex && (
                      <input
                        type="checkbox"
                        checked={selectedGlobalRegexIds.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGlobalRegexIds((prev) => [...prev, r.id]);
                          } else {
                            setSelectedGlobalRegexIds((prev) => prev.filter((id) => id !== r.id));
                          }
                        }}
                        className="w-4 h-4 rounded border-border bg-input text-primary accent-primary cursor-pointer focus:ring-0 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
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
                      <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
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
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "global")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
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
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-[11px] font-bold text-primary">
                  📋 预设专属正则 (Preset Regex)
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  仅在当前预设 [{settings.preset.name}] 激活时生效，随预设一同保存导出
                </span>
              </div>
              <div className="flex gap-2">
                {isBatchDeletingPresetRegex ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeletePresetRegex}
                      disabled={selectedPresetRegexIds.length === 0}
                      className="text-[10px] font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                    >
                      <Trash2 className="w-3 h-3" /> 确认删除 ({selectedPresetRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingPresetRegex(false);
                        setSelectedPresetRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {settings.presetRegexScripts && settings.presetRegexScripts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingPresetRegex(true)}
                        className="text-[10px] font-bold text-rose-500 bg-rose-500/5 hover:bg-rose-500/10 px-2 py-1 border border-rose-500/10 flex items-center gap-1 transition tap-scale"
                      >
                        批量删除
                      </button>
                    )}
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
                  </>
                )}
              </div>
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
                    {isBatchDeletingPresetRegex && (
                      <input
                        type="checkbox"
                        checked={selectedPresetRegexIds.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPresetRegexIds((prev) => [...prev, r.id]);
                          } else {
                            setSelectedPresetRegexIds((prev) => prev.filter((id) => id !== r.id));
                          }
                        }}
                        className="w-4 h-4 rounded border-border bg-input text-primary accent-primary cursor-pointer focus:ring-0 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
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
                      <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
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
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "preset")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
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
                        <span className={`text-[10px] font-semibold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
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
                      <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
                        {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground shrink-0 select-none">
                      {r.disabled ? "已禁用" : "已启用"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
        )}
      </Card>

      {/* 新建/编辑正则 Modal 浮窗 */}
      {isRegexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-background border border-border rounded-xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">
                {editingRegex?.id?.startsWith("reg_") ? "新建正则脚本" : "编辑正则脚本"}
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
