import React from "react";
import { AudioLines, ImageIcon, Video, X } from "lucide-react";
import type { AttachmentMetadata } from "../../../domain/attachments/types";

export interface PendingAttachment {
  metadata: AttachmentMetadata;
  previewUrl: string;
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
      className="rounded-2xl border border-border/60 bg-card/75 p-2.5 shadow-sm animate-in fade-in slide-in-from-bottom-1"
      aria-label="待发送附件"
      data-ui="pending-attachments"
    >
      <header className="mb-2 flex items-center justify-between px-0.5">
        <div>
          <p className="text-[10px] font-bold text-foreground">待发送媒体</p>
          <p className="text-[8px] text-muted-foreground">图片、视频与音频会分别投影给当前模型</p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[8px] font-bold text-primary">
          {items.length}/{maxCount}
        </span>
      </header>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <AttachmentPreview key={item.metadata.id} item={item} onRemove={onRemove} />
        ))}
      </div>
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
  const presentation = getPresentation(item.metadata);
  const Icon = presentation.icon;
  return (
    <article className={`relative h-[86px] w-[116px] shrink-0 overflow-hidden rounded-xl border ${presentation.border} bg-muted/40`}>
      {item.metadata.kind === "image" ? (
        <img src={item.previewUrl} alt={item.metadata.originalName} decoding="async" className="h-full w-full object-cover" />
      ) : item.metadata.kind === "video" ? (
        <video src={item.previewUrl} muted preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <div className={`flex h-full w-full flex-col items-center justify-center ${presentation.background}`}>
          <Icon className="h-7 w-7" />
          <span className="mt-1 text-[8px] font-semibold">准备发送音频</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-1.5 pt-5 text-white">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[8px] font-bold">
            <Icon className="h-3 w-3" /> {presentation.label}
          </div>
          <p className="max-w-[78px] truncate text-[7px] text-white/75">{item.metadata.originalName}</p>
        </div>
        <span className="shrink-0 text-[7px] text-white/70">{formatBytes(item.metadata.size)}</span>
      </div>
      <button
        type="button"
        aria-label={`移除 ${item.metadata.originalName}`}
        onClick={() => onRemove(item.metadata.id)}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow active:scale-90"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </article>
  );
}

function getPresentation(metadata: AttachmentMetadata) {
  if (metadata.kind === "image") {
    return { label: "图片", icon: ImageIcon, border: "border-sky-500/35", background: "text-sky-500" };
  }
  if (metadata.kind === "video") {
    return { label: "视频", icon: Video, border: "border-violet-500/35", background: "text-violet-500" };
  }
  return {
    label: "音频",
    icon: AudioLines,
    border: "border-emerald-500/35",
    background: "bg-emerald-500/10 text-emerald-500",
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
