import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronUp, HelpCircle, Plus, Trash2 } from "lucide-react";
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
  handleUpdateCustomPrompt: (id: string, name: string, role: any, content: string) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
  isPromptsFolded: boolean;
  handleTogglePromptsFold: () => void;
  coreStatusText: string;
  activeCustomPrompts: number;
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
  content: string;
  enabled: boolean;
  type: "main" | "jailbreak" | "custom";
}

/**
 * 预设提示词配置：
 * 所有预设一视同仁，统一合并在同一个列表内，全部可编辑、可删除、可新建与独立开关。
 * 不做官方/自定义区分，不负责任何编排或记忆。
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

  // 将内置提示词与自定义提示词收拢为完全对等的统一列表
  const unifiedPrompts = useMemo<UnifiedPromptItem[]>(() => {
    const list: UnifiedPromptItem[] = [];
    const isComp = settings.promptConfig.usePromptComposition && !!settings.promptConfig.composition?.blocks;
    const blocks = settings.promptConfig.composition?.blocks || [];

    const findBlock = (predicate: (b: (typeof blocks)[number]) => boolean) =>
      isComp ? blocks.find(predicate) : undefined;

    // 1. 系统扮演指令（若存在内容或明确启用）
    if (settings.promptConfig.useMainPrompt !== false || (settings.promptConfig.mainPrompt && settings.promptConfig.mainPrompt.trim().length > 0)) {
      const mainBlock = findBlock((b) => b.compatibility?.originalIdentifier === "main" || b.id === "built-in-main-prompt" || b.id === "example_main");
      list.push({
        id: "built-in-main-prompt",
        name: t("prompts.system_prompt") || "底层扮演系统指令",
        content: settings.promptConfig.mainPrompt || "",
        enabled: mainBlock ? mainBlock.enabled : (settings.promptConfig.useMainPrompt ?? true),
        type: "main",
      });
    }

    // 2. 规则提示词（若存在内容或明确启用）
    if (settings.promptConfig.useJailbreak !== false || (settings.promptConfig.jailbreakPrompt && settings.promptConfig.jailbreakPrompt.trim().length > 0)) {
      const jbBlock = findBlock((b) => b.compatibility?.originalIdentifier === "jailbreak" || b.id === "built-in-jailbreak-prompt");
      list.push({
        id: "built-in-jailbreak-prompt",
        name: t("prompts.jailbreak") || "规则提示词",
        content: settings.promptConfig.jailbreakPrompt || "",
        enabled: jbBlock ? jbBlock.enabled : (settings.promptConfig.useJailbreak ?? true),
        type: "jailbreak",
      });
    }

    // 3. 所有用户提示词
    const customs = settings.promptConfig.customPrompts || [];
    for (const c of customs) {
      const customBlock = findBlock((b) => b.id === c.id || Boolean(b.compatibility?.originalIdentifier && (b.compatibility.originalIdentifier === c.id || b.compatibility.originalIdentifier === c.identifier)));
      list.push({
        id: c.id,
        name: c.name,
        content: c.content,
        enabled: customBlock ? customBlock.enabled : c.enabled,
        type: "custom",
      });
    }

    return list;
  }, [settings.promptConfig, t]);

  const activeCount = unifiedPrompts.filter((p) => p.enabled).length;

  const handleToggle = (item: UnifiedPromptItem, enabled: boolean) => {
    if (item.type === "main") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          useMainPrompt: enabled,
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "main" || b.id === "built-in-main-prompt" || b.id === "example_main"
                ? { ...b, enabled }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          useJailbreak: enabled,
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "jailbreak" || b.id === "built-in-jailbreak-prompt"
                ? { ...b, enabled }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else {
      handleToggleCustomPrompt(item.id, enabled);
    }
  };

  const handleUpdate = (item: UnifiedPromptItem, name: string, content: string) => {
    if (item.type === "main") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          mainPrompt: content,
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "main" || b.id === "built-in-main-prompt" || b.id === "example_main"
                ? { ...b, template: content }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          jailbreakPrompt: content,
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "jailbreak" || b.id === "built-in-jailbreak-prompt"
                ? { ...b, template: content }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else {
      handleUpdateCustomPrompt(item.id, name, "system", content);
    }
  };

  const handleDelete = async (item: UnifiedPromptItem) => {
    if (item.type === "main") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          useMainPrompt: false,
          mainPrompt: "",
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "main" || b.id === "built-in-main-prompt" || b.id === "example_main"
                ? { ...b, enabled: false, template: "" }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else if (item.type === "jailbreak") {
      updateSettings((prev) => {
        const nextConfig = {
          ...prev.promptConfig,
          useJailbreak: false,
          jailbreakPrompt: "",
        };
        if (prev.promptConfig.composition?.blocks) {
          nextConfig.composition = {
            ...prev.promptConfig.composition,
            blocks: prev.promptConfig.composition.blocks.map((b) =>
              b.compatibility?.originalIdentifier === "jailbreak" || b.id === "built-in-jailbreak-prompt"
                ? { ...b, enabled: false, template: "" }
                : b
            ),
          };
        }
        return { ...prev, promptConfig: nextConfig };
      });
    } else {
      await handleDeleteCustomPrompt(item.id);
    }
  };

  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300", isPromptsFolded ? "py-2 gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isPromptsFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
        onClick={handleTogglePromptsFold}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 shrink-0 text-foreground">
            <Brain className="w-4 h-4 text-primary" /> {t("prompts.title")}
          </CardTitle>
          <div className="flex items-center gap-2 overflow-hidden">
            {isPromptsFolded && (
              <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                启用: {activeCount} / 共 {unifiedPrompts.length} 项
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
          <CardDescription className="text-[10px] text-muted-foreground font-normal mt-0.5">
            {t("prompts.subtitle")}
          </CardDescription>
        )}
      </CardHeader>

      {!isPromptsFolded && (
        <CardContent className="pt-3 space-y-3">
          {/* 统一工具栏 */}
          <div className="flex justify-between items-center flex-wrap gap-2">
            <span className="text-xs font-bold text-muted-foreground">
              提示词列表（{unifiedPrompts.length}）
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
                    className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                  >
                    <Plus className="w-3 h-3" /> {t("prompts.create_module")}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 统一单一列表 */}
          {unifiedPrompts.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
              <HelpCircle className="w-6 h-6 opacity-50" />
              <span className="text-xs font-semibold">
                {t("prompts.no_modules")}
              </span>
            </div>
          ) : (
            <Accordion multiple className="space-y-2">
              {unifiedPrompts.map((p) => (
                <AccordionItem
                  value={p.id}
                  key={p.id}
                  className="group/accordion-item border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 [&[data-state=open]]:shadow-sm [&[data-state=open]]:ring-1 [&[data-state=open]]:ring-primary/10 transition-all duration-200"
                >
                  <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                    <div className="flex items-center gap-2 flex-1">
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
                        className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                      />
                      <span
                        className={cn(
                          "text-xs font-bold transition-all duration-200 block",
                          p.enabled ? "text-foreground" : "text-muted-foreground opacity-70",
                          "truncate max-w-[200px]",
                          "group-data-[state=open]/accordion-item:max-w-none group-data-[state=open]/accordion-item:whitespace-normal group-data-[state=open]/accordion-item:overflow-visible"
                        )}
                      >
                        {p.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`删除提示词 ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(p);
                        }}
                        className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground rounded transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <AccordionTrigger
                        aria-label={`展开或折叠 ${p.name} 详情`}
                        className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground"
                      />
                    </div>
                  </div>
                  <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                    <div className="pt-3 space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={p.name}
                          onChange={(e) => handleUpdate(p, e.target.value, p.content)}
                          className="h-8 text-xs bg-input/50 focus-visible:ring-1"
                          placeholder="提示词名称"
                        />
                      </div>
                      <Textarea
                        value={p.content}
                        onChange={(e) => handleUpdate(p, p.name, e.target.value)}
                        className="min-h-[200px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
                        placeholder="在此输入提示词文本内容..."
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
  );
}
