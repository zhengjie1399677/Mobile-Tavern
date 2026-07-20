import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { PromptBlock, PromptMessageRole } from "../../domain/prompt-composition";
import { createBasicPromptComposition } from "../../domain/prompt-composition";
import type { UserSettings } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import { Switch } from "../../../components/ui/switch";

interface PromptCompositionEditorProps {
  settings: UserSettings;
  updateSettings: (updater: UserSettings | ((previous: UserSettings) => UserSettings)) => void;
}

const AVAILABLE_MACROS = [
  "character.description",
  "character.personality",
  "character.scenario",
  "character.systemPrompt",
  "character.examples",
  "persona.description",
  "worldbook.triggered",
  "worldbook.before",
  "worldbook.after",
  "memory.summaries",
  "memory.recalled",
  "memory.tables",
  "prompt.main",
  "prompt.jailbreak",
  "prompt.postHistory",
  "input.current",
];

export default function PromptCompositionEditor({
  settings,
  updateSettings,
}: PromptCompositionEditorProps) {
  const { t } = useTranslation();
  const composition = settings.promptConfig.composition ?? createBasicPromptComposition();
  const historyBlocks = composition.blocks.filter((block) => block.source.type === "chat_history");

  const updateComposition = (next: typeof composition) => {
    updateSettings((previous) => ({
      ...previous,
      promptConfig: { ...previous.promptConfig, composition: next },
    }));
  };

  const updateBlock = (id: string, patch: Partial<PromptBlock>) => {
    updateComposition({
      ...composition,
      blocks: composition.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    });
  };

  const addBlock = (sourceType: "template" | "chat_history") => {
    const order = composition.blocks.length === 0
      ? 100
      : Math.max(...composition.blocks.map((block) => block.order)) + 100;
    const block: PromptBlock = {
      id: `prompt_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: sourceType === "chat_history"
        ? t("prompt_composer.history_block")
        : t("prompt_composer.new_block"),
      enabled: true,
      role: "system",
      source: sourceType === "chat_history"
        ? { type: "chat_history", selection: { mode: "all" } }
        : { type: "template" },
      template: "",
      order,
      placement: { type: "ordered" },
    };
    updateComposition({ ...composition, blocks: [...composition.blocks, block] });
  };

  const moveBlock = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= composition.blocks.length) return;
    const blocks = [...composition.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateComposition({
      ...composition,
      blocks: blocks.map((block, blockIndex) => ({ ...block, order: (blockIndex + 1) * 100 })),
    });
  };

  const deleteBlock = (id: string) => {
    if (!window.confirm(t("prompt_composer.confirm_delete"))) return;
    updateComposition({ ...composition, blocks: composition.blocks.filter((block) => block.id !== id) });
  };

  const resetExample = () => {
    if (!window.confirm(t("prompt_composer.confirm_reset"))) return;
    updateComposition(createBasicPromptComposition());
  };

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold">{t("prompt_composer.title")}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {t("prompt_composer.description")}
          </p>
        </div>
        <Switch
          aria-label={t("prompt_composer.enable")}
          checked={settings.promptConfig.usePromptComposition === true}
          onCheckedChange={(checked) => updateSettings((previous) => ({
            ...previous,
            promptConfig: {
              ...previous.promptConfig,
              usePromptComposition: checked,
              composition: previous.promptConfig.composition ?? createBasicPromptComposition(),
            },
          }))}
        />
      </div>

      {settings.promptConfig.usePromptComposition && (
        <>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
            {t("prompt_composer.no_hidden_prompt")}
          </div>

          <input
            value={composition.name}
            onChange={(event) => updateComposition({ ...composition, name: event.target.value })}
            aria-label={t("prompt_composer.composition_name")}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
          />

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => addBlock("template")}
              className="flex items-center justify-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2 py-2 text-[10px] font-bold text-primary"
            >
              <Plus className="h-3 w-3" /> {t("prompt_composer.add_message")}
            </button>
            <button
              type="button"
              onClick={() => addBlock("chat_history")}
              className="flex items-center justify-center gap-1 rounded-lg border border-border bg-muted px-2 py-2 text-[10px] font-bold"
            >
              <Plus className="h-3 w-3" /> {t("prompt_composer.add_history")}
            </button>
            <button
              type="button"
              onClick={resetExample}
              className="flex items-center justify-center gap-1 rounded-lg border border-border bg-muted px-2 py-2 text-[10px] font-bold"
            >
              <RotateCcw className="h-3 w-3" /> {t("prompt_composer.reset_example")}
            </button>
          </div>

          {composition.blocks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              {t("prompt_composer.empty_valid")}
            </div>
          ) : (
            <div className="space-y-2">
              {composition.blocks.map((block, index) => (
                <details key={block.id} className="rounded-lg border border-border bg-background/80">
                  <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5">
                    <input
                      type="checkbox"
                      checked={block.enabled}
                      onChange={(event) => updateBlock(block.id, { enabled: event.target.checked })}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={t("prompt_composer.block_enabled")}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{block.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {block.source.type === "chat_history" ? t("prompt_composer.history") : block.role}
                    </span>
                    <button type="button" disabled={index === 0} onClick={(event) => { event.preventDefault(); moveBlock(index, -1); }} className="p-1 disabled:opacity-25" aria-label={t("prompt_composer.move_up")}>
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button type="button" disabled={index === composition.blocks.length - 1} onClick={(event) => { event.preventDefault(); moveBlock(index, 1); }} className="p-1 disabled:opacity-25" aria-label={t("prompt_composer.move_down")}>
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={(event) => { event.preventDefault(); deleteBlock(block.id); }} className="p-1 text-destructive" aria-label={t("prompt_composer.delete_block")}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </summary>

                  <div className="space-y-2 border-t border-border p-2.5">
                    <input
                      value={block.name}
                      onChange={(event) => updateBlock(block.id, { name: event.target.value })}
                      aria-label={t("prompt_composer.block_name")}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={block.source.type}
                        onChange={(event) => updateBlock(block.id, {
                          source: event.target.value === "chat_history"
                            ? { type: "chat_history", selection: { mode: "all" } }
                            : { type: "template" },
                          placement: event.target.value === "chat_history" ? { type: "ordered" } : block.placement,
                        })}
                        aria-label={t("prompt_composer.source")}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      >
                        <option value="template">{t("prompt_composer.template_source")}</option>
                        <option value="chat_history">{t("prompt_composer.history_source")}</option>
                      </select>
                      <select
                        value={block.role}
                        disabled={block.source.type === "chat_history"}
                        onChange={(event) => updateBlock(block.id, { role: event.target.value as PromptMessageRole })}
                        aria-label={t("prompt_composer.role")}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-40"
                      >
                        <option value="system">system</option>
                        <option value="user">user</option>
                        <option value="assistant">assistant</option>
                      </select>
                    </div>
                    {block.source.type === "chat_history" && (
                      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
                        <select
                          value={block.source.selection?.mode ?? "all"}
                          onChange={(event) => updateBlock(block.id, {
                            source: event.target.value === "recent"
                              ? { type: "chat_history", selection: { mode: "recent", count: 6, preserveFirstAssistant: false } }
                              : { type: "chat_history", selection: { mode: "all" } },
                          })}
                          aria-label={t("prompt_composer.history_selection")}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          <option value="all">{t("prompt_composer.all_messages")}</option>
                          <option value="recent">{t("prompt_composer.recent_messages")}</option>
                        </select>
                        {block.source.selection?.mode === "recent" && (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min={0}
                              value={block.source.selection.count}
                              onChange={(event) => updateBlock(block.id, {
                                source: {
                                  type: "chat_history",
                                  selection: {
                                    mode: "recent",
                                    count: Math.max(0, Number(event.target.value) || 0),
                                    preserveFirstAssistant: block.source.type === "chat_history" && block.source.selection?.mode === "recent"
                                      ? block.source.selection.preserveFirstAssistant
                                      : false,
                                  },
                                },
                              })}
                              aria-label={t("prompt_composer.message_count")}
                              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                            />
                            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={block.source.selection.preserveFirstAssistant}
                                onChange={(event) => updateBlock(block.id, {
                                  source: {
                                  type: "chat_history",
                                  selection: {
                                    mode: "recent",
                                    count: block.source.type === "chat_history" && block.source.selection?.mode === "recent"
                                      ? block.source.selection.count
                                      : 0,
                                    preserveFirstAssistant: event.target.checked,
                                    },
                                  },
                                })}
                              />
                              {t("prompt_composer.preserve_greeting")}
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                    {block.source.type === "template" && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={block.placement.type}
                            onChange={(event) => updateBlock(block.id, {
                              placement: event.target.value === "in_chat"
                                ? { type: "in_chat", depth: 0, order: block.order }
                                : { type: "ordered" },
                            })}
                            aria-label={t("prompt_composer.placement")}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                          >
                            <option value="ordered">{t("prompt_composer.ordered")}</option>
                            <option value="in_chat">{t("prompt_composer.in_chat")}</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            disabled={block.placement.type !== "in_chat"}
                            value={block.placement.type === "in_chat" ? block.placement.depth : 0}
                            onChange={(event) => updateBlock(block.id, {
                              placement: { type: "in_chat", depth: Math.max(0, Number(event.target.value) || 0), order: block.order },
                            })}
                            aria-label={t("prompt_composer.depth")}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-40"
                          />
                        </div>
                        {block.placement.type === "in_chat" && historyBlocks.length > 1 && (
                          <select
                            value={block.placement.historyBlockId ?? ""}
                            onChange={(event) => updateBlock(block.id, {
                              placement: {
                                type: "in_chat",
                                depth: block.placement.type === "in_chat" ? block.placement.depth : 0,
                                order: block.placement.type === "in_chat" ? block.placement.order : block.order,
                                historyBlockId: event.target.value || undefined,
                              },
                            })}
                            aria-label={t("prompt_composer.target_history")}
                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                          >
                            <option value="">{t("prompt_composer.all_history_blocks")}</option>
                            {historyBlocks.map((historyBlock) => (
                              <option key={historyBlock.id} value={historyBlock.id}>{historyBlock.name}</option>
                            ))}
                          </select>
                        )}
                        <textarea
                          value={block.template}
                          onChange={(event) => updateBlock(block.id, { template: event.target.value })}
                          aria-label={t("prompt_composer.template")}
                          className="min-h-[130px] w-full resize-y rounded-md border border-border bg-background px-2 py-2 font-mono text-xs"
                        />
                      </>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}

          <details className="rounded-lg border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer font-semibold">{t("prompt_composer.available_sources")}</summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {AVAILABLE_MACROS.map((macro) => (
                <code key={macro} className="rounded border border-border bg-background px-1 py-0.5">{`{{${macro}}}`}</code>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
