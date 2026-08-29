import React from "react";
import {
  AudioLines,
  ImagePlus,
  Plus,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import type { AttachmentKind } from "../../../domain/attachments/types";

interface AttachmentPickerProps {
  disabled: boolean;
  selectedCount: number;
  maxCount: number;
  quickActionsVisible: boolean;
  onSelect: (files: readonly File[]) => void;
  onToggleQuickActions: () => void;
}
interface AttachmentChoice {
  kind: Extract<AttachmentKind, "image" | "audio" | "video">;
  label: string;
  accept: string;
  icon: typeof ImagePlus;
}

const CHOICES: readonly AttachmentChoice[] = [
  {
    kind: "image",
    label: "图片",
    accept: "image/png,image/jpeg,image/gif,image/webp",
    icon: ImagePlus,
  },
  {
    kind: "video",
    label: "视频",
    accept: "video/mp4,video/webm",
    icon: Video,
  },
  {
    kind: "audio",
    label: "音频",
    accept: "audio/mpeg,audio/ogg,audio/wav,audio/mp4",
    icon: AudioLines,
  },
] as const;

export function AttachmentPicker({
  disabled,
  selectedCount,
  maxCount,
  quickActionsVisible,
  onSelect,
  onToggleQuickActions,
}: AttachmentPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const inputRefs = React.useRef<Partial<Record<AttachmentChoice["kind"], HTMLInputElement>>>({});
  const full = selectedCount >= maxCount;

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="shrink-0" data-ui="attachment-picker">
      <button
        type="button"
        aria-label="添加内容"
        aria-expanded={open}
        aria-controls="attachment-source-menu"
        onClick={() => setOpen((current) => !current)}
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
          open || selectedCount > 0
            ? "border-primary/40 bg-primary/15 text-primary shadow-sm"
            : "border-border/80 bg-input/30 text-muted-foreground hover:bg-muted"
        }`}
      >
        <Plus className={`size-4 transition-transform ${open ? "rotate-45" : ""}`} />
        {selectedCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
            {selectedCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id="attachment-source-menu"
          role="menu"
          aria-label="添加内容与输入工具"
          className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 grid w-full grid-cols-4 gap-1 rounded-2xl border border-border/70 bg-popover p-1 shadow-xl animate-in fade-in slide-in-from-bottom-2"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={quickActionsVisible}
            onClick={() => {
              onToggleQuickActions();
              setOpen(false);
            }}
            className={`flex min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors active:scale-95 ${
              quickActionsVisible
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            <span>快捷栏</span>
          </button>
          {CHOICES.map((choice) => {
            const Icon = choice.icon;
            return (
              <div key={choice.kind} role="none">
                <input
                  ref={(element) => { inputRefs.current[choice.kind] = element ?? undefined; }}
                  type="file"
                  accept={choice.accept}
                  multiple
                  className="hidden"
                  aria-label={`选择${choice.label}`}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length > 0) onSelect(files);
                    setOpen(false);
                  }}
                />
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled || full}
                  onClick={() => inputRefs.current[choice.kind]?.click()}
                  className="flex min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-35"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  <span>{choice.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
