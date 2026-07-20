import { AlertTriangle, ArrowDown, Braces, History, MessageSquareText } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptBlock, PromptComposition, PromptCompositionDiagnostic } from "../../domain/prompt-composition";

interface PromptCompositionGraphProps {
  composition: PromptComposition;
  selectedBlockId?: string;
  diagnostics?: PromptCompositionDiagnostic[];
  onSelectBlock: (blockId: string) => void;
}

export default function PromptCompositionGraph({
  composition,
  selectedBlockId,
  diagnostics = [],
  onSelectBlock,
}: PromptCompositionGraphProps) {
  const { t } = useTranslation();
  if (composition.blocks.length === 0) {
    return <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">{t("prompt_composer.graph_empty")}</div>;
  }

  return (
    <div role="list" aria-label={t("prompt_composer.message_flow_graph")} className="space-y-0">
      {composition.blocks.map((block, index) => {
        const blockDiagnostics = diagnostics.filter((diagnostic) => diagnostic.blockId === block.id);
        const macros = extractMacros(block);
        const selected = block.id === selectedBlockId;
        return (
          <div key={block.id} role="listitem">
            <button
              type="button"
              aria-label={t("prompt_composer.graph_block", { name: block.name })}
              aria-pressed={selected}
              onClick={() => onSelectBlock(block.id)}
              className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/10 ring-2 ring-primary/15" : "border-border bg-background hover:border-primary/30"} ${block.enabled ? "" : "opacity-50"}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px]">{index + 1}</span>
                {block.source.type === "chat_history" ? <History className="h-4 w-4 text-amber-500" /> : <MessageSquareText className="h-4 w-4 text-primary" />}
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{block.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold">{block.source.type === "chat_history" ? "HISTORY" : block.role.toUpperCase()}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 pl-8 text-[9px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">{describeBlock(block, composition, t)}</span>
                {macros.length > 0 && <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"><Braces className="h-3 w-3" />{t("prompt_composer.graph_source_count", { count: String(macros.length) })}</span>}
                {block.condition && <span className="rounded bg-amber-500/15 px-1.5 py-0.5">{t("prompt_composer.condition")}</span>}
                {block.compatibility && <span className="rounded bg-sky-500/15 px-1.5 py-0.5">{block.compatibility.source}</span>}
                {blockDiagnostics.length > 0 && <span className="flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"><AlertTriangle className="h-3 w-3" />{blockDiagnostics.length}</span>}
              </div>
            </button>
            {index < composition.blocks.length - 1 && (
              <div aria-hidden="true" className="flex h-7 items-center justify-center text-muted-foreground">
                <div className="h-full w-px bg-border" />
                <ArrowDown className="-ml-2 mt-4 h-3.5 w-3.5 bg-primary/5" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function extractMacros(block: PromptBlock): string[] {
  if (block.source.type !== "template") return [];
  return Array.from(block.template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (match) => match[1]);
}

function describeBlock(block: PromptBlock, composition: PromptComposition, t: (key: string, params?: Record<string, string>) => string): string {
  if (block.source.type === "chat_history") {
    return block.source.selection?.mode === "recent"
      ? t("prompt_composer.recent_count", { count: String(block.source.selection.count) })
      : t("prompt_composer.all_messages");
  }
  const placement = block.placement;
  if (placement.type === "ordered") return t("prompt_composer.ordered");
  const target = composition.blocks.find((candidate) => candidate.id === placement.historyBlockId)?.name;
  return target
    ? t("prompt_composer.depth_target", { depth: String(placement.depth), target })
    : t("prompt_composer.depth_all", { depth: String(placement.depth) });
}
