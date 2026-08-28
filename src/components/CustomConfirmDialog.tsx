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
        className={`z-[1000] gap-5 border-border/80 bg-popover shadow-2xl ${customDialog.type === "prompt" && customDialog.inputType === "textarea" ? "sm:max-w-lg" : "sm:max-w-sm"}`}
      >
        <DialogHeader>
          <DialogTitle className="font-bold text-foreground text-base tracking-wide">
            {customDialog.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground/90 leading-relaxed break-words whitespace-pre-wrap">
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
                  rows={10}
                  className="block w-full resize-none rounded-xl border border-border/80 bg-input px-3.5 py-2.5 text-sm leading-relaxed text-foreground shadow-inner outline-none transition-colors focus:border-primary/50 focus:bg-background/95 focus:ring-2 focus:ring-ring/40"
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
                  className="block min-h-11 w-full rounded-xl border border-border/80 bg-input px-3.5 py-2.5 text-sm text-foreground shadow-inner outline-none transition-colors focus:border-primary/50 focus:bg-background/95 focus:ring-2 focus:ring-ring/40"
                />
              )}
            </div>
          )}
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          {customDialog.type === "alert" && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11 min-w-20 gap-1.5"
              onClick={() => { void handleCopy(); }}
            >
              {copyState === "copied" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
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
              size="lg"
              className="min-h-11 min-w-20"
              onClick={() => customDialog.onCancel?.()}
            >
              {t("dialog.cancel")}
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="min-h-11 min-w-20"
            onClick={handleConfirm}
          >
            {t("dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
