import React from "react";
import { AudioLines, ImageIcon, Video, Waves, X } from "lucide-react";
import type { AttachmentMetadata } from "../../../domain/attachments/types";

export interface PendingAttachment {
  metadata: AttachmentMetadata;
  previewUrl: string;
  purpose?: "model-input";
}
interface PendingAttachmentStripProps {
  items: readonly PendingAttachment[];
  maxCount: number;
  onRemove: (assetId: string) => void;
}

export function PendingAttachmentStrip({
  items,
  maxCount,
  onRemove,
}: PendingAttachmentStripProps): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section
      className="flex items-center gap-2 overflow-x-auto rounded-xl border border-border/55 bg-card/70 p-1.5 animate-in fade-in slide-in-from-bottom-1"
      aria-label="待发送附件"
      data-ui="pending-attachments"
    >
      <span className="shrink-0 px-1 text-[9px] font-medium text-muted-foreground">{items.length}/{maxCount}</span>
      {items.map((item) => (
        <AttachmentPreview key={item.metadata.id} item={item} onRemove={onRemove} />
      ))}
    </section>
  );
}

function AttachmentPreview({
  item,
  onRemove,
}: {
  item: PendingAttachment;
  onRemove: (assetId: string) => void;
}): React.JSX.Element {
  const presentation = getPresentation(item);
  const Icon = presentation.icon;
  return (
    <article className="flex h-10 min-w-0 max-w-[160px] shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/65 pl-1 pr-1.5">
      {item.metadata.kind === "image" ? (
        <img src={item.previewUrl} alt={item.metadata.originalName} decoding="async" className="size-8 shrink-0 rounded-md object-cover" />
      ) : item.metadata.kind === "video" ? (
        <video src={item.previewUrl} muted preload="metadata" className="size-8 shrink-0 rounded-md object-cover" />
      ) : (
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${presentation.background}`}>
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[9px] font-semibold text-foreground">{presentation.label}</p>
        <p className="flex min-w-0 items-center gap-1 text-[8px] text-muted-foreground">
          <span className="truncate">{item.metadata.originalName}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatBytes(item.metadata.size)}</span>
        </p>
      </div>
      <button
        type="button"
        aria-label={`移除 ${item.metadata.originalName}`}
        onClick={() => onRemove(item.metadata.id)}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90"
      >
        <X className="size-3.5" />
      </button>
    </article>
  );
}

function getPresentation(item: PendingAttachment) {
  if (item.purpose === "model-input") {
    return { label: "语音输入", icon: Waves, background: "bg-primary/10 text-primary" };
  }
  if (item.metadata.kind === "image") {
    return { label: "图片", icon: ImageIcon, background: "bg-sky-500/10 text-sky-500" };
  }
  if (item.metadata.kind === "video") {
    return { label: "视频", icon: Video, background: "bg-violet-500/10 text-violet-500" };
  }
  return {
    label: "音频",
    icon: AudioLines,
    background: "bg-emerald-500/10 text-emerald-500",
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
