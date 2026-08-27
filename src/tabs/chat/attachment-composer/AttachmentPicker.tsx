import React from "react";
import {
  AudioLines,
  ChevronUp,
  ImagePlus,
  Paperclip,
  Video,
} from "lucide-react";
import type { AttachmentKind } from "../../../domain/attachments/types";

interface AttachmentPickerProps {
  disabled: boolean;
  selectedCount: number;
  maxCount: number;
  onSelect: (files: readonly File[]) => void;
}
interface AttachmentChoice {
  kind: Extract<AttachmentKind, "image" | "audio" | "video">;
  label: string;
  hint: string;
  accept: string;
  icon: typeof ImagePlus;
  color: string;
}

const CHOICES: readonly AttachmentChoice[] = [
  {
    kind: "image",
    label: "图片",
    hint: "PNG · JPG · GIF · WebP",
    accept: "image/png,image/jpeg,image/gif,image/webp",
    icon: ImagePlus,
    color: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  {
    kind: "video",
    label: "视频",
    hint: "MP4 · WebM",
    accept: "video/mp4,video/webm",
    icon: Video,
    color: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  {
    kind: "audio",
    label: "音频",
    hint: "MP3 · OGG · WAV · M4A",
    accept: "audio/mpeg,audio/ogg,audio/wav,audio/mp4",
    icon: AudioLines,
    color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
] as const;

export function AttachmentPicker({
  disabled,
  selectedCount,
  maxCount,
  onSelect,
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
    <div className="relative shrink-0" data-ui="attachment-picker">
      <button
        type="button"
        aria-label="添加附件"
        aria-expanded={open}
        aria-controls="attachment-source-menu"
        disabled={disabled || full}
        onClick={() => setOpen((current) => !current)}
        className={`relative flex h-[42px] w-[42px] items-center justify-center rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
          open || selectedCount > 0
            ? "border-primary/40 bg-primary/15 text-primary shadow-sm"
            : "border-border/80 bg-input/30 text-muted-foreground hover:bg-muted"
        }`}
      >
        <Paperclip className="h-4 w-4" />
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
          className="absolute bottom-[calc(100%+0.65rem)] left-0 z-30 w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-border/70 bg-popover/95 p-2.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <div>
              <p className="text-[11px] font-bold text-foreground">选择附件类型</p>
              <p className="text-[9px] text-muted-foreground">不同媒体会使用独立处理流程</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[8px] font-semibold text-muted-foreground">
              {selectedCount}/{maxCount}<ChevronUp className="h-3 w-3" />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CHOICES.map((choice) => {
              const Icon = choice.icon;
              return (
                <div key={choice.kind}>
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
                    onClick={() => inputRefs.current[choice.kind]?.click()}
                    className={`flex min-h-[82px] w-full flex-col items-center justify-center rounded-xl border px-2 text-center transition active:scale-95 ${choice.color}`}
                  >
                    <Icon className="mb-1.5 h-5 w-5" />
                    <span className="text-[11px] font-bold">{choice.label}</span>
                    <span className="mt-0.5 line-clamp-2 text-[7.5px] leading-tight opacity-75">{choice.hint}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
