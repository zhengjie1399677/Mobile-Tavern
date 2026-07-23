import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { createPluginRuntimeDocument, type InstalledFullscreenPlugin, type PluginOrientation, type PluginRuntimeDocument } from "../../domain/plugins";
import { deletePluginData, loadPluginData, savePluginData } from "../../infrastructure/plugins/pluginStorage";

const STARTUP_EXIT_GUARD_MS = 2_000;
const RUNNING_PLUGIN_SESSION_KEY = "mobile-tavern.running-fullscreen-plugin";

interface AndroidPluginBridgeWindow extends Window {
  AndroidThemeBridge?: {
    setScreenOrientation?: (mode: PluginOrientation) => boolean;
    setImmersiveMode?: (enabled: boolean) => boolean;
    logPluginDiagnostic?: (message: string) => void;
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
  const [runtime, setRuntime] = useState<PluginRuntimeDocument>();
  const [runtimeError, setRuntimeError] = useState<string>();
  const [error, setError] = useState<string>();
  const loadedRef = useRef(false);
  const exitEnabledRef = useRef(false);

  // runtime 生成与生命周期拆分：本 effect 仅负责 Blob URL 的异步构造与释放，
  // 不介入沉浸式/方向/消息监听，避免 runtime 变化触发生命周期 effect 重订阅。
  useEffect(() => {
    let cancelled = false;
    let pendingDoc: PluginRuntimeDocument | undefined;
    setRuntime(undefined);
    setRuntimeError(undefined);
    createPluginRuntimeDocument(plugin, channel)
      .then((doc) => {
        if (cancelled) {
          doc.revoke();
        } else {
          pendingDoc = doc;
          setRuntime(doc);
        }
      })
      .catch((reason) => {
        if (!cancelled) setRuntimeError(normalizeError(reason));
      });
    return () => {
      cancelled = true;
      // cleanup 时若 doc 已生成则立即释放，避免 Blob URL 泄漏；未生成则由 then 分支看到 cancelled 自行 revoke。
      if (pendingDoc) pendingDoc.revoke();
    };
  }, [plugin, channel]);

  useEffect(() => {
    const orientation = plugin.manifest.orientation ?? "auto";
    logPluginDiagnostic(`mount plugin=${plugin.id} orientation=${orientation}`);
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
      logPluginDiagnostic(`request plugin=${plugin.id} method=${message.method}`);
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
      logPluginDiagnostic(`cleanup plugin=${plugin.id}`);
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(enableExitTimer);
      exitEnabledRef.current = false;
      const resumeAfterConfiguration = readRunningPluginId() === plugin.id;
      logPluginDiagnostic(`cleanup-resume plugin=${plugin.id} value=${resumeAfterConfiguration}`);
      if (!resumeAfterConfiguration) {
        setImmersiveMode(false);
        setOrientation("auto");
      }
    };
  }, [channel, plugin]);

  const handleLoad = () => {
    logPluginDiagnostic(`iframe-load plugin=${plugin.id} repeated=${loadedRef.current}`);
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
        <button type="button" onClick={() => {
          logPluginDiagnostic(`close-click plugin=${plugin.id} enabled=${exitEnabledRef.current}`);
          if (exitEnabledRef.current) onExit();
        }} aria-label="退出插件" className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur active:scale-95">
          <X className="h-5 w-5" />
        </button>
      </header>
      {runtimeError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-semibold">插件运行已停止</p>
          <p className="max-w-md text-xs text-white/65">{runtimeError}</p>
          <button type="button" onClick={onExit} className="min-h-10 rounded-xl bg-white px-4 text-xs font-bold text-black">返回 Mobile Tavern</button>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-semibold">插件运行已停止</p>
          <p className="max-w-md text-xs text-white/65">{error}</p>
          <button type="button" onClick={onExit} className="min-h-10 rounded-xl bg-white px-4 text-xs font-bold text-black">返回 Mobile Tavern</button>
        </div>
      ) : runtime ? (
        <iframe
          ref={iframeRef}
          title={plugin.manifest.name}
          src={runtime.url}
          sandbox="allow-scripts"
          allow="autoplay"
          onLoad={handleLoad}
          className="h-full w-full flex-1 border-0 bg-black"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/70">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-xs">正在准备插件运行环境…</p>
        </div>
      )}
    </section>
  );

  async function handleRequest(pluginId: string, method: string, params: unknown): Promise<unknown> {
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    if (method === "host.ready") return { apiVersion: 1 };
    if (method === "host.exit") {
      if (!exitEnabledRef.current) {
        logPluginDiagnostic(`exit-blocked plugin=${plugin.id}`);
        throw new Error("PLUGIN_EXIT_NOT_READY");
      }
      logPluginDiagnostic(`exit-accepted plugin=${plugin.id}`);
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

function logPluginDiagnostic(message: string): void {
  try {
    (window as AndroidPluginBridgeWindow).AndroidThemeBridge?.logPluginDiagnostic?.(message);
  } catch {
    // 诊断能力不可用时不影响插件运行。
  }
}

function readRunningPluginId(): string | undefined {
  try {
    return window.sessionStorage.getItem(RUNNING_PLUGIN_SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : "PLUGIN_HOST_ERROR";
}
