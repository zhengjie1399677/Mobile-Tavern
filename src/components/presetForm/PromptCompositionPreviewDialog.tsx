import { AlertTriangle, Braces, MessageSquareText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";

interface PromptCompositionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview?: PromptCompositionPreviewData;
}

export default function PromptCompositionPreviewDialog({
  open,
  onOpenChange,
  preview,
}: PromptCompositionPreviewDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[88dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 overflow-hidden rounded-b-none p-0">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12">
          <DialogTitle>{t("prompt_composer.preview_title")}</DialogTitle>
          <DialogDescription>{t("prompt_composer.preview_description")}</DialogDescription>
        </DialogHeader>
        <PromptCompositionPreviewContent preview={preview} scrollClassName="max-h-[calc(88dvh-132px)]" />
      </DialogContent>
    </Dialog>
  );
}

export function PromptCompositionPreviewContent({
  preview,
  scrollClassName = "max-h-[62dvh]",
}: {
  preview?: PromptCompositionPreviewData;
  scrollClassName?: string;
}) {
  const { t } = useTranslation();
  const messages = preview?.messages ?? [];
  const diagnostics = preview?.diagnostics ?? [];

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
        <span>{t("prompt_composer.message_total", { count: String(messages.length) })}</span>
        <span>·</span>
        <span>{t("prompt_composer.token_estimate", { count: String(preview?.estimatedTokens ?? 0) })}</span>
        <span className="ml-auto rounded-full border border-border bg-background px-2 py-0.5">
          {preview?.contextAvailable ? t("prompt_composer.live_context") : t("prompt_composer.no_preview_context")}
        </span>
      </div>

      <div
        data-testid="prompt-preview-scroll"
        className={`${scrollClassName} min-h-0 touch-pan-y space-y-3 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]`}
      >
        {!preview?.contextAvailable && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("prompt_composer.preview_requires_chat")}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center text-xs text-destructive">
            {t("prompt_composer.empty_send_warning")}
          </div>
        ) : (
          messages.map((message, index) => (
            <article key={`${index}-${message.role}`} className="overflow-hidden rounded-xl border border-border bg-background">
              <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                <MessageSquareText className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono text-[10px] text-muted-foreground">#{index + 1}</span>
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${roleClass(message.role)}`}>{message.role.toUpperCase()}</span>
                {message.name && <span className="ml-auto text-[10px] text-muted-foreground">{message.name}</span>}
              </header>
              <pre className="whitespace-pre-wrap break-words p-3 font-sans text-xs leading-relaxed">{message.content}</pre>
            </article>
          ))
        )}

        {diagnostics.length > 0 && (
          <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300">
              <Braces className="h-4 w-4" />
              {t("prompt_composer.diagnostics", { count: String(diagnostics.length) })}
            </div>
            {diagnostics.map((diagnostic, index) => (
              <div key={`${diagnostic.code}-${index}`} className="text-[10px] leading-relaxed text-muted-foreground">
                <code className="mr-1 text-amber-700 dark:text-amber-300">{diagnostic.code}</code>
                {diagnostic.message}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function roleClass(role: string): string {
  if (role === "system") return "bg-violet-500/15 text-violet-600 dark:text-violet-300";
  if (role === "assistant") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
}
