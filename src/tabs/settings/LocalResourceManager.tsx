import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Copy, Eye, FileAudio, FileImage, FileVideo, Loader2, Palette, Trash2, Upload } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { KernelServices, type ILocalResourceService } from "../../application/serviceContracts";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import { useTranslation } from "../../contexts/LanguageContext";

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

  const getService = useCallback(
    () => getKernelService<ILocalResourceService>(KernelServices.LocalResources),
    [getKernelService],
  );
  const refresh = useCallback(async () => setResources(await getService().listResources()), [getService]);

  useEffect(() => {
    let active = true;
    getService().listResources()
      .then(async nextResources => {
        if (!active) return;
        setResources(nextResources);
        const entries = await Promise.all(nextResources
          .filter(resource => resource.kind === "image")
          .map(async resource => [resource.id, await getService().getObjectUrl(resource.id)] as const));
        if (active) setPreviewUrls(Object.fromEntries(entries));
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
    try {
      for (const file of files) await getService().importFile(file);
      await refresh();
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

  const copyReference = async (resource: LocalResourceMetadata, format: "resource" | "css") => {
    try {
      if (format === "css") await getService().getObjectUrl(resource.id);
      const reference = format === "css"
        ? getService().getCssReference(resource.id)
        : getService().getResourceReference(resource.id);
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(reference);
      await showCustomAlert(t("local_resources.copy_success", { reference }), t("local_resources.copy_success_title"));
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

  return (
    <section data-ui="local-resource-manager" className="rounded-xl border border-border/60 bg-card/35 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-foreground">{t("local_resources.title")}</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("local_resources.description")}</p>
        </div>
        <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold text-primary active:scale-95">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {t("local_resources.import")}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/*,audio/*" className="hidden" disabled={busy} onChange={event => void handleImport(event)} />
        </label>
      </div>

      {resources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10px] text-muted-foreground">{t("local_resources.empty")}</div>
      ) : (
        <div className="space-y-2">
          {resources.map(resource => {
            const previewUrl = previewUrls[resource.id];
            const ResourceIcon = resource.kind === "image" ? FileImage : resource.kind === "video" ? FileVideo : FileAudio;
            const resourceReference = getService().getResourceReference(resource.id);
            return (
              <article key={resource.id} data-resource-id={resource.id} className="overflow-hidden rounded-lg border border-border/50 bg-background/45">
                {resource.kind === "image" && previewUrl && <img src={previewUrl} alt="" loading="lazy" decoding="async" className="h-28 w-full object-cover" />}
                {resource.kind === "video" && previewUrl && <video src={previewUrl} controls preload="metadata" className="max-h-44 w-full bg-black" />}
                {resource.kind === "audio" && previewUrl && <audio src={previewUrl} controls preload="metadata" className="w-full px-2 pt-2" />}
                <div className="flex items-center gap-2 p-2.5">
                  <ResourceIcon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-foreground">{resource.name}</p>
                    <p className="text-[8px] text-muted-foreground">{resource.kind} · {formatBytes(resource.size)}</p>
                    <code className="block max-w-full select-all truncate text-[8px] text-primary/80">{resourceReference}</code>
                    {resource.kind === "image" && (
                      <code className="block max-w-full select-all truncate text-[8px] text-primary/65">CSS: {getService().getCssReference(resource.id)}</code>
                    )}
                  </div>
                  {!previewUrl && resource.kind !== "image" && (
                    <button type="button" onClick={() => void loadPreview(resource)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground" aria-label={t("local_resources.preview")}>
                      {loadingPreviewId === resource.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <button type="button" onClick={() => void copyReference(resource, "resource")} className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 text-primary" aria-label={t("local_resources.copy_reference")}><Copy className="h-3.5 w-3.5" /></button>
                  {resource.kind === "image" && (
                    <button type="button" onClick={() => void copyReference(resource, "css")} className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 text-primary" aria-label={t("local_resources.copy_css_reference")}><Palette className="h-3.5 w-3.5" /></button>
                  )}
                  <button type="button" onClick={() => void removeResource(resource)} className="flex h-8 w-8 items-center justify-center rounded-md border border-destructive/25 text-destructive" aria-label={t("local_resources.delete")}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </article>
            );
          })}
        </div>
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
