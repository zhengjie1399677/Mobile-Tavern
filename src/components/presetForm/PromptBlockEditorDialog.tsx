import {
  Copy,
  Database,
  Pencil,
  Plus,
  Search,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import type {
  PromptBlock,
  PromptMessageRole,
} from "../../domain/prompt-composition";
import { PROMPT_DATA_SOURCE_OPTIONS } from "./promptDataSources";
import {
  PromptComposerButton,
  PromptComposerInput,
  PromptComposerSelect,
  PromptComposerSwitch,
  PromptComposerTextarea,
} from "./PromptComposerControls";
import { estimatePromptBlockTokens } from "./promptBlockListTools";

interface PromptBlockEditorDialogProps {
  block?: PromptBlock;
  historyBlocks: PromptBlock[];
  onClose: () => void;
  onPatch: (patch: Partial<PromptBlock>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  allowAdvancedFields?: boolean;
}

const COMMON_QUICK_MACROS = [
  { key: "char", label: "{{char}}" },
  { key: "user", label: "{{user}}" },
  { key: "personality", label: "{{personality}}" },
  { key: "description", label: "{{description}}" },
  { key: "scenario", label: "{{scenario}}" },
  { key: "mesExamples", label: "{{mesExamples}}" },
  { key: "wi::main", label: "{{wi::...}}" },
  { key: "lastMessage", label: "{{lastMessage}}" },
  { key: "input", label: "{{input}}" },
];

export default function PromptBlockEditorDialog({
  block,
  historyBlocks,
  onClose,
  onPatch,
  onDelete,
  onDuplicate,
  allowAdvancedFields = true,
}: PromptBlockEditorDialogProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSources, setShowSources] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");

  useMobileBackHandler(Boolean(block), () => {
    onClose();
    return true;
  }, 950);

  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return PROMPT_DATA_SOURCE_OPTIONS.filter(([key, labelKey]) =>
      !query || key.toLocaleLowerCase().includes(query) || t(labelKey).toLocaleLowerCase().includes(query)
    );
  }, [sourceQuery, t]);

  if (!block) return null;

  const estimatedTokens = estimatePromptBlockTokens(block);

  const insertMacro = (key: string) => {
    const macro = key.startsWith("{{") ? key : `{{${key}}}`;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? block.template.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${block.template.slice(0, start)}${macro}${block.template.slice(end)}`;
    onPatch({ template: next });
    setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + macro.length, start + macro.length);
    }, 0);
  };

  const recentSelection = block.source.type === "chat_history" && block.source.selection?.mode === "recent"
    ? block.source.selection
    : undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[92dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 overflow-hidden rounded-b-none border border-border/80 bg-background/95 p-0 backdrop-blur-md shadow-2xl">
        <DialogHeader className="border-b border-border/70 px-4 pb-3 pt-4 pr-12">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{t("prompt_composer.edit_block_title")}</DialogTitle>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-700 dark:text-violet-300">
              {estimatedTokens} T
            </span>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t("prompt_composer.edit_block_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92dvh-76px)] space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-xs text-foreground">
          {/* 启用开关行 */}
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 p-3 text-xs font-semibold backdrop-blur-xs shadow-xs">
            <span className="flex items-center gap-1.5 font-bold">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("prompt_composer.block_enabled")}
            </span>
            <PromptComposerSwitch
              checked={block.enabled}
              onCheckedChange={(checked) => onPatch({ enabled: checked })}
              aria-label={t("prompt_composer.block_enabled")}
            />
          </div>

          {/* 区块名称 */}
          <Field label={t("prompt_composer.block_name")}>
            <PromptComposerInput
              value={block.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              aria-label={t("prompt_composer.block_name")}
              className="bg-background/80 font-bold"
            />
          </Field>

          {/* 消息源类型 & 角色选择 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("prompt_composer.source")}>
              <PromptComposerSelect
                value={block.source.type}
                onValueChange={(value) => onPatch({
                  source: value === "chat_history"
                    ? { type: "chat_history", selection: { mode: "all" } }
                    : { type: "template" },
                  placement: value === "chat_history" ? { type: "ordered" } : block.placement,
                })}
                ariaLabel={t("prompt_composer.source")}
                options={[
                  { value: "template", label: t("prompt_composer.template_source") },
                  { value: "chat_history", label: t("prompt_composer.history_source") },
                ]}
              />
            </Field>

            <Field label={t("prompt_composer.role")}>
              <PromptComposerSelect
                value={block.role}
                disabled={block.source.type === "chat_history"}
                onValueChange={(value) => onPatch({ role: value as PromptMessageRole })}
                ariaLabel={t("prompt_composer.role")}
                options={["system", "user", "assistant"].map((value) => ({ value, label: value }))}
              />
            </Field>
          </div>

          {/* 模板内容编辑 */}
          {block.source.type === "template" && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                  <span>{t("prompt_composer.template")}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {block.template.length} 字符 · ~{estimatedTokens} Tokens
                  </span>
                </div>

                {/* 快捷宏变量芯片栏 */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground">快速插入:</span>
                  {COMMON_QUICK_MACROS.map((macro) => (
                    <PromptComposerButton
                      key={macro.key}
                      onClick={() => insertMacro(macro.key)}
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 rounded-lg border border-primary/25 bg-primary/10 px-2 py-0 font-mono text-[10px] font-bold text-primary hover:bg-primary/20 hover:border-primary/40 active:scale-95 transition-all shadow-2xs min-h-0"
                    >
                      {macro.label}
                    </PromptComposerButton>
                  ))}
                </div>

                <PromptComposerTextarea
                  ref={textareaRef}
                  value={block.template}
                  onChange={(event) => onPatch({ template: event.target.value })}
                  aria-label={t("prompt_composer.template")}
                  className="min-h-[160px] resize-y font-mono text-xs leading-relaxed bg-background/80"
                  placeholder="输入提示词内容，可使用 {{char}}、{{user}} 等宏变量..."
                />
              </div>

              {/* 完整宏变量检索面板 */}
              <section className="rounded-2xl border border-border/70 bg-card/60 p-3 backdrop-blur-xs shadow-xs">
                <PromptComposerButton
                  type="button"
                  aria-label={t("prompt_composer.insert_source")}
                  onClick={() => setShowSources((current) => !current)}
                  variant="ghost"
                  className="flex w-full items-center justify-between px-1 text-xs font-bold text-primary shadow-none hover:bg-primary/10"
                >
                  <span className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>{t("prompt_composer.insert_source")}</span>
                  </span>
                  <span className="text-sm font-bold">{showSources ? "−" : "+"}</span>
                </PromptComposerButton>

                {showSources && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-2.5">
                    <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 shadow-xs focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <PromptComposerInput
                        value={sourceQuery}
                        onChange={(event) => setSourceQuery(event.target.value)}
                        placeholder={t("prompt_composer.search_sources")}
                        aria-label={t("prompt_composer.search_sources")}
                        className="min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 text-xs"
                      />
                    </div>
                    <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                      {filteredSources.map(([key, labelKey, groupKey]) => (
                        <PromptComposerButton
                          type="button"
                          key={key}
                          onClick={() => insertMacro(key)}
                          variant="ghost"
                          className="flex h-auto min-h-10 w-full items-center justify-start gap-2 rounded-xl border border-border/40 bg-background/60 px-2.5 py-1.5 text-left shadow-none hover:border-primary/30 hover:bg-primary/10 transition-colors"
                          aria-label={`${t(labelKey)} {{${key}}}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-foreground">{t(labelKey)}</span>
                            <code className="block truncate text-[9px] text-primary font-mono">{`{{${key}}}`}</code>
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{t(groupKey)}</span>
                        </PromptComposerButton>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* 历史对话特定配置 */}
          {block.source.type === "chat_history" ? (
            <section className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-3 backdrop-blur-xs shadow-xs">
              <Field label={t("prompt_composer.history_selection")}>
                <PromptComposerSelect
                  value={block.source.selection?.mode ?? "all"}
                  onValueChange={(value) => onPatch({
                    source: value === "recent"
                      ? { type: "chat_history", selection: { mode: "recent", count: 6, preserveFirstAssistant: false } }
                      : { type: "chat_history", selection: { mode: "all" } },
                  })}
                  ariaLabel={t("prompt_composer.history_selection")}
                  options={[
                    { value: "all", label: t("prompt_composer.all_messages") },
                    { value: "recent", label: t("prompt_composer.recent_messages") },
                  ]}
                />
              </Field>

              {recentSelection && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t("prompt_composer.message_count")}>
                    <PromptComposerInput
                      type="number"
                      min={0}
                      value={recentSelection.count}
                      onChange={(event) => onPatch({
                        source: {
                          type: "chat_history",
                          selection: {
                            ...recentSelection,
                            count: Math.max(0, Number(event.target.value) || 0),
                          },
                        },
                      })}
                      aria-label={t("prompt_composer.message_count")}
                      className="bg-background/80 font-mono"
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-[11px] font-semibold text-muted-foreground shadow-2xs mt-auto">
                    <span>{t("prompt_composer.preserve_greeting")}</span>
                    <PromptComposerSwitch
                      checked={recentSelection.preserveFirstAssistant}
                      onCheckedChange={(checked) => onPatch({
                        source: {
                          type: "chat_history",
                          selection: { ...recentSelection, preserveFirstAssistant: checked },
                        },
                      })}
                      aria-label={t("prompt_composer.preserve_greeting")}
                    />
                  </div>
                </div>
              )}
            </section>
          ) : (
            /* 放置位置配置 (Ordered vs In-Chat) */
            <section className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-3 backdrop-blur-xs shadow-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("prompt_composer.placement")}>
                  <PromptComposerSelect
                    value={block.placement.type}
                    onValueChange={(value) => onPatch({
                      placement: value === "in_chat"
                        ? { type: "in_chat", depth: 0, order: block.order }
                        : { type: "ordered" },
                    })}
                    ariaLabel={t("prompt_composer.placement")}
                    options={[
                      { value: "ordered", label: t("prompt_composer.ordered") },
                      { value: "in_chat", label: t("prompt_composer.in_chat") },
                    ]}
                  />
                </Field>
                {block.placement.type === "in_chat" && (
                  <Field label={t("prompt_composer.depth")}>
                    <PromptComposerInput
                      type="number"
                      min={0}
                      value={block.placement.depth}
                      onChange={(event) => onPatch({
                        placement: {
                          type: "in_chat",
                          depth: Math.max(0, Number(event.target.value) || 0),
                          order: block.order,
                          historyBlockId: block.placement.type === "in_chat" ? block.placement.historyBlockId : undefined,
                        },
                      })}
                      aria-label={t("prompt_composer.depth")}
                      className="bg-background/80 font-mono"
                    />
                  </Field>
                )}
              </div>

              {block.placement.type === "in_chat" && (
                <Field label={t("prompt_composer.target_history")}>
                  <PromptComposerSelect
                    value={block.placement.historyBlockId ?? ""}
                    onValueChange={(value) => onPatch({
                      placement: {
                        type: "in_chat",
                        depth: block.placement.type === "in_chat" ? block.placement.depth : 0,
                        order: block.placement.type === "in_chat" ? block.placement.order : block.order,
                        historyBlockId: value || undefined,
                      },
                    })}
                    ariaLabel={t("prompt_composer.target_history")}
                    options={[
                      { value: "", label: t("prompt_composer.all_history_blocks") },
                      ...historyBlocks.map((historyBlock) => ({ value: historyBlock.id, label: historyBlock.name })),
                    ]}
                  />
                </Field>
              )}
            </section>
          )}

          {/* 高级字段（条件判断与 Token 策略） */}
          {allowAdvancedFields ? (
            <div key={block.id}>
              <AdvancedFields block={block} onPatch={onPatch} />
            </div>
          ) : (
            <p className="rounded-xl border border-primary/25 bg-primary/10 p-3 text-[10px] leading-relaxed text-primary font-medium">
              {t("prompt_composer.advanced_go_composer")}
            </p>
          )}

          {/* 兼容性元数据 */}
          {block.compatibility && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-3 text-[10px] text-sky-700 dark:text-sky-300 font-medium">
              {t("prompt_composer.compatibility_metadata", { source: block.compatibility.source })}
            </div>
          )}

          {/* 底部复制/删除操作栏 */}
          <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
            <PromptComposerButton onClick={onDuplicate} className="min-h-10 gap-2 font-bold shadow-xs">
              <Copy className="h-4 w-4 text-primary" />
              <span>{t("prompt_composer.duplicate_block")}</span>
            </PromptComposerButton>
            <PromptComposerButton onClick={onDelete} variant="destructive" className="min-h-10 gap-2 font-bold shadow-xs">
              <Trash2 className="h-4 w-4" />
              <span>{t("prompt_composer.delete_block")}</span>
            </PromptComposerButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvancedFields({
  block,
  onPatch,
}: {
  block: PromptBlock;
  onPatch: (patch: Partial<PromptBlock>) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(Boolean(block.condition || block.tokenPolicy));

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-xs transition-all">
      <PromptComposerButton
        onClick={() => setExpanded((prev) => !prev)}
        variant="ghost"
        className="flex w-full items-center justify-between p-3 text-left font-bold text-xs hover:bg-muted/20 rounded-2xl transition-colors h-auto min-h-0"
      >
        <span className="inline-flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
            <Sliders className="h-3.5 w-3.5" />
          </span>
          <span>{t("prompt_composer.advanced_fields")}</span>
          {(block.condition || block.tokenPolicy) && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300">
              {t("prompt_composer.active")}
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-muted-foreground">{expanded ? "−" : "+"}</span>
      </PromptComposerButton>

      {expanded && (
        <div className="space-y-4 px-3 pb-3.5 pt-1 border-t border-border/50">
          {/* 条件触发配置 */}
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-background/80 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>{t("prompt_composer.condition")}</span>
              <PromptComposerSwitch
                checked={Boolean(block.condition)}
                onCheckedChange={(checked) => onPatch({
                  condition: checked
                    ? { dataKey: "worldbook.triggered", operator: "not_empty" }
                    : undefined,
                })}
                aria-label={t("prompt_composer.condition")}
              />
            </div>

            {block.condition && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <PromptComposerInput
                  value={block.condition.dataKey}
                  onChange={(event) => onPatch({ condition: { ...block.condition!, dataKey: event.target.value } })}
                  aria-label={t("prompt_composer.condition_key")}
                  placeholder="变量键名 (如 worldbook.triggered)"
                  className="bg-background"
                />
                <PromptComposerSelect
                  value={block.condition.operator}
                  onValueChange={(value) => onPatch({
                    condition: {
                      ...block.condition!,
                      operator: value as NonNullable<PromptBlock["condition"]>["operator"],
                    },
                  })}
                  ariaLabel={t("prompt_composer.condition_operator")}
                  options={["not_empty", "empty", "equals", "not_equals"].map((value) => ({ value, label: value }))}
                />
                {(block.condition.operator === "equals" || block.condition.operator === "not_equals") && (
                  <PromptComposerInput
                    value={block.condition.value ?? ""}
                    onChange={(event) => onPatch({ condition: { ...block.condition!, value: event.target.value } })}
                    aria-label={t("prompt_composer.condition_value")}
                    placeholder="目标值"
                    className="col-span-2 bg-background"
                  />
                )}
              </div>
            )}
          </div>

          {/* Token 策略配置 */}
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-background/80 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>{t("prompt_composer.token_policy")}</span>
              <PromptComposerSwitch
                checked={Boolean(block.tokenPolicy)}
                onCheckedChange={(checked) => onPatch({
                  tokenPolicy: checked ? { priority: 50, overflow: "keep" } : undefined,
                })}
                aria-label={t("prompt_composer.token_policy")}
              />
            </div>

            {block.tokenPolicy && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{t("prompt_composer.priority")}</label>
                  <PromptComposerInput
                    type="number"
                    value={block.tokenPolicy.priority}
                    onChange={(event) => onPatch({ tokenPolicy: { ...block.tokenPolicy!, priority: Number(event.target.value) || 0 } })}
                    aria-label={t("prompt_composer.priority")}
                    className="bg-background font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{t("prompt_composer.overflow")}</label>
                  <PromptComposerSelect
                    value={block.tokenPolicy.overflow}
                    onValueChange={(value) => onPatch({
                      tokenPolicy: { ...block.tokenPolicy!, overflow: value as "keep" | "drop" },
                    })}
                    ariaLabel={t("prompt_composer.overflow")}
                    options={["keep", "drop"].map((value) => ({ value, label: value }))}
                  />
                </div>
                <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground">
                  {t("prompt_composer.token_policy_compat_note")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block space-y-1.5 text-[10px] font-bold text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}
