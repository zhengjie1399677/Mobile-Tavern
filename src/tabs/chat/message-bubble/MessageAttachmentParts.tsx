import React from "react";
import { AudioLines, FileText, ImageIcon, Pause, Play, Video } from "lucide-react";
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
            <AudioVoicePlayer
              key={`${part.assetId}-${index}`}
              url={asset.url}
              name={name}
              size={size}
              isModelInput={isModelInput}
            />
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

interface AudioVoicePlayerProps {
  url: string;
  name: string;
  size: string | null;
  isModelInput: boolean;
}

const VOICE_WAVE_BARS = [6, 12, 18, 14, 10, 16, 22, 15, 8, 14, 20, 16, 10, 18, 12, 8, 14, 6];

function AudioVoicePlayer({ url, name, size, isModelInput }: AudioVoicePlayerProps): React.JSX.Element {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5 rounded-2xl bg-muted/40 p-2.5 transition-all">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onDurationChange={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "暂停" : "播放"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95 hover:brightness-105"
        >
          {isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className="font-semibold text-primary/90">
              {isModelInput ? "语音输入" : "音频"}
            </span>
            <span className="font-mono text-muted-foreground/80">
              {formatAudioDuration(isPlaying ? currentTime : duration || 0)}
            </span>
          </div>
          {/* 可交互波形轨道（无内边框） */}
          <div
            className="flex h-6 w-full cursor-pointer items-center gap-0.5 py-1"
            onClick={handleSeek}
            title="点击快进/快退"
          >
            {VOICE_WAVE_BARS.map((h, i) => {
              const barRatio = i / (VOICE_WAVE_BARS.length - 1);
              const isPassed = barRatio <= progressRatio;
              return (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-colors ${
                    isPassed
                      ? "bg-primary"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  style={{ height: `${h}px` }}
                />
              );
            })}
          </div>
        </div>
      </div>
      {(name || size) && (
        <div className="flex items-center justify-between px-1 text-[9px] text-muted-foreground/70">
          <span className="max-w-[180px] truncate">{name}</span>
          {size && <span>{size}</span>}
        </div>
      )}
    </div>
  );
}

function formatAudioDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds) || !Number.isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
