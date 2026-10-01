import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronUp, HelpCircle, Plus, Search, Trash2, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
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
import type { UserSettings } from "../../types";

interface PromptsConfigSectionProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  handleToggleCustomPrompt: (id: string, enabled: boolean) => void;
  handleUpdateCustomPrompt: (id: string, name: string, role: "system" | "user" | "assistant", content: string) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
  isPromptsFolded: boolean;
  handleTogglePromptsFold: () => void;
  coreStatusText?: string;
  activeCustomPrompts?: number;
  selectedPromptIds: string[];
  setSelectedPromptIds: (value: string[] | ((prev: string[]) => string[])) => void;
  isBatchDeletingPrompts: boolean;
  setIsBatchDeletingPrompts: (value: boolean | ((prev: boolean) => boolean)) => void;
  handleBatchDeletePrompts: () => Promise<void>;
  onOpenComposer?: () => void;
}

interface UnifiedPromptItem {
  id: string;
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  enabled: boolean;
  type: "main" | "jailbreak" | "custom";
}

type FilterTab = "active" | "inactive" | "all";

/**
 * 预设提示词配置：
 * - 过滤纯系统插槽锚点（marker === true），不再无脑平铺空卡片；
 * - 区分「生效中」与「备选模组库」，避免 140+ 项大平铺造成视觉过载；
 * - 支持关键字实时搜索过滤；
 * - 支持角色选择（System / User / Assistant）与紧凑卡片渲染；
 * - 彻底取消“工作流画布”等假入口，专注纯粹高效的预设管理。
 */
export default function PromptsConfigSection({
  settings,
  updateSettings,
  handleToggleCustomPrompt,
  handleUpdateCustomPrompt,
  handleAddNewCustomPrompt,
  handleDeleteCustomPrompt,
  isPromptsFolded,
  handleTogglePromptsFold,
  selectedPromptIds,
  setSelectedPromptIds,
  isBatchDeletingPrompts,
  setIsBatchDeletingPrompts,
  handleBatchDeletePrompts,
}: PromptsConfigSectionProps) {
  const { t } = useTranslation();
  const [filterTab, setFilterTab] = useState<FilterTab>("active");
  const [searchKeyword, setSearchKeyword] = useState("");

  // 将内置提示词与自定义提示词收拢为统一列表（过滤纯系统插槽锚点）
  const unifiedPrompts = useMemo<UnifiedPromptItem[]>(() => {
    const list: UnifiedPromptItem[] = [];

    // 1. 系统扮演指令（仅在明确启用或存在非空内容且未显式关闭时展示）
    const hasMainPromptContent = Boolean(settings.promptConfig.mainPrompt && settings.promptConfig.mainPrompt.trim().length > 0);
    const shouldShowMainPrompt = settings.promptConfig.useMainPrompt === true
      || (settings.promptConfig.useMainPrompt !== false && hasMainPromptContent);
    if (shouldShowMainPrompt) {
      list.push({
        id: "built-in-main-prompt",
        name: t("prompts.system_prompt") || "底层扮演系统指令",
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
      list.push({
        id: "built-in-jailbreak-prompt",
        name: t("prompts.jailbreak") || "规则提示词",
        role: "system",
        content: settings.promptConfig.jailbreakPrompt || "",
        enabled: settings.promptConfig.useJailbreak ?? hasJailbreakContent,
        type: "jailbreak",
      });
    }

    // 3. 所有用户自定义提示词（过滤系统锚点占位符 marker === true）
    const customs = settings.promptConfig.customPrompts || [];
    for (const c of customs) {
      if (c.marker) {
        // 系统占位符锚点（如 chatHistory、charDescription、worldInfo 等），不在提示词输入列表中平铺
        continue;
      }
      list.push({
        id: c.id,
        name: c.name,
        role: c.role || "system",
        content: c.content || "",
        enabled: c.enabled,
        type: "custom",
      });
    }

    return list;
  }, [settings.promptConfig, t]);

  const activeCount = useMemo(() => unifiedPrompts.filter((p) => p.enabled).length, [unifiedPrompts]);
  const inactiveCount = unifiedPrompts.length - activeCount;

  // 根据当前 FilterTab 与搜索关键字筛选显示列表
  const displayedPrompts = useMemo(() => {
    let result = unifiedPrompts;

    // 1. 状态筛选
    if (filterTab === "active") {
      result = result.filter((p) => p.enabled);
    } else if (filterTab === "inactive") {
      result = result.filter((p) => !p.enabled);
    }

    // 2. 关键字搜索（名称或内容）
    const trimmed = searchKeyword.trim().toLowerCase();
    if (trimmed) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(trimmed) ||
          p.content.toLowerCase().includes(trimmed)
      );
    }

    return result;
  }, [unifiedPrompts, filterTab, searchKeyword]);

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
      handleToggleCustomPrompt(item.id, enabled);
    }
  };

  const handleUpdate = (
    item: UnifiedPromptItem,
    name: string,
    role: "system" | "user" | "assistant",
    content: string
  ) => {
    if (item.type === "main") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, mainPrompt: content },
      }));
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, jailbreakPrompt: content },
      }));
    } else {
      handleUpdateCustomPrompt(item.id, name, role, content);
    }
  };

  const handleDelete = async (item: UnifiedPromptItem) => {
    if (item.type === "main") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, useMainPrompt: false, mainPrompt: "" },
      }));
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: { ...prev.promptConfig, useJailbreak: false, jailbreakPrompt: "" },
      }));
    } else {
      await handleDeleteCustomPrompt(item.id);
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
                生效: {activeCount} / 备选: {inactiveCount} / 共 {unifiedPrompts.length} 项
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
          {/* 统一工具栏：分类分段胶囊 + 搜索栏 + 新建与批量操作 */}
          <div className="space-y-2">
            <div className="flex justify-between items-center flex-wrap gap-2">
              {/* 分段筛选胶囊 */}
              <div className="flex rounded-lg bg-muted/50 p-0.5 border border-border/40 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setFilterTab("active")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all text-xs",
                    filterTab === "active"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  生效中 ({activeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("inactive")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all text-xs",
                    filterTab === "inactive"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  备选库 ({inactiveCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("all")}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all text-xs",
                    filterTab === "all"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  全部 ({unifiedPrompts.length})
                </button>
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
                      onClick={handleAddNewCustomPrompt}
                      className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                    >
                      <Plus className="w-3 h-3" /> {t("prompts.create_module")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 实时搜索框 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索提示词名称或内容..."
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
              提示词列表（显示 {displayedPrompts.length} / 共 {unifiedPrompts.length} 项）
            </span>
            {searchKeyword.trim() && (
              <span className="text-[10px] text-primary font-mono">
                匹配“{searchKeyword.trim()}”
              </span>
            )}
          </div>

          {/* 列表渲染 */}
          {displayedPrompts.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
              <HelpCircle className="w-6 h-6 opacity-50" />
              <span className="text-xs font-semibold">
                {searchKeyword.trim()
                  ? "未找到匹配的提示词模组"
                  : filterTab === "inactive"
                    ? "备选库暂无未启用的模组"
                    : t("prompts.no_modules")}
              </span>
            </div>
          ) : (
            <Accordion multiple className="space-y-1.5">
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
                        {isBatchDeletingPrompts && (
                          <Checkbox
                            checked={selectedPromptIds.includes(p.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedPromptIds((prev) => [...prev, p.id]);
                              } else {
                                setSelectedPromptIds((prev) => prev.filter((id) => id !== p.id));
                              }
                            }}
                            className="shrink-0"
                          />
                        )}
                        <Switch
                          aria-label={`启用提示词 ${p.name}`}
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
                          {contentLength > 0 ? `${contentLength}字` : "空"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`删除提示词 ${p.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(p);
                          }}
                          className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground/70 rounded transition"
                          title="删除提示词"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <AccordionTrigger
                          aria-label={`展开或折叠 ${p.name} 详情`}
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
                            placeholder="提示词名称"
                          />

                          {p.type === "custom" && (
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
                          )}
                        </div>

                        {/* 中部：内容输入多行文本框 */}
                        <Textarea
                          value={p.content}
                          onChange={(e) => handleUpdate(p, p.name, p.role, e.target.value)}
                          className="min-h-[140px] text-xs font-mono sm:text-xs leading-relaxed resize-y bg-input/40 focus-visible:ring-primary/40 text-foreground shadow-inner custom-scrollbar"
                          placeholder="在此输入提示词文本内容..."
                        />

                        {/* 底部信息辅助 */}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 px-0.5 font-mono">
                          <span>
                            {p.type === "main"
                              ? "⚠️ 底层核心系统指令（全局基石）"
                              : p.type === "jailbreak"
                                ? "⚠️ 规则/越狱指令（优先覆盖）"
                                : "自定义模组"}
                          </span>
                          <span>{contentLength} 字符</span>
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
