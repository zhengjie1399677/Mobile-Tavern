import React from "react";
import { FileText } from "lucide-react";
import type { IAttachmentService } from "../../../application/serviceContracts";
import type { MessageContentPart } from "../../../domain/messages/messageContent";
import { useUnifiedApp } from "../../../UnifiedAppContext";

interface MessageAttachmentPartsProps {
  parts: readonly MessageContentPart[];
}

export function MessageAttachmentParts({ parts }: MessageAttachmentPartsProps): React.JSX.Element | null {
  const getKernelService = useUnifiedApp(state => state.getKernelService);
  const attachmentParts = React.useMemo(
    () => parts.filter(part => part.type !== "text"),
    [parts],
  );
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [missingIds, setMissingIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let active = true;
    if (attachmentParts.length === 0) return () => { active = false; };
    const service = getKernelService<IAttachmentService>("attachments");
    void Promise.all(attachmentParts.map(async part => {
      try {
        return [part.assetId, await service.getObjectUrl(part.assetId)] as const;
      } catch {
        if (active) setMissingIds(current => new Set(current).add(part.assetId));
        return null;
      }
    })).then(entries => {
      if (!active) return;
      setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
    });
    return () => { active = false; };
  }, [attachmentParts, getKernelService]);

  if (attachmentParts.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 max-w-full" aria-label="消息附件">
      {attachmentParts.map((part, index) => {
        const url = urls[part.assetId];
        if (missingIds.has(part.assetId)) {
          return <div key={`${part.assetId}-${index}`} className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">附件不可用</div>;
        }
        if (!url) {
          return <div key={`${part.assetId}-${index}`} className="h-20 rounded-lg bg-muted/60 animate-pulse" />;
        }
        if (part.type === "image") {
          return (
            <img
              key={`${part.assetId}-${index}`}
              src={url}
              alt={part.alt || "消息图片"}
              loading="lazy"
              className="max-h-80 max-w-full rounded-xl object-contain border border-border/50 bg-black/5"
            />
          );
        }
        if (part.type === "audio") {
          return <audio key={`${part.assetId}-${index}`} src={url} controls preload="metadata" className="max-w-full" />;
        }
        if (part.type === "video") {
          return <video key={`${part.assetId}-${index}`} src={url} controls preload="metadata" className="max-h-80 max-w-full rounded-xl bg-black" />;
        }
        return (
          <a
            key={`${part.assetId}-${index}`}
            href={url}
            download={part.displayName}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs hover:bg-muted"
          >
            <FileText className="w-4 h-4" />
            <span className="truncate">{part.displayName}</span>
          </a>
        );
      })}
    </div>
  );
}
