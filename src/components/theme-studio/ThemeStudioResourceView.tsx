import React, { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FileAudio,
  FileImage,
  FileVideo,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import type { LocalResourceKind, LocalResourceMetadata } from "../../domain/resources/types";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";
import { extractMediaFilesFromZip } from "../../domain/themes/themeZipPackage";

export interface ThemeStudioResourceViewProps {
  resourcePort: ThemeStudioResourcePort | undefined;
  onInsertCode?: (code: string) => void;
  showCustomAlert?: (msg: string, title?: string) => Promise<void>;
  showCustomConfirm?: (msg: string, title?: string) => Promise<boolean>;
  embedded?: boolean;
  onClose?: () => void;
}

export function ThemeStudioResourceView({
  resourcePort,
  onInsertCode,
  showCustomAlert,
  showCustomConfirm,
  embedded = false,
  onClose,
}: ThemeStudioResourceViewProps) {
  const [resources, setResources] = useState<LocalResourceMetadata[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [filterKind, setFilterKind] = useState<"all" | LocalResourceKind>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  const loadResources = useCallback(async () => {
    if (!resourcePort) return;
    setIsLoading(true);
    try {
      const list = await resourcePort.listResources();
      setResources(list);

      // 异步读取图片预览 URL（仅针对图片类型优先读取，音视频支持按需加载）
      const imageEntries = await Promise.all(
        list
          .filter(r => r.kind === "image")
          .map(async r => {
            try {
              const url = await resourcePort.getObjectUrl(r.id);
              return [r.id, url] as const;
            } catch {
              return null;
            }
          }),
      );
      const validEntries = imageEntries.filter((entry): entry is readonly [string, string] => entry !== null);
      setPreviewUrls(Object.fromEntries(validEntries));
    } catch (error) {
      console.error("[ThemeStudioResourceView] Load resources failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [resourcePort]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || !resourcePort) return;

    setIsLoading(true);
    let importedCount = 0;
    try {
      for (const file of files) {
        const isZip =
          file.name.toLowerCase().endsWith(".zip") ||
          file.type === "application/zip" ||
          file.type === "application/x-zip-compressed";

        if (isZip) {
          const mediaFiles = await extractMediaFilesFromZip(await file.arrayBuffer());
          for (const m of mediaFiles) {
            await resourcePort.importFile(m);
            importedCount++;
          }
        } else {
          await resourcePort.importFile(file);
          importedCount++;
        }
      }
      await loadResources();
      if (showCustomAlert) {
        await showCustomAlert(`成功导入 ${importedCount} 个素材并生成 5 位短 ID！`, "导入成功");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (showCustomAlert) {
        await showCustomAlert(`导入素材失败: ${msg}`, "导入失败");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (resource: LocalResourceMetadata) => {
    if (!resourcePort?.deleteResource) return;
    if (showCustomConfirm) {
      const confirmed = await showCustomConfirm(
        `确定删除本地素材「${resource.name}」吗？引用该短 ID 的 CSS 将无法加载对应资源。`,
        "删除素材",
      );
      if (!confirmed) return;
    }
    try {
      await resourcePort.deleteResource(resource.id);
      setPreviewUrls(prev => {
        const next = { ...prev };
        delete next[resource.id];
        return next;
      });
      await loadResources();
    } catch (error) {
      console.error("[ThemeStudioResourceView] Delete failed:", error);
    }
  };

  const copyText = async (text: string, id: string) => {
    let succeeded = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        succeeded = true;
      }
    } catch {}

    if (!succeeded) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        succeeded = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {}
    }

    if (succeeded) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const handleLoadMediaPreview = async (resource: LocalResourceMetadata) => {
    if (!resourcePort || previewUrls[resource.id]) return;
    setLoadingPreviewId(resource.id);
    try {
      const url = await resourcePort.getObjectUrl(resource.id);
      setPreviewUrls(prev => ({ ...prev, [resource.id]: url }));
    } catch {
      // 忽略预览加载错误
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const filteredResources = resources.filter(r => {
    if (filterKind === "all") return true;
    return r.kind === filterKind;
  });

  return (
    <div className={`flex flex-col ${embedded ? "rounded-xl border border-border bg-card p-3 space-y-3" : "h-full min-h-0"}`}>
      {/* 头部标题与操作 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <FolderOpen className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-foreground">本地素材库</h3>
              <span className="rounded bg-primary/15 px-1 py-0.2 text-[9px] font-bold text-primary font-mono">5位短ID</span>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              图片音视频自动生成短变量 <code className="text-primary font-mono">var(--res-xxxxx)</code>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <label className="flex h-7.5 cursor-pointer items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 transition-all active:scale-95">
            {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            <span>导入素材</span>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/*,audio/*,.zip,application/zip,application/x-zip-compressed"
              className="hidden"
              disabled={isLoading}
              onChange={event => void handleFileUpload(event)}
            />
          </label>

          {embedded ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setIsCollapsed(prev => !prev)}
              aria-label={isCollapsed ? "展开素材库" : "收起素材库"}
            >
              {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </Button>
          ) : onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onClose}
              aria-label="关闭素材库弹窗"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* 筛选标签条 */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  filterKind === "all" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFilterKind("all")}
              >
                全部 ({resources.length})
              </button>
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  filterKind === "image" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFilterKind("image")}
              >
                图片 ({resources.filter(r => r.kind === "image").length})
              </button>
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  filterKind === "audio" || filterKind === "video"
                    ? "bg-primary/15 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFilterKind(filterKind === "audio" ? "all" : "audio")}
              >
                音视频 ({resources.filter(r => r.kind === "audio" || r.kind === "video").length})
              </button>
            </div>
            <span className="hidden sm:inline text-[10px] text-muted-foreground">
              支持直接复制变量或插入 CSS
            </span>
          </div>

          {/* 素材卡片列表 */}
          <div className={`overflow-y-auto custom-scrollbar ${embedded ? "max-h-72" : "flex-1 p-1 min-h-[16rem]"}`}>
            {isLoading && resources.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-xs">加载素材中...</span>
              </div>
            ) : filteredResources.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 text-center text-muted-foreground">
                <Upload className="size-7 opacity-40" />
                <p className="text-xs font-medium">暂无本地素材</p>
                <p className="text-[10px] opacity-70">点击上方「导入素材」上传图片、音视频或 ZIP 包</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredResources.map(resource => {
                  const shortCode = resource.id.replace(/^r_/, "");
                  const shortCssVar = `var(--res-${shortCode})`;
                  const fullCssVar = `var(--tavern-resource-${resource.id})`;
                  const resourceUri = `tavern-resource://${resource.id}`;
                  const previewUrl = previewUrls[resource.id];
                  const isCopied = copiedId === resource.id;

                  return (
                    <div
                      key={resource.id}
                      className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/50 p-2.5 shadow-xs hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        {/* 缩略图或媒体类型图标 */}
                        <div className="size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40 flex items-center justify-center">
                          {resource.kind === "image" && previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={resource.name}
                              loading="lazy"
                              decoding="async"
                              className="size-full object-cover"
                            />
                          ) : resource.kind === "video" ? (
                            <FileVideo className="size-5 text-purple-400" />
                          ) : resource.kind === "audio" ? (
                            <FileAudio className="size-5 text-emerald-400" />
                          ) : (
                            <FileImage className="size-5 text-muted-foreground" />
                          )}
                        </div>

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
                            <span>{(resource.size / 1024).toFixed(1)} KB</span>
                          </div>
                          <code className="mt-0.5 block truncate font-mono text-[9px] text-primary/80 select-all" title={shortCssVar}>
                            {shortCssVar}
                          </code>
                        </div>

                        {/* 删除按钮 */}
                        {resourcePort?.deleteResource && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => void handleDelete(resource)}
                            title="删除此素材"
                            aria-label={`删除素材 ${resource.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>

                      {/* 音视频内联播放预览 */}
                      {previewUrl && resource.kind === "video" && (
                        <video src={previewUrl} controls preload="metadata" className="max-h-36 w-full rounded-md bg-black" />
                      )}
                      {previewUrl && resource.kind === "audio" && (
                        <audio src={previewUrl} controls preload="metadata" className="w-full pt-1" />
                      )}
                      {!previewUrl && (resource.kind === "audio" || resource.kind === "video") && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-full text-[10px] gap-1 text-muted-foreground border border-dashed border-border"
                          onClick={() => void handleLoadMediaPreview(resource)}
                        >
                          {loadingPreviewId === resource.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Eye className="size-3" />
                          )}
                          点击预览音视频
                        </Button>
                      )}

                      {/* 操作按钮栏 */}
                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6.5 px-2 text-[10px] gap-1 hover:bg-primary/10 hover:border-primary/40"
                          onClick={() => copyText(shortCssVar, resource.id)}
                          title="复制短 CSS 变量"
                        >
                          {isCopied ? (
                            <>
                              <Check className="size-3 text-emerald-400" />
                              <span className="text-emerald-400">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="size-3" />
                              <span>短变量</span>
                            </>
                          )}
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6.5 px-1.5 text-[10px] text-muted-foreground"
                          onClick={() => copyText(resourceUri, `${resource.id}-uri`)}
                          title="复制 tavern-resource:// 格式 URI"
                        >
                          {copiedId === `${resource.id}-uri` ? "已复制" : "URI"}
                        </Button>

                        {onInsertCode && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-6.5 px-2 text-[10px] gap-1 bg-primary/90 text-primary-foreground hover:bg-primary"
                            onClick={() => onInsertCode(shortCssVar)}
                            title="一键插入到 CSS 光标位置"
                          >
                            <Plus className="size-3" />
                            <span>插入 CSS</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
