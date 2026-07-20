import { Copy, Download, Redo2, Share2, Undo2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PromptComposition } from "../../domain/prompt-composition";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  createPromptCompositionFileName,
  MAX_PROMPT_COMPOSITION_FILE_SIZE,
  parsePromptCompositionTemplate,
  serializePromptCompositionTemplate,
} from "./promptCompositionTransfer";

const MAX_SHARE_TEXT_LENGTH = 500_000;

interface AndroidPromptTransferBridge {
  saveFile?: (fileName: string, content: string) => string;
  shareText?: (title: string, text: string, mimeType: string) => boolean;
}

interface WindowWithPromptTransferBridge extends Window {
  AndroidThemeBridge?: AndroidPromptTransferBridge;
}

interface PromptCompositionTransferToolbarProps {
  composition: PromptComposition;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onImport: (composition: PromptComposition) => void;
}

type Feedback = { kind: "success" | "error"; message: string };

export default function PromptCompositionTransferToolbar({
  composition,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onImport,
}: PromptCompositionTransferToolbarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback>();
  const transferData = useMemo(() => ({
    content: serializePromptCompositionTemplate(composition),
    fileName: createPromptCompositionFileName(composition.name),
  }), [composition]);

  const exportJson = () => {
    try {
      const { content, fileName } = transferData;
      const bridge = (window as WindowWithPromptTransferBridge).AndroidThemeBridge;
      if (typeof bridge?.saveFile === "function") {
        const path = bridge.saveFile(fileName, content);
        if (!path || path.startsWith("error:")) throw new Error("PROMPT_COMPOSITION_EXPORT_FAILED");
        setFeedback({ kind: "success", message: t("prompt_composer.export_saved", { path }) });
        return;
      }

      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFeedback({ kind: "success", message: t("prompt_composer.export_downloaded", { file: fileName }) });
    } catch {
      setFeedback({ kind: "error", message: t("prompt_composer.export_failed") });
    }
  };

  const copyJson = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(transferData.content);
      setFeedback({ kind: "success", message: t("prompt_composer.copy_success") });
    } catch {
      setFeedback({ kind: "error", message: t("prompt_composer.copy_failed") });
    }
  };

  const shareJson = async () => {
    try {
      const { content } = transferData;
      if (content.length > MAX_SHARE_TEXT_LENGTH) {
        throw new Error("PROMPT_COMPOSITION_SHARE_TOO_LARGE");
      }
      const title = `${composition.name} · Mobile Tavern`;
      const bridge = (window as WindowWithPromptTransferBridge).AndroidThemeBridge;
      if (typeof bridge?.shareText === "function") {
        if (!bridge.shareText(title, content, "application/json")) throw new Error("SHARE_REJECTED");
      } else if (typeof navigator.share === "function") {
        await navigator.share({ title, text: content });
      } else {
        throw new Error("SHARE_UNAVAILABLE");
      }
      setFeedback({ kind: "success", message: t("prompt_composer.share_opened") });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback({ kind: "error", message: t("prompt_composer.share_failed") });
    }
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_PROMPT_COMPOSITION_FILE_SIZE) {
        throw new Error("PROMPT_COMPOSITION_TEMPLATE_TOO_LARGE");
      }
      const imported = parsePromptCompositionTemplate(await file.text());
      onImport(imported);
      setFeedback({ kind: "success", message: t("prompt_composer.import_success", { name: imported.name }) });
    } catch {
      setFeedback({ kind: "error", message: t("prompt_composer.import_failed") });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/70 p-2">
      <div className="grid grid-cols-3 gap-2">
        <TransferButton disabled={!canUndo} onClick={onUndo} icon={<Undo2 className="h-3.5 w-3.5" />}>
          {t("prompt_composer.undo")}
        </TransferButton>
        <TransferButton disabled={!canRedo} onClick={onRedo} icon={<Redo2 className="h-3.5 w-3.5" />}>
          {t("prompt_composer.redo")}
        </TransferButton>
        <TransferButton onClick={() => inputRef.current?.click()} icon={<Upload className="h-3.5 w-3.5" />}>
          {t("prompt_composer.import_json")}
        </TransferButton>
        <TransferButton onClick={exportJson} icon={<Download className="h-3.5 w-3.5" />}>
          {t("prompt_composer.export_json")}
        </TransferButton>
        <TransferButton onClick={() => void copyJson()} icon={<Copy className="h-3.5 w-3.5" />}>
          {t("prompt_composer.copy_json")}
        </TransferButton>
        <TransferButton onClick={() => void shareJson()} icon={<Share2 className="h-3.5 w-3.5" />}>
          {t("prompt_composer.share_json")}
        </TransferButton>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        aria-label={t("prompt_composer.import_json_file")}
        className="hidden"
        onChange={(event) => void importJson(event.target.files?.[0])}
      />
      {feedback && (
        <p
          role="status"
          className={`px-1 text-[10px] leading-relaxed ${feedback.kind === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-300"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

function TransferButton({
  disabled = false,
  onClick,
  icon,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-border bg-background px-1.5 text-[10px] font-bold active:bg-muted disabled:opacity-35"
    >
      {icon}{children}
    </button>
  );
}
