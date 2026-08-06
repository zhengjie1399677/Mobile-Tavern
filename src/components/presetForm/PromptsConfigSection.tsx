import { useRef, useState } from "react";
import { Brain, ChevronDown, ChevronUp, AlertCircle, HelpCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import CorePromptBlocks from "./CorePromptBlocks";
import PromptBlockEditorDialog from "./PromptBlockEditorDialog";
import {
  estimatePromptBlockTokens,
  patchSelectedBlockStates,
  removePromptBlocks,
} from "./promptBlockListTools";
import type { PromptBlock, PromptComposition } from "../../domain/prompt-composition";
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
  /**
   * 跳转到「自由 Prompt 编排」分类（SettingsTab 提供）。
   * 预设界面只保留区块开关与基础内容编辑，条件 / Token 策略等高级编辑
   * 统一在编排页进行；未提供时隐藏跳转按钮。
   */
  onOpenComposer?: () => void;
}

/**
 * 自由编排模式下的预设提示词控制：直接列出当前编排的 Prompt 区块开关。
 * 规划属于预设，区块启用/停用即"子预设节点"开关；顺序、位置与内容的高级编辑
 * 仍在独立的「自由 Prompt 编排」分类中。
 */
function CompositionBlockToggleList({
  composition,
  updateSettings,
  onOpenComposer,
}: {
  composition: PromptComposition;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  onOpenComposer?: () => void;
}) {
  const { t } = useTranslation();
  const [editingBlockId, setEditingBlockId] = useState<string>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string>();
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocks = composition.blocks;
  const enabledCount = blocks.filter((block) => block.enabled).length;
  const totalTokens = blocks.reduce(
    (sum, block) => sum + estimatePromptBlockTokens(block),
    0,
  );
  const editingBlock = blocks.find((block) => block.id === editingBlockId);
  const historyBlocks = blocks.filter((block) => block.source.type === "chat_history");

  const handleToggleBlock = (blockId: string, enabled: boolean) => {
    updateSettings((prev) => {
      const current = prev.promptConfig.composition;
      if (!current) return prev;
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          composition: patchSelectedBlockStates(current, new Set([blockId]), enabled),
        },
      };
    });
  };

  const handlePatchBlock = (blockId: string, patch: Partial<PromptBlock>) => {
    updateSettings((prev) => {
      const current = prev.promptConfig.composition;
      if (!current) return prev;
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          composition: {
            ...current,
            blocks: current.blocks.map((block) =>
              block.id === blockId ? { ...block, ...patch } : block,
            ),
          },
        },
      };
    });
  };

  const handleDeleteBlock = (blockId: string) => {
    updateSettings((prev) => {
      const current = prev.promptConfig.composition;
      if (!current) return prev;
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          composition: removePromptBlocks(current, new Set([blockId])),
        },
      };
    });
    if (editingBlockId === blockId) setEditingBlockId(undefined);
    setConfirmingDeleteId(undefined);
  };

  const handleDeleteClick = (blockId: string) => {
    if (confirmingDeleteId === blockId) {
      handleDeleteBlock(blockId);
      return;
    }
    setConfirmingDeleteId(blockId);
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    deleteConfirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(undefined), 2500);
  };

  const handleDuplicateBlock = (blockId: string) => {
    updateSettings((prev) => {
      const current = prev.promptConfig.composition;
      if (!current) return prev;
      const sourceIndex = current.blocks.findIndex((block) => block.id === blockId);
      if (sourceIndex < 0) return prev;
      const source = current.blocks[sourceIndex];
      const duplicate: PromptBlock = {
        ...structuredClone(source),
        id: `prompt_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${source.name} ${t("prompt_composer.copy_suffix")}`,
      };
      const blocks = [...current.blocks];
      blocks.splice(sourceIndex + 1, 0, duplicate);
      return {
        ...prev,
        promptConfig: { ...prev.promptConfig, composition: { ...current, blocks } },
      };
    });
  };

  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-mono text-muted-foreground">
        {t("prompt_composer.list_stats", {
          visible: enabledCount,
          total: blocks.length,
          tokens: totalTokens,
        })}
      </span>
      {blocks.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t("prompt_composer.empty_valid")}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto pr-1 divide-y divide-border/40">
          {blocks.map((block) => (
            <div
              key={block.id}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Switch
                  aria-label={`${t("prompt_composer.block_enabled")} ${block.name}`}
                  checked={block.enabled}
                  onCheckedChange={(checked) => handleToggleBlock(block.id, checked)}
                  className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4 shrink-0"
                />
                <span
                  className={cn(
                    "text-[11px] truncate",
                    block.enabled ? "text-foreground" : "text-muted-foreground/70"
                  )}
                >
                  {block.name}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label={`${t("prompt_composer.edit_block_title")} ${block.name}`}
                  onClick={() => setEditingBlockId(block.id)}
                  className="p-1 text-muted-foreground hover:text-foreground transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`${t("prompt_composer.delete_block")} ${block.name}`}
                  onClick={() => handleDeleteClick(block.id)}
                  className={`p-1 transition ${
                    confirmingDeleteId === block.id
                      ? "text-rose-500"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {confirmingDeleteId === block.id ? (
                    <span className="text-[10px] font-bold px-0.5 whitespace-nowrap">
                      {t("prompts.confirm_delete")}
                    </span>
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PromptBlockEditorDialog
        block={editingBlock}
        historyBlocks={historyBlocks}
        onClose={() => setEditingBlockId(undefined)}
        onPatch={(patch) => editingBlock && handlePatchBlock(editingBlock.id, patch)}
        onDelete={() => editingBlock && handleDeleteBlock(editingBlock.id)}
        onDuplicate={() => editingBlock && handleDuplicateBlock(editingBlock.id)}
        allowAdvancedFields={false}
      />
      {onOpenComposer && (
        <button
          type="button"
          onClick={onOpenComposer}
          className="mt-2 w-full rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] font-bold text-primary transition hover:bg-primary/10 active:scale-[0.99]"
        >
          {t("prompt_composer.open_composer")}
        </button>
      )}
    </div>
  );
}

/** 3. 预设提示词配置容器（编排 CorePromptBlocks 与自定义提示词模组） */
export default function PromptsConfigSection({
  settings,
  updateSettings,
  handleToggleCustomPrompt,
  handleUpdateCustomPrompt,
  handleAddNewCustomPrompt,
  handleDeleteCustomPrompt,
  isPromptsFolded,
  handleTogglePromptsFold,
  coreStatusText,
  activeCustomPrompts,
  selectedPromptIds,
  setSelectedPromptIds,
  isBatchDeletingPrompts,
  setIsBatchDeletingPrompts,
  handleBatchDeletePrompts,
  onOpenComposer,
}: PromptsConfigSectionProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300", isPromptsFolded ? "py-2 gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isPromptsFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
        onClick={handleTogglePromptsFold}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 shrink-0">
            <Brain className="w-4 h-4 text-primary" /> {t("prompts.title")}
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
            {t("prompts.subtitle")}
          </CardDescription>
        )}
      </CardHeader>
      {!isPromptsFolded && (
        <CardContent className="pt-4 space-y-4">
        <div className="bg-muted/50 p-3 rounded-lg border border-border/50 text-[11px] text-muted-foreground flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {t("prompts.st_compat_desc")}
          </p>
        </div>

        {settings.promptConfig.usePromptComposition &&
          (settings.promptConfig.composition ? (
            <CompositionBlockToggleList
              composition={settings.promptConfig.composition}
              updateSettings={updateSettings}
              onOpenComposer={onOpenComposer}
            />
          ) : (
            <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-[11px] leading-relaxed text-primary">
              {t("prompt_composer.independent_notice")}
            </div>
          ))}

        {!settings.promptConfig.usePromptComposition && (
        <>
        {/* 旧编排迁移期回退；启用自由编排后完全退出运行路径。 */}
        <span className="block text-xs font-bold font-mono text-foreground">CORE PROMPTS</span>
        <CorePromptBlocks settings={settings} updateSettings={updateSettings} />

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
                {settings.promptConfig.customPrompts && settings.promptConfig.customPrompts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsBatchDeletingPrompts(true)}
                    className="text-xs font-bold text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2 py-1 rounded border border-border hover:border-destructive/20 flex items-center gap-1 transition tap-scale"
                  >
                    {t("prompts.batch_delete")}
                  </button>
                )}
                <button
                  onClick={handleAddNewCustomPrompt}
                  className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                >
                  <Plus className="w-3 h-3" /> {t("prompts.create_module")}
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
              {t("prompts.no_modules")}
            </span>
          </div>
        ) : (
          <Accordion multiple className="space-y-2">
            {settings.promptConfig.customPrompts.map((p) => (
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
                      aria-label={`启用提示词模组 ${p.name}`}
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
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      aria-label={`删除提示词模组 ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustomPrompt(p.id);
                      }}
                      className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground rounded transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <AccordionTrigger
                      aria-label={`展开或折叠模组 ${p.name} 详情`}
                      className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground"
                    />
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
        </>
        )}
      </CardContent>
      )}
    </Card>
  );
}
