import React from "react";
import { AudioLines, FileText, ImageIcon, Video } from "lucide-react";
import type { IAttachmentService } from "../../../application/serviceContracts";
import type { AttachmentMetadata } from "../../../domain/attachments/types";
import type { MessageContentPart } from "../../../domain/messages/messageContent";
import { useUnifiedApp } from "../../../UnifiedAppContext";

interface MessageAttachmentPartsProps {
  parts: readonly MessageContentPart[];
}

interface ResolvedAttachment {
  url: string;
  metadata: AttachmentMetadata | null;
}

export function MessageAttachmentParts({ parts }: MessageAttachmentPartsProps): React.JSX.Element | null {
  const getKernelService = useUnifiedApp((state) => state.getKernelService);
  const attachmentParts = React.useMemo(() => parts.filter((part) => part.type !== "text"), [parts]);
  const [assets, setAssets] = React.useState<Record<string, ResolvedAttachment>>({});
  const [missingIds, setMissingIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let active = true;
    if (attachmentParts.length === 0) return () => { active = false; };
    const service = getKernelService<IAttachmentService>("attachments");
    void Promise.all(attachmentParts.map(async (part) => {
      try {
        const [url, metadata] = await Promise.all([
          service.getObjectUrl(part.assetId),
          service.getMetadata(part.assetId),
        ]);
        return [part.assetId, { url, metadata }] as const;
      } catch {
        if (active) setMissingIds((current) => new Set(current).add(part.assetId));
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setAssets(Object.fromEntries(
        entries.filter((entry): entry is readonly [string, ResolvedAttachment] => entry !== null),
      ));
    });
    return () => { active = false; };
  }, [attachmentParts, getKernelService]);

  if (attachmentParts.length === 0) return null;
  return (
    <div className="grid max-w-full grid-cols-1 gap-2" aria-label="消息附件" data-ui="message-attachments">
      {attachmentParts.map((part, index) => {
        const asset = assets[part.assetId];
        if (missingIds.has(part.assetId)) {
          return (
            <div key={`${part.assetId}-${index}`} className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              附件不可用或已被清理
            </div>
          );
        }
        if (!asset) return <div key={`${part.assetId}-${index}`} className="h-24 animate-pulse rounded-xl bg-muted/60" />;
        const name = asset.metadata?.originalName ?? (part.type === "file" ? part.displayName : "未命名媒体");
        const size = asset.metadata ? formatBytes(asset.metadata.size) : null;
        if (part.type === "image") {
          return (
            <AttachmentFrame key={`${part.assetId}-${index}`} icon={ImageIcon} label="图片" name={name} size={size} tone="sky">
              <img src={asset.url} alt={part.alt || name} loading="lazy" decoding="async" className="max-h-80 w-full object-contain" />
            </AttachmentFrame>
          );
        }
        if (part.type === "video") {
          return (
            <AttachmentFrame key={`${part.assetId}-${index}`} icon={Video} label="视频" name={name} size={size} tone="violet">
              <video src={asset.url} controls preload="metadata" className="max-h-80 w-full bg-black object-contain" />
            </AttachmentFrame>
          );
        }
        if (part.type === "audio") {
          const isModelInput = part.purpose === "model-input";
          return (
            <article key={`${part.assetId}-${index}`} className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><AudioLines className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold text-muted-foreground">{isModelInput ? "语音输入" : "音频"}</p>
                  <p className="truncate text-[10px] font-medium text-foreground">{name}</p>
                </div>
                {size && <span className="text-[8px] text-muted-foreground">{size}</span>}
              </div>
              <audio src={asset.url} controls preload="metadata" className="h-9 w-full" />
            </article>
          );
        }
        return (
          <a key={`${part.assetId}-${index}`} href={asset.url} download={part.displayName} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs hover:bg-muted">
            <FileText className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">{part.displayName}</span>
            {size && <span className="text-[8px] text-muted-foreground">{size}</span>}
          </a>
        );
      })}
    </div>
  );
}

function AttachmentFrame({ icon: Icon, label, name, size, tone, children }: {
  icon: typeof ImageIcon;
  label: string;
  name: string;
  size: string | null;
  tone: "sky" | "violet";
  children: React.ReactNode;
}): React.JSX.Element {
  const toneClass = tone === "sky"
    ? "border-sky-500/25 bg-sky-500/5 text-sky-600 dark:text-sky-300"
    : "border-violet-500/25 bg-violet-500/5 text-violet-600 dark:text-violet-300";
  return (
    <figure className={`overflow-hidden rounded-xl border ${toneClass}`}>
      <div className="flex items-center gap-2 border-b border-current/10 px-2.5 py-1.5">
        <Icon className="h-3.5 w-3.5" />
        <figcaption className="min-w-0 flex-1 truncate text-[9px] font-bold">{label} · {name}</figcaption>
        {size && <span className="text-[8px] opacity-70">{size}</span>}
      </div>
      <div className="bg-black/[0.03]">{children}</div>
    </figure>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
