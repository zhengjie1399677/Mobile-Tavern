import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { createPluginRuntimeDocument, type InstalledFullscreenPlugin, type PluginOrientation } from "../../domain/plugins";
import { deletePluginData, loadPluginData, savePluginData } from "../../infrastructure/plugins/pluginStorage";

const STARTUP_EXIT_GUARD_MS = 2_000;

interface AndroidPluginBridgeWindow extends Window {
  AndroidThemeBridge?: {
    setScreenOrientation?: (mode: PluginOrientation) => boolean;
    setImmersiveMode?: (enabled: boolean) => boolean;
  };
}

export default function FullscreenPluginRunner({
  plugin,
  onExit,
}: {
  plugin: InstalledFullscreenPlugin;
  onExit: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channel = useMemo(() => crypto.randomUUID(), []);
  const runtime = useMemo(() => createPluginRuntimeDocument(plugin, channel), [plugin, channel]);
  const [error, setError] = useState<string>();
  const loadedRef = useRef(false);
  const exitEnabledRef = useRef(false);

  useEffect(() => {
    const orientation = plugin.manifest.orientation ?? "auto";
    setOrientation(orientation);
    setImmersiveMode(true);
    // Android 在方向切换期间可能把启动按钮的尾随触摸传递给刚创建的 iframe。
    // 内置游戏的“离开”按钮若收到该触摸会立即请求退出，因此仅在稳定后接受该请求。
    const enableExitTimer = window.setTimeout(() => {
      exitEnabledRef.current = true;
    }, STARTUP_EXIT_GUARD_MS);
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.mtPlugin !== 1 || message.channel !== channel || message.pluginId !== plugin.id) return;
      if (typeof message.requestId !== "string" || typeof message.method !== "string") return;
      void handleRequest(plugin.id, message.method, message.params)
        .then((result) => respond(event.source, channel, message.requestId, true, result))
        .catch((reason) => respond(event.source, channel, message.requestId, false, undefined, normalizeError(reason)));
    };
    const handleVisibility = () => {
      iframeRef.current?.contentWindow?.postMessage({
        mtPlugin: 1,
        channel,
        type: "lifecycle",
        event: document.hidden ? "pause" : "resume",
      }, "*");
    };
    window.addEventListener("message", handleMessage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(enableExitTimer);
      exitEnabledRef.current = false;
      setImmersiveMode(false);
      setOrientation("auto");
      runtime.revoke();
    };
  }, [channel, plugin, runtime]);

  const handleLoad = () => {
    if (loadedRef.current) {
      setError("插件尝试离开本地入口，运行已终止。");
      return;
    }
    loadedRef.current = true;
  };

  return (
    <section className="fixed inset-0 z-[200] flex flex-col bg-black" aria-label={`插件：${plugin.manifest.name}`}>
      <header className="absolute inset-x-0 top-0 z-10 flex min-h-12 items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-3 pt-[env(safe-area-inset-top)] pointer-events-none">
        <span className="max-w-[70%] truncate text-xs font-semibold text-white/80">{plugin.manifest.name}</span>
        <button type="button" onClick={() => exitEnabledRef.current && onExit()} aria-label="退出插件" className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur active:scale-95">
          <X className="h-5 w-5" />
        </button>
      </header>
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-semibold">插件运行已停止</p>
          <p className="max-w-md text-xs text-white/65">{error}</p>
          <button type="button" onClick={onExit} className="min-h-10 rounded-xl bg-white px-4 text-xs font-bold text-black">返回 Mobile Tavern</button>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title={plugin.manifest.name}
          src={runtime.url}
          sandbox="allow-scripts"
          allow="autoplay"
          onLoad={handleLoad}
          className="h-full w-full flex-1 border-0 bg-black"
        />
      )}
    </section>
  );

  async function handleRequest(pluginId: string, method: string, params: unknown): Promise<unknown> {
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    if (method === "host.ready") return { apiVersion: 1 };
    if (method === "host.exit") {
      if (!exitEnabledRef.current) throw new Error("PLUGIN_EXIT_NOT_READY");
      onExit();
      return null;
    }
    if (method === "host.orientation") {
      if (record.orientation !== "portrait" && record.orientation !== "landscape" && record.orientation !== "auto") {
        throw new Error("PLUGIN_ORIENTATION_INVALID");
      }
      setOrientation(record.orientation);
      return null;
    }
    if (method === "storage.save") {
      if (typeof record.slot !== "string") throw new Error("PLUGIN_SAVE_INVALID_SLOT");
      await savePluginData(pluginId, record.slot, record.data);
      return null;
    }
    if (method === "storage.load") {
      if (typeof record.slot !== "string") throw new Error("PLUGIN_SAVE_INVALID_SLOT");
      return loadPluginData(pluginId, record.slot);
    }
    if (method === "storage.delete") {
      if (typeof record.slot !== "string") throw new Error("PLUGIN_SAVE_INVALID_SLOT");
      await deletePluginData(pluginId, record.slot);
      return null;
    }
    throw new Error("PLUGIN_METHOD_NOT_ALLOWED");
  }
}

function respond(
  target: MessageEventSource | null,
  channel: string,
  requestId: string,
  ok: boolean,
  result?: unknown,
  error?: string
) {
  if (!target || !("postMessage" in target)) return;
  (target as WindowProxy).postMessage({ mtPlugin: 1, channel, type: "response", requestId, ok, result, error }, "*");
}

function setOrientation(orientation: PluginOrientation): void {
  try {
    (window as AndroidPluginBridgeWindow).AndroidThemeBridge?.setScreenOrientation?.(orientation);
  } catch {
    // 浏览器和不支持方向桥接的平台保持当前方向。
  }
}

function setImmersiveMode(enabled: boolean): void {
  try {
    (window as AndroidPluginBridgeWindow).AndroidThemeBridge?.setImmersiveMode?.(enabled);
  } catch {
    // 浏览器和不支持沉浸式桥接的平台保持系统栏现状。
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : "PLUGIN_HOST_ERROR";
}
