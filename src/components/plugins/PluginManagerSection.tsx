import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, HardDriveDownload, Loader2, Play, Trash2, Upload } from "lucide-react";
import { parseFullscreenPluginPackage, type InstalledFullscreenPlugin } from "../../domain/plugins";
import { deletePlugin, installPlugin, listInstalledPlugins } from "../../infrastructure/plugins/pluginStorage";
import { listBuiltinPlugins } from "../../infrastructure/plugins/builtinPlugins";
import { useTranslation } from "../../contexts/LanguageContext";
import { useUnifiedApp } from "../../UnifiedAppContext";
import FullscreenPluginRunner from "./FullscreenPluginRunner";

export default function PluginManagerSection() {
  const { t } = useTranslation();
  const { showCustomAlert, showCustomConfirm } = useUnifiedApp((state) => ({
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
  }));
  const [plugins, setPlugins] = useState<InstalledFullscreenPlugin[]>([]);
  const [running, setRunning] = useState<InstalledFullscreenPlugin>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const packagedBuiltins = listBuiltinPlugins();
    setPlugins(packagedBuiltins);
    const installed = await listInstalledPlugins();
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const builtins = packagedBuiltins.map((plugin) => installedById.get(plugin.id) ?? plugin);
    const builtinIds = new Set(builtins.map((plugin) => plugin.id));
    setPlugins([...builtins, ...installed.filter((plugin) => !builtinIds.has(plugin.id))]);
  }, []);

  useEffect(() => {
    void reload().catch((error) => {
      showCustomAlert(t("plugin_manager.storage_failed", { error: normalizeError(error) }), t("plugin_manager.title"));
    });
  }, [reload, showCustomAlert, t]);

  const handleImport = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const parsed = parseFullscreenPluginPackage(await file.arrayBuffer());
      const previous = plugins.find((item) => item.id === parsed.id);
      await installPlugin({ ...parsed, installedAt: previous?.installedAt ?? parsed.installedAt });
      await reload();
      showCustomAlert(t("plugin_manager.install_success", { name: parsed.manifest.name }), t("plugin_manager.install_success_title"));
    } catch (error) {
      showCustomAlert(t("plugin_manager.install_failed", { error: normalizeError(error) }), t("plugin_manager.install_failed_title"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async (plugin: InstalledFullscreenPlugin) => {
    if (!await showCustomConfirm(t("plugin_manager.delete_confirm", { name: plugin.manifest.name }))) return;
    await deletePlugin(plugin.id);
    await reload();
  };

  return (
    <section className="rounded-xl border border-primary/25 bg-card/70 p-3 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Gamepad2 className="h-4.5 w-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold text-foreground">{t("plugin_manager.title")}</h2>
          <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">{t("plugin_manager.description")}</p>
        </div>
      </header>

      <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[9px] leading-relaxed text-amber-700 dark:text-amber-300">
        {t("plugin_manager.security_notice")}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".mtplugin,application/zip"
        className="hidden"
        aria-label={t("plugin_manager.file_label")}
        onChange={(event) => void handleImport(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold text-primary active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {t(busy ? "plugin_manager.installing" : "plugin_manager.import")}
      </button>

      <div className="mt-3 space-y-2">
        {plugins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-5 text-center text-muted-foreground">
            <HardDriveDownload className="h-6 w-6 opacity-60" />
            <p className="text-[10px]">{t("plugin_manager.empty")}</p>
          </div>
        ) : plugins.map((plugin) => (
          <article key={plugin.id} className="flex items-center gap-2 rounded-xl border border-border bg-background/80 p-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <div className="truncate text-xs font-semibold">{plugin.manifest.name}</div>
                {plugin.builtin && <span className="shrink-0 text-[8px] text-primary/70">{t("plugin_manager.builtin")}</span>}
              </div>
              <div className="mt-0.5 truncate font-mono text-[8.5px] text-muted-foreground">{plugin.id} · v{plugin.manifest.version}</div>
              {plugin.manifest.description && <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted-foreground">{plugin.manifest.description}</p>}
            </div>
            <button type="button" onClick={() => setRunning(plugin)} aria-label={t("plugin_manager.run_named", { name: plugin.manifest.name })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary active:scale-95"><Play className="h-4 w-4" /></button>
            {!plugin.builtin && <button type="button" onClick={() => void handleDelete(plugin)} aria-label={t("plugin_manager.delete_named", { name: plugin.manifest.name })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 text-destructive active:scale-95"><Trash2 className="h-4 w-4" /></button>}
          </article>
        ))}
      </div>

      {running && <FullscreenPluginRunner plugin={running} onExit={() => setRunning(undefined)} />}
    </section>
  );
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
