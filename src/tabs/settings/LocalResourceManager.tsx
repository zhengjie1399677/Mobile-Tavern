import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  FileAudio,
  FileImage,
  FileVideo,
  FolderOpen,
  Loader2,
  Palette,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { Dialog, DialogContent } from "@/src/components/ui/dialog";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { KernelServices, type ILocalResourceService } from "../../application/serviceContracts";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import { useTranslation } from "../../contexts/LanguageContext";
import { extractMediaFilesFromZip } from "../../domain/themes/themeZipPackage";

const PAGE_SIZE = 24;

interface LocalResourceManagerProps {
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  showCustomConfirm: (message: string) => Promise<boolean>;
}

export default function LocalResourceManager({ showCustomAlert, showCustomConfirm }: LocalResourceManagerProps) {
  const { t } = useTranslation();
  const getKernelService = useUnifiedApp(state => state.getKernelService);
  const [resources, setResources] = useState<LocalResourceMetadata[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string>();
  const [filterKind, setFilterKind] = useState<"all" | "image" | "audio" | "video">("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; name: string } | null>(null);

  const getService = useCallback(
    () => getKernelService<ILocalResourceService>(KernelServices.LocalResources),
    [getKernelService],
  );
  const refresh = useCallback(async () => setResources(await getService().listResources()), [getService]);

  useEffect(() => {
    let active = true;
    getService().listResources()
      .then(nextResources => {
        if (!active) return;
        setResources(nextResources);
      })
      .catch(reason => {
        if (active) void showCustomAlert(normalizeResourceError(reason), t("local_resources.load_failed"));
      });
    return () => { active = false; };
  }, [getService, showCustomAlert, t]);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    let importedCount = 0;
    try {
      for (const file of files) {
        const isZip = file.name.toLowerCase().endsWith(".zip") ||
          file.type === "application/zip" ||
          file.type === "application/x-zip-compressed";

        if (isZip) {
          const mediaFiles = await extractMediaFilesFromZip(await file.arrayBuffer());
          for (const m of mediaFiles) {
            await getService().importFile(m);
            importedCount++;
          }
        } else {
          await getService().importFile(file);
          importedCount++;
        }
      }
      await refresh();
      if (files.some(f => f.name.toLowerCase().endsWith(".zip") || f.type.includes("zip"))) {
        await showCustomAlert(`成功从所选文件/压缩包中导入 ${importedCount} 个本地多媒体资源！`, "导入成功");
      }
    } catch (reason) {
      await showCustomAlert(normalizeResourceError(reason), t("local_resources.import_failed"));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (resource: LocalResourceMetadata) => {
    if (previewUrls[resource.id]) return;
    setLoadingPreviewId(resource.id);
    try {
      const url = await getService().getObjectUrl(resource.id);
      setPreviewUrls(current => ({ ...current, [resource.id]: url }));
    } catch (reason) {
      await showCustomAlert(normalizeResourceError(reason), t("local_resources.preview_failed"));
    } finally {
      setLoadingPreviewId(undefined);
    }
  };

  const copyReference = async (resource: LocalResourceMetadata, format: "resource" | "short-css") => {
    const key = `${resource.id}-${format}`;
    try {
      if (format === "short-css") await getService().getObjectUrl(resource.id);
      const reference = format === "short-css"
        ? (getService().getShortCssReference?.(resource.id) ?? getService().getCssReference(resource.id))
        : getService().getResourceReference(resource.id);

      let succeeded = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(reference);
          succeeded = true;
        } catch {}
      }

      if (!succeeded) {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = reference;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          succeeded = document.execCommand("copy");
          document.body.removeChild(textarea);
        } catch {}
      }

      if (!succeeded) throw new Error("CLIPBOARD_UNAVAILABLE");
      setCopiedId(key);
      setTimeout(() => setCopiedId(current => current === key ? null : current), 1500);
    } catch (reason) {
      await showCustomAlert(normalizeResourceError(reason), t("local_resources.copy_failed"));
    }
  };

  const removeResource = async (resource: LocalResourceMetadata) => {
    if (!await showCustomConfirm(t("local_resources.delete_confirm", { name: resource.name }))) return;
    await getService().deleteResource(resource.id);
    setPreviewUrls(current => {
      const next = { ...current };
      delete next[resource.id];
      return next;
    });
    await refresh();
  };

  const filteredResources = resources.filter(r => {
    if (filterKind === "all") return true;
    if (filterKind === "image") return r.kind === "image";
    return r.kind === "audio" || r.kind === "video";
  });

  const displayedResources = filteredResources.slice(0, visibleCount);
  const hasMore = filteredResources.length > visibleCount;

  return (
    <section data-ui="local-resource-manager" className="rounded-xl border border-border/60 bg-card/35 p-3 space-y-3">
      {/* 头部标题与导入 */}
      <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <FolderOpen className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-bold text-foreground">{t("local_resources.title")}</h4>
              <span className="rounded bg-primary/15 px-1 py-0.2 text-[9px] font-bold text-primary font-mono">5位短ID</span>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">{t("local_resources.description")}</p>
          </div>
        </div>
        <label className="flex h-7.5 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20 active:scale-95 transition-all">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span>{t("local_resources.import")}</span>
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/*,audio/*,.zip,application/zip,application/x-zip-compressed" className="hidden" disabled={busy} onChange={event => void handleImport(event)} />
        </label>
      </div>

      {/* 筛选标签条 */}
      {resources.length > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              filterKind === "all" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => { setFilterKind("all"); setVisibleCount(PAGE_SIZE); }}
          >
            全部 ({resources.length})
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              filterKind === "image" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => { setFilterKind("image"); setVisibleCount(PAGE_SIZE); }}
          >
            图片 ({resources.filter(r => r.kind === "image").length})
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              filterKind === "audio" || filterKind === "video"
                ? "bg-primary/15 text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => { setFilterKind(filterKind === "audio" ? "all" : "audio"); setVisibleCount(PAGE_SIZE); }}
          >
            音视频 ({resources.filter(r => r.kind === "audio" || r.kind === "video").length})
          </button>
        </div>
      )}

      {/* 资源列表区 */}
      {resources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10px] text-muted-foreground">
          {t("local_resources.empty")}
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10px] text-muted-foreground">
          当前分类下暂无资源
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {displayedResources.map(resource => {
              const previewUrl = previewUrls[resource.id];
              const shortCode = resource.id.replace(/^r_/, "");
              const shortCssRef = `var(--res-${shortCode})`;
              const isCopiedCss = copiedId === `${resource.id}-short-css`;
              const isCopiedUri = copiedId === `${resource.id}-resource`;

              return (
                <article
                  key={resource.id}
                  data-resource-id={resource.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/50 p-2.5 shadow-xs hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {/* 视口惰性加载的轻量缩略图 */}
                    <ResourceThumbnail
                      resource={resource}
                      getService={getService}
                      onClickZoom={url => setZoomedImage({ url, name: resource.name })}
                    />

                  {/* 资源元信息 */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground" title={resource.name}>
                      {resource.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono rounded bg-primary/10 px-1 py-0.2 font-bold text-primary">
                        {resource.id}
                      </span>
                      <span>·</span>
                      <span>{formatBytes(resource.size)}</span>
                    </div>
                    <code className="mt-0.5 block truncate font-mono text-[9px] text-primary/80 select-all" title={shortCssRef}>
                      {shortCssRef}
                    </code>
                  </div>

                  {/* 删除按钮 */}
                  <button
                    type="button"
                    onClick={() => void removeResource(resource)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors active:scale-95"
                    aria-label={t("local_resources.delete")}
                    title="删除此素材"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {/* 音视频内联播放预览 */}
                {previewUrl && resource.kind === "video" && (
                  <video src={previewUrl} controls preload="metadata" className="max-h-36 w-full rounded-md bg-black" />
                )}
                {previewUrl && resource.kind === "audio" && (
                  <audio src={previewUrl} controls preload="metadata" className="w-full pt-1" />
                )}
                {!previewUrl && (resource.kind === "audio" || resource.kind === "video") && (
                  <button
                    type="button"
                    className="flex h-6 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:bg-muted active:scale-98 transition-all"
                    onClick={() => void loadPreview(resource)}
                  >
                    {loadingPreviewId === resource.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Eye className="size-3" />
                    )}
                    点击预览音视频
                  </button>
                )}

                {/* 底部操作按钮栏 */}
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => void copyReference(resource, "short-css")}
                    className="flex h-6.5 px-2 items-center gap-1 rounded-md border border-primary/25 bg-primary/5 text-[10px] font-medium text-primary hover:bg-primary/15 transition-all active:scale-95"
                    title="复制短 CSS 变量 var(--res-xxxxx)"
                  >
                    {isCopiedCss ? (
                      <>
                        <Check className="size-3 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">已复制</span>
                      </>
                    ) : (
                      <>
                        <Palette className="size-3" />
                        <span>短变量</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void copyReference(resource, "resource")}
                    className="flex h-6.5 px-2 items-center gap-1 rounded-md border border-border text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95"
                    title="复制 tavern-resource:// 格式 URI"
                  >
                    {isCopiedUri ? (
                      <span className="text-emerald-400 font-semibold">已复制</span>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        <span>URI</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {hasMore && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              className="flex h-7.5 items-center gap-1.5 rounded-lg border border-border bg-card/60 px-3.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all shadow-xs"
            >
              <ChevronDown className="size-3.5" />
              <span>加载更多素材 (已展示 {displayedResources.length} / {filteredResources.length})</span>
            </button>
          </div>
        )}
      </div>
      )}

      {/* 图片点击放大预览弹窗 (Lightbox) */}
      {zoomedImage && (
        <Dialog open={!!zoomedImage} onOpenChange={open => { if (!open) setZoomedImage(null); }}>
          <DialogContent
            overlayClassName="z-[1400] bg-black/85 backdrop-blur-sm"
            className="z-[1400] max-w-[94vw] max-h-[92vh] p-3 sm:p-4 bg-background/95 border border-border/80 rounded-2xl shadow-2xl flex flex-col items-center justify-center gap-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex w-full items-center justify-between border-b border-border/50 pb-2 px-1">
              <span className="truncate text-xs font-semibold text-foreground max-w-[80vw]" title={zoomedImage.name}>
                {zoomedImage.name}
              </span>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all"
                aria-label="关闭预览"
              >
                <X className="size-4" />
              </button>
            </div>
            <div
              className="flex max-h-[78vh] w-full items-center justify-center overflow-auto rounded-xl bg-black/40 p-2 cursor-zoom-out"
              onClick={() => setZoomedImage(null)}
              title="点击任意位置关闭"
            >
              <img
                src={zoomedImage.url}
                alt={zoomedImage.name}
                decoding="async"
                className="max-h-[74vh] max-w-full rounded-lg object-contain select-none shadow-2xl transition-transform"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function normalizeResourceError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("LOCAL_RESOURCE_TYPE_UNSUPPORTED")) return "仅支持常见图片、视频与音频文件，SVG 和其他文件类型不开放。";
  if (message.includes("LOCAL_RESOURCE_SIZE_INVALID")) return "文件为空或超过大小限制：图片 20 MiB、音频 100 MiB、视频 256 MiB。";
  if (message.includes("LOCAL_RESOURCE_TOTAL_LIMIT")) return "本地界面资源总容量不能超过 512 MiB。";
  if (message.includes("CLIPBOARD_UNAVAILABLE")) return "当前 WebView 不支持写入剪贴板，请手动复制资源变量。";
  return message;
}

function ResourceThumbnail({
  resource,
  getService,
  onClickZoom,
}: {
  resource: LocalResourceMetadata;
  getService: () => ILocalResourceService;
  onClickZoom?: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (resource.kind !== "image") return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [resource.kind]);

  useEffect(() => {
    if (!inView || resource.kind !== "image") return;
    let active = true;
    getService()
      .getObjectUrl(resource.id)
      .then(loadedUrl => {
        if (active) setUrl(loadedUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inView, resource.id, resource.kind, getService]);

  return (
    <div
      ref={containerRef}
      className={`size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40 flex items-center justify-center ${
        resource.kind === "image" && url ? "cursor-pointer group relative" : ""
      }`}
      onClick={() => {
        if (resource.kind === "image" && url && onClickZoom) {
          onClickZoom(url);
        }
      }}
      title={resource.kind === "image" && url ? "点击放大查看图片" : undefined}
    >
      {resource.kind === "image" ? (
        url ? (
          <>
            <img
              src={url}
              alt={resource.name}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ZoomIn className="size-3.5 text-white drop-shadow-md" />
            </div>
          </>
        ) : (
          <div className="size-full animate-pulse bg-muted/60 flex items-center justify-center">
            <FileImage className="size-4 text-muted-foreground/35" />
          </div>
        )
      ) : resource.kind === "video" ? (
        <FileVideo className="size-5 text-purple-400" />
      ) : resource.kind === "audio" ? (
        <FileAudio className="size-5 text-emerald-400" />
      ) : (
        <FileImage className="size-5 text-muted-foreground" />
      )}
    </div>
  );
}
