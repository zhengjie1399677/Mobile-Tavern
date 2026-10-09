import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronUp, HelpCircle, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Card, CardHeader, CardContent } from "../../../components/ui/card";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Switch } from "../../../components/ui/switch";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import type { PromptConfig, UserSettings } from "../../types";
import {
  RECOMMENDED_PROMPT_TEMPLATES,
  type PromptTemplateItem,
} from "../../domain/prompts/recommendedPromptTemplates";
import { isSameSourcePromptBlock } from "../../domain/prompts/promptSourceBlocks";

interface PromptsConfigSectionProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  handleToggleCustomPrompt: (id: string, enabled: boolean) => void;
  handleUpdateCustomPrompt: (id: string, name: string, role: "system" | "user" | "assistant", content: string) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
  handleDeleteBuiltinPrompt: (kind: "main" | "jailbreak") => Promise<void>;
  isPromptsFolded: boolean;
  handleTogglePromptsFold: () => void;
  coreStatusText?: string;
  activeCustomPrompts?: number;
  selectedPromptIds: string[];
  setSelectedPromptIds: (value: string[] | ((prev: string[]) => string[])) => void;
  isBatchDeletingPrompts: boolean;
  setIsBatchDeletingPrompts: (value: boolean | ((prev: boolean) => boolean)) => void;
  handleBatchDeletePrompts: () => Promise<void>;
}

interface UnifiedPromptItem {
  id: string;
  /** 真正用于回写提示词列表的 id（可能与 React key/展开态用的 id 不同）。 */
  targetId: string;
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  enabled: boolean;
  type: "main" | "jailbreak" | "custom";
}

/**
 * 内置伪条目的显示名归一。
 *
 * 留空或恰好等于界面默认文案时不落库，保证切换语言后仍显示对应语言的默认名。
 */
function withBuiltinPromptName(
  config: PromptConfig,
  field: "mainPromptName" | "jailbreakPromptName",
  name: string,
  defaultLabel: string,
): PromptConfig {
  const trimmed = name.trim();
  const next: PromptConfig = { ...config };
  if (!trimmed || trimmed === defaultLabel) {
    delete next[field];
  } else {
    next[field] = trimmed;
  }
  return next;
}

/**
 * 预设提示词配置：
 * - 过滤纯系统插槽锚点（marker === true），不在模组列表平铺占位空卡片；
 * - 完整展示所有已启用与未启用提示词，关闭时原地保留，对齐 SillyTavern 交互规范；
 * - 支持关键字实时搜索过滤；
 * - 支持角色选择（System / User / Assistant）与紧凑卡片渲染。
 */
export default function PromptsConfigSection({
  settings,
  updateSettings,
  handleToggleCustomPrompt,
  handleUpdateCustomPrompt,
  handleAddNewCustomPrompt,
  handleDeleteCustomPrompt,
  handleDeleteBuiltinPrompt,
  isPromptsFolded,
  handleTogglePromptsFold,
  selectedPromptIds,
  setSelectedPromptIds,
  isBatchDeletingPrompts,
  setIsBatchDeletingPrompts,
  handleBatchDeletePrompts,
}: PromptsConfigSectionProps) {
  const { t } = useTranslation();
  const [searchKeyword, setSearchKeyword] = useState("");
  const [showTemplatesPanel, setShowTemplatesPanel] = useState(false);
  // 展开态受控：搜索过滤需要知道哪些条目是打开的，避免改名到不匹配关键字时卡片当场消失。
  const [openPromptIds, setOpenPromptIds] = useState<string[]>([]);
  const mainPromptLabel = t("prompts.system_prompt") || "系统提示词";
  const jailbreakPromptLabel = t("prompts.jailbreak") || "规则提示词";

  const handleAddTemplate = (tpl: PromptTemplateItem) => {
    const newId = "comp_" + Math.random().toString(36).substring(2, 9);
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          customPrompts: [
            ...list,
            {
              id: newId,
              name: tpl.name,
              role: tpl.role,
              content: tpl.content,
              enabled: true,
            },
          ],
        },
      };
    });
    setShowTemplatesPanel(false);
  };

  // 将内置提示词与自定义提示词收拢为统一列表（过滤纯系统插槽锚点）
  const unifiedPrompts = useMemo<UnifiedPromptItem[]>(() => {
    const list: UnifiedPromptItem[] = [];

    // 1. 系统扮演指令（仅在明确启用或存在非空内容且未显式关闭时展示）
    const hasMainPromptContent = Boolean(settings.promptConfig.mainPrompt && settings.promptConfig.mainPrompt.trim().length > 0);
    const shouldShowMainPrompt = settings.promptConfig.useMainPrompt === true
      || (settings.promptConfig.useMainPrompt !== false && hasMainPromptContent);
    const seenIds = new Set<string>();
    if (shouldShowMainPrompt) {
      seenIds.add("built-in-main-prompt");
      list.push({
        id: "built-in-main-prompt",
        targetId: "built-in-main-prompt",
        name: settings.promptConfig.mainPromptName?.trim() || mainPromptLabel,
        role: "system",
        content: settings.promptConfig.mainPrompt || "",
        enabled: settings.promptConfig.useMainPrompt ?? hasMainPromptContent,
        type: "main",
      });
    }

    // 2. 规则提示词（仅在明确启用或存在非空内容且未显式关闭时展示）
    const hasJailbreakContent = Boolean(settings.promptConfig.jailbreakPrompt && settings.promptConfig.jailbreakPrompt.trim().length > 0);
    const shouldShowJailbreak = settings.promptConfig.useJailbreak === true
      || (settings.promptConfig.useJailbreak !== false && hasJailbreakContent);
    if (shouldShowJailbreak) {
      seenIds.add("built-in-jailbreak-prompt");
      list.push({
        id: "built-in-jailbreak-prompt",
        targetId: "built-in-jailbreak-prompt",
        name: settings.promptConfig.jailbreakPromptName?.trim() || jailbreakPromptLabel,
        role: "system",
        content: settings.promptConfig.jailbreakPrompt || "",
        enabled: settings.promptConfig.useJailbreak ?? hasJailbreakContent,
        type: "jailbreak",
      });
    }

    // 3. 所有用户自定义提示词（过滤系统锚点占位符 marker === true）
    const customs = settings.promptConfig.customPrompts || [];
    for (let i = 0; i < customs.length; i++) {
      const c = customs[i];
      if (c.marker) {
        // 系统占位符锚点（如 chatHistory、charDescription、worldInfo 等），不在提示词输入列表中平铺
        continue;
      }
      // 与顶层系统/规则指令同源（空占位或完全同文）的区块不在列表平铺：
      // 运行期同样会去重，避免"界面看不到、实际却注入两次"。
      if (isSameSourcePromptBlock(c, "main", settings.promptConfig.mainPrompt)
        || isSameSourcePromptBlock(c, "jailbreak", settings.promptConfig.jailbreakPrompt)) {
        continue;
      }

      const sourceId = c.id || c.identifier || `prompt_${i + 1}`;
      let listKey = sourceId;
      if (seenIds.has(listKey)) {
        listKey = `${listKey}_${i + 1}`;
      }
      seenIds.add(listKey);

      list.push({
        id: listKey,
        targetId: sourceId,
        name: c.name || sourceId,
        role: c.role || "system",
        content: c.content || "",
        enabled: c.enabled,
        type: "custom",
      });
    }

    return list;
  }, [settings.promptConfig, mainPromptLabel, jailbreakPromptLabel]);

  const activeCount = useMemo(() => unifiedPrompts.filter((p) => p.enabled).length, [unifiedPrompts]);
  const inactiveCount = unifiedPrompts.length - activeCount;

  // 根据搜索关键字筛选显示列表（平铺展示所有模组，关闭条目就地展示不隐藏）
  const displayedPrompts = useMemo(() => {
    const trimmed = searchKeyword.trim().toLowerCase();
    if (!trimmed) return unifiedPrompts;
    // 展开中的条目必须留在列表里：否则把它改名到不匹配当前关键字时，
    // 卡片会当场从列表消失、输入框被卸载，用户没法把名字改完。
    return unifiedPrompts.filter(
      (p) =>
        openPromptIds.includes(p.id) ||
        p.name.toLowerCase().includes(trimmed) ||
        p.content.toLowerCase().includes(trimmed)
    );
  }, [unifiedPrompts, searchKeyword, openPromptIds]);

  const handleToggle = (item: UnifiedPromptItem, enabled: boolean) => {
    if (item.type === "main") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, useMainPrompt: enabled },
      }));
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, useJailbreak: enabled },
      }));
    } else {
      handleToggleCustomPrompt(item.targetId, enabled);
    }
  };

  const handleUpdate = (
    item: UnifiedPromptItem,
    name: string,
    role: "system" | "user" | "assistant",
    content: string
  ) => {
    if (item.type === "main") {
      if (role !== "system") {
        // 角色不是顶层字段能表达的属性，只能平转为标准自定义模组以持久化。
        // 改名不再走这里：平转会换掉条目标识，导致展开态与焦点在第一次按键时就丢失。
        updateSettings((prev) => {
          const list = prev.promptConfig.customPrompts || [];
          return {
            ...prev,
            promptConfig: {
              ...prev.promptConfig,
              mainPrompt: "",
              useMainPrompt: false,
              customPrompts: [
                ...list,
                {
                  id: "comp_main_" + Math.random().toString(36).substring(2, 7),
                  name: name || mainPromptLabel,
                  role,
                  content,
                  enabled: item.enabled,
                },
              ],
            },
          };
        });
      } else {
        updateSettings((prev) => ({
          ...prev,
          promptConfig: withBuiltinPromptName(
            { ...prev.promptConfig, mainPrompt: content },
            "mainPromptName",
            name,
            mainPromptLabel,
          ),
        }));
      }
    } else if (item.type === "jailbreak") {
      if (role !== "system") {
        // 同上：只有角色调整需要平转，改名在顶层字段上原地保存。
        updateSettings((prev) => {
          const list = prev.promptConfig.customPrompts || [];
          return {
            ...prev,
            promptConfig: {
              ...prev.promptConfig,
              jailbreakPrompt: "",
              useJailbreak: false,
              customPrompts: [
                ...list,
                {
                  id: "comp_jailbreak_" + Math.random().toString(36).substring(2, 7),
                  name: name || jailbreakPromptLabel,
                  role,
                  content,
                  enabled: item.enabled,
                },
              ],
            },
          };
        });
      } else {
        updateSettings((prev) => ({
          ...prev,
          promptConfig: withBuiltinPromptName(
            { ...prev.promptConfig, jailbreakPrompt: content },
            "jailbreakPromptName",
            name,
            jailbreakPromptLabel,
          ),
        }));
      }
    } else {
      handleUpdateCustomPrompt(item.targetId, name, role, content);
    }
  };

  const handleDelete = async (item: UnifiedPromptItem) => {
    // 内置条目与自定义条目同口径：先确认再清空，避免误触直接丢掉整段提示词。
    if (item.type === "main" || item.type === "jailbreak") {
      await handleDeleteBuiltinPrompt(item.type);
    } else {
      await handleDeleteCustomPrompt(item.targetId);
    }
  };

  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs overflow-hidden", isPromptsFolded ? "gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none py-2.5 px-3.5", isPromptsFolded ? "border-b-0" : "border-b border-border/30")}
        onClick={handleTogglePromptsFold}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 shrink-0">
              <Brain className="w-4 h-4" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-xs sm:text-[13px] font-semibold text-foreground shrink-0">
                {t("prompts.title")}
              </span>
              {!isPromptsFolded && (
                <span className="text-[10px] text-muted-foreground/75 font-normal truncate max-w-[150px] sm:max-w-none">
                  {t("prompts.subtitle")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 overflow-hidden">
            {isPromptsFolded && (
              <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[160px] sm:max-w-none">
                {t("prompts.folded_summary", { active: activeCount, inactive: inactiveCount, total: unifiedPrompts.length })}
              </span>
            )}
            {isPromptsFolded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
      </CardHeader>

      {!isPromptsFolded && (
        <CardContent className="pt-3 space-y-3">
          {/* 统一工具栏：状态统计 + 新建与批量操作 + 搜索栏 */}
          <div className="space-y-2">
            <div className="flex justify-between items-center flex-wrap gap-2">
              {/* 统计状态指示 */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-[11px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {t("prompts.active_count", { count: activeCount })}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-[11px] font-mono text-muted-foreground/75">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  {t("prompts.inactive_count", { count: inactiveCount })}
                </span>
                <span className="text-[11px] text-muted-foreground/60 hidden sm:inline-block">
                  {t("prompts.total_count", { count: unifiedPrompts.length })}
                </span>
              </div>

              {/* 右侧操作按钮 */}
              <div className="flex items-center gap-1.5">
                {isBatchDeletingPrompts ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeletePrompts}
                      disabled={selectedPromptIds.length === 0}
                      className="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {t("prompts.confirm_delete")} ({selectedPromptIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingPrompts(false);
                        setSelectedPromptIds([]);
                      }}
                      className="text-xs font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 rounded border border-border flex items-center gap-1 transition tap-scale"
                    >
                      {t("prompts.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {unifiedPrompts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingPrompts(true)}
                        className="text-xs font-bold text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2 py-1 rounded border border-border hover:border-destructive/20 flex items-center gap-1 transition tap-scale"
                      >
                        {t("prompts.batch_delete")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowTemplatesPanel((prev) => !prev)}
                      className={cn(
                        "text-xs font-bold px-2 py-1 rounded border flex items-center gap-1 transition tap-scale",
                        showTemplatesPanel
                          ? "text-amber-400 bg-amber-500/15 border-amber-500/30"
                          : "text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/70 border-border/50"
                      )}
                    >
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>{t("prompts.templates_button")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddNewCustomPrompt}
                      className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                    >
                      <Plus className="w-3 h-3" /> {t("prompts.create_module")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 常用模板折叠面板 */}
            {showTemplatesPanel && (
              <div className="p-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 backdrop-blur-xs space-y-2 animate-in fade-in-50 duration-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1 text-[11.5px]">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    {t("prompts.templates_title")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTemplatesPanel(false)}
                    className="text-[10px] text-muted-foreground hover:text-foreground p-0.5 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {RECOMMENDED_PROMPT_TEMPLATES.map((tpl) => (
                    <div
                      key={tpl.name}
                      className="flex flex-col justify-between p-2 rounded-lg border border-border/60 bg-card/80 hover:border-amber-500/40 transition gap-1.5"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-foreground truncate">{tpl.name}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono bg-amber-500/15 text-amber-400 border border-amber-500/20 shrink-0">
                            {tpl.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/80 line-clamp-1">{tpl.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddTemplate(tpl)}
                        className="text-[10.5px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/20 flex items-center justify-center gap-1 transition active:scale-95 self-end"
                      >
                        <Plus className="w-3 h-3" /> {t("prompts.templates_add")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 实时搜索框 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder={t("prompts.search_placeholder")}
                className="h-8 pl-8 pr-7 text-xs bg-muted/30 border-border/60 focus-visible:ring-1 focus-visible:ring-primary/40 rounded-lg placeholder:text-muted-foreground/50"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-0.5 rounded-full"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 提示词列表状态指示 */}
          <div className="text-[11px] text-muted-foreground/80 flex items-center justify-between px-0.5">
            <span>
              {t("prompts.list_summary", { shown: displayedPrompts.length, total: unifiedPrompts.length })}
            </span>
            {searchKeyword.trim() && (
              <span className="text-[10px] text-primary font-mono">
                {t("prompts.search_match", { keyword: searchKeyword.trim() })}
              </span>
            )}
          </div>

          {/* 列表渲染 */}
          {displayedPrompts.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-xl p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
              <HelpCircle className="w-6 h-6 opacity-50 text-muted-foreground" />
              <div className="space-y-1">
                <span className="text-xs font-semibold text-foreground">
                  {searchKeyword.trim()
                    ? t("prompts.no_match")
                    : t("prompts.no_modules")}
                </span>
                <p className="text-[11px] text-muted-foreground/75">
                  {searchKeyword.trim() ? t("prompts.no_match_hint") : t("prompts.empty_hint")}
                </p>
              </div>

              {!searchKeyword.trim() && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pt-1">
                  {RECOMMENDED_PROMPT_TEMPLATES.slice(0, 2).map((tpl) => (
                    <button
                      key={tpl.name}
                      type="button"
                      onClick={() => handleAddTemplate(tpl)}
                      className="text-left p-2.5 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition active:scale-95 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">{tpl.name}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono bg-primary/10 text-primary border border-primary/20">
                          {tpl.badge}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-muted-foreground/80 line-clamp-2">{tpl.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Accordion
              multiple
              value={openPromptIds}
              onValueChange={(next) => setOpenPromptIds(next as string[])}
              className="space-y-1.5"
            >
              {displayedPrompts.map((p) => {
                const contentLength = p.content.trim().length;
                return (
                  <AccordionItem
                    value={p.id}
                    key={p.id}
                    className="group/accordion-item border border-border/70 rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 [&[data-state=open]]:shadow-xs transition-all duration-150"
                  >
                    <div className="flex items-center justify-between p-2 gap-2 pr-3 bg-muted/15 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isBatchDeletingPrompts && p.type === "custom" && (
                          <Checkbox
                            checked={selectedPromptIds.includes(p.targetId)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedPromptIds((prev) => [...prev, p.targetId]);
                              } else {
                                setSelectedPromptIds((prev) => prev.filter((id) => id !== p.targetId));
                              }
                            }}
                            className="shrink-0"
                          />
                        )}
                        <Switch
                          aria-label={t("prompts.aria_toggle", { name: p.name })}
                          checked={p.enabled}
                          onCheckedChange={(checked) => handleToggle(p, checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="data-[state=checked]:bg-primary !h-4.5 !w-8.5 [&>span]:!w-3.5 [&>span]:!h-3.5 shrink-0"
                        />

                        {/* 角色类型徽章 */}
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase shrink-0 border",
                            p.role === "system"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                              : p.role === "user"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          )}
                        >
                          {p.role}
                        </span>

                        <span
                          className={cn(
                            "text-xs font-semibold transition-all duration-150 truncate flex-1 min-w-0",
                            p.enabled ? "text-foreground" : "text-muted-foreground/70 opacity-80"
                          )}
                          title={p.name}
                        >
                          {p.name}
                        </span>

                        {/* 字数指示 */}
                        <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 hidden sm:inline-block">
                          {contentLength > 0 ? t("prompts.char_count", { count: contentLength }) : t("prompts.char_empty")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={t("prompts.aria_delete", { name: p.name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(p);
                          }}
                          className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground/70 rounded transition"
                          title={t("prompts.delete_tooltip")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <AccordionTrigger
                          aria-label={t("prompts.aria_expand", { name: p.name })}
                          className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground"
                        />
                      </div>
                    </div>

                    <AccordionContent className="p-3 pt-0 border-t border-border/40 bg-background/50 outline-none">
                      <div className="pt-2.5 space-y-2.5">
                        {/* 顶部：标题输入框 + 角色选择 */}
                        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                          <Input
                            value={p.name}
                            onChange={(e) => handleUpdate(p, e.target.value, p.role, p.content)}
                            className="h-7.5 text-xs bg-input/50 focus-visible:ring-1 flex-1 min-w-[160px]"
                            placeholder={t("prompts.name_placeholder")}
                          />

                          <div className="flex rounded-md bg-muted/60 p-0.5 border border-border/50 text-[10px] font-bold shrink-0">
                            {(["system", "user", "assistant"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => handleUpdate(p, p.name, r, p.content)}
                                className={cn(
                                  "px-2 py-0.5 rounded transition-all uppercase",
                                  p.role === r
                                    ? "bg-background text-foreground shadow-xs font-black"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 中部：内容输入多行文本框 */}
                        <Textarea
                          value={p.content}
                          onChange={(e) => handleUpdate(p, p.name, p.role, e.target.value)}
                          className="min-h-[140px] text-xs font-mono sm:text-xs leading-relaxed resize-y bg-input/40 focus-visible:ring-primary/40 text-foreground shadow-inner custom-scrollbar"
                          placeholder={t("prompts.content_placeholder")}
                        />

                        {/* 底部信息辅助 */}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 px-0.5 font-mono">
                          <span>
                            {p.type === "main"
                              ? t("prompts.type_main")
                              : p.type === "jailbreak"
                                ? t("prompts.type_jailbreak")
                                : t("prompts.type_custom")}
                          </span>
                          <span>{t("prompts.char_count_full", { count: contentLength })}</span>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      )}
    </Card>
  );
}
