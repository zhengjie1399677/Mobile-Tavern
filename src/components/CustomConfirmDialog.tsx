import React, { useState, useEffect } from "react";
import { Check, Copy } from "lucide-react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { writeTextToClipboard } from "../infrastructure/platform/clipboard";

export default function CustomConfirmDialog() {
  const {
    customDialog,
  } = useUnifiedApp((state) => ({ customDialog: state.customDialog }));

  const { t } = useTranslation();

  const [localVal, setLocalVal] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    setCopyState("idle");
    if (customDialog && customDialog.isOpen && customDialog.type === "prompt") {
      setLocalVal(customDialog.defaultValue || "");
    }
  }, [customDialog]);

  useEffect(() => {
    if (copyState === "idle") return undefined;
    const timer = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleDismiss = () => {
    if (!customDialog) return;
    if (customDialog.type === "alert") {
      customDialog.onConfirm?.();
      return;
    }
    customDialog.onCancel?.();
  };

  useMobileBackHandler(!!customDialog?.isOpen, () => {
    handleDismiss();
    return true;
  }, 1000);

  if (!customDialog || !customDialog.isOpen) return null;

  const handleConfirm = () => {
    if (customDialog.type === "prompt") {
      customDialog.onConfirmPrompt?.(localVal);
    } else {
      customDialog.onConfirm?.();
    }
  };

  const handleCopy = async () => {
    try {
      await writeTextToClipboard(customDialog.message);
      setCopyState("copied");
    } catch (error) {
      console.error("Failed to copy dialog message:", error);
      setCopyState("failed");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent
        showCloseButton={false}
        className={`z-[1000] gap-3.5 rounded-2xl border border-border/80 bg-popover p-4 shadow-2xl w-[min(28rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden min-w-0 ${customDialog.type === "prompt" && customDialog.inputType === "textarea" ? "sm:max-w-lg" : "sm:max-w-sm"}`}
      >
        <DialogHeader className="gap-1.5 min-w-0 max-w-full overflow-hidden">
          <DialogTitle className="text-sm font-bold text-foreground truncate">
            {customDialog.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed break-all break-words whitespace-pre-wrap max-h-[55vh] overflow-y-auto min-w-0 max-w-full select-text pr-1">
            {customDialog.message}
          </DialogDescription>
          {customDialog.type === "prompt" && (
            <div className="mt-1">
              {customDialog.inputType === "textarea" ? (
                <textarea
                  aria-label={customDialog.title}
                  value={localVal}
                  onChange={(e) => setLocalVal(e.target.value)}
                  autoFocus
                  rows={6}
                  className="block w-full resize-none rounded-lg border border-border/80 bg-input p-2.5 text-xs leading-relaxed text-foreground shadow-inner outline-none transition-colors focus:border-primary/50 focus:bg-background/95 focus:ring-2 focus:ring-ring/40"
                />
              ) : (
                <input
                  aria-label={customDialog.title}
                  type={customDialog.inputType === "password" ? "password" : "text"}
                  value={localVal}
                  onChange={(e) => setLocalVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      customDialog.onConfirmPrompt?.(localVal);
                    }
                  }}
                  autoFocus
                  className="block h-8.5 w-full rounded-lg border border-border/80 bg-input px-2.5 text-xs text-foreground shadow-inner outline-none transition-colors focus:border-primary/50 focus:bg-background/95 focus:ring-2 focus:ring-ring/40"
                />
              )}
            </div>
          )}
        </DialogHeader>
        <DialogFooter className="flex-row justify-end gap-2 pt-1 border-t border-border/60">
          {customDialog.type === "alert" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-16 px-3 text-xs gap-1.5"
              onClick={() => { void handleCopy(); }}
            >
              {copyState === "copied" ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copyState === "copied"
                  ? t("dialog.copied")
                  : copyState === "failed"
                    ? t("dialog.copy_failed")
                    : t("dialog.copy")}
              </span>
            </Button>
          )}
          {(customDialog.type === "confirm" ||
            customDialog.type === "prompt") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-16 px-3 text-xs"
              onClick={() => customDialog.onCancel?.()}
            >
              {t("dialog.cancel")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8 min-w-16 px-3 text-xs font-semibold"
            onClick={handleConfirm}
          >
            {t("dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
