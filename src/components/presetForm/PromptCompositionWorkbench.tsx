import { Bug, Eye, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptComposition } from "../../domain/prompt-composition";
import PromptCompositionGraph from "./PromptCompositionGraph";
import { PromptCompositionPreviewContent } from "./PromptCompositionPreviewDialog";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";
import PromptCompositionDebugPanel from "./PromptCompositionDebugPanel";
import { PromptComposerButton } from "./PromptComposerControls";

export type PromptWorkbenchView = "graph" | "preview" | "debug";

interface PromptCompositionWorkbenchProps {
  composition: PromptComposition;
  preview?: PromptCompositionPreviewData;
  selectedBlockId?: string;
  view: PromptWorkbenchView;
  onViewChange: (view: PromptWorkbenchView) => void;
  onSelectBlock: (blockId: string) => void;
  embedded?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function PromptCompositionWorkbench(props: PromptCompositionWorkbenchProps) {
  const { t } = useTranslation();
  const panel = (
    <section role="region" aria-label={t("prompt_composer.workbench_title")} className="overflow-hidden rounded-xl border border-primary/20 bg-background/75">
      <div className="grid grid-cols-3 border-b border-border bg-muted/30 p-1" role="group" aria-label={t("prompt_composer.workbench_view")}>
        <ViewButton active={props.view === "graph"} onClick={() => props.onViewChange("graph")} icon={<GitBranch className="h-3.5 w-3.5" />}>
          {t("prompt_composer.graph")}
        </ViewButton>
        <ViewButton active={props.view === "preview"} onClick={() => props.onViewChange("preview")} icon={<Eye className="h-3.5 w-3.5" />}>
          {t("prompt_composer.final_preview")}
        </ViewButton>
        <ViewButton active={props.view === "debug"} onClick={() => props.onViewChange("debug")} icon={<Bug className="h-3.5 w-3.5" />}>
          {t("prompt_composer.debug")}
        </ViewButton>
      </div>
      {props.view === "graph" ? (
        <div className="max-h-[68dvh] overflow-y-auto p-3">
          <PromptCompositionGraph
            composition={props.composition}
            selectedBlockId={props.selectedBlockId}
            diagnostics={props.preview?.diagnostics}
            onSelectBlock={props.onSelectBlock}
          />
        </div>
      ) : props.view === "preview" ? (
        <PromptCompositionPreviewContent preview={props.preview} scrollClassName="max-h-[66dvh]" />
      ) : (
        <PromptCompositionDebugPanel preview={props.preview} />
      )}
    </section>
  );

  if (props.embedded) return panel;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[92dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 overflow-hidden rounded-b-none p-0">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12">
          <DialogTitle>{t("prompt_composer.workbench_title")}</DialogTitle>
          <DialogDescription>{t("prompt_composer.workbench_description")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{panel}</div>
      </DialogContent>
    </Dialog>
  );
}

function ViewButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <PromptComposerButton aria-pressed={active} onClick={onClick} variant="ghost" className={`gap-1.5 border-0 px-2 shadow-none ${active ? "bg-background text-primary shadow-sm ring-1 ring-border hover:bg-background" : "text-muted-foreground"}`}>
      {icon}{children}
    </PromptComposerButton>
  );
}
