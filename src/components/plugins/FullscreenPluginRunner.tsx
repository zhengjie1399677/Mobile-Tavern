import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { createPluginRuntimeDocument, type InstalledFullscreenPlugin, type PluginOrientation, type PluginRuntimeDocument } from "../../domain/plugins";
import { deletePluginData, loadPluginData, savePluginData } from "../../infrastructure/plugins/pluginStorage";
import { useUnifiedApp } from "../../UnifiedAppContext";
import type { IChatStreamService, StreamChunk } from "../../kernel/types";

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
  const { settings, getKernelService } = useUnifiedApp((state) => ({
    settings: state.settings,
    getKernelService: state.getKernelService,
  }));
  const pendingStreamsRef = useRef<Map<string, AbortController>>(new Map());

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
      if (typeof message.requestId !== "string") return;
      // 流式取消
      if (message.type === "cancel") {
        const controller = pendingStreamsRef.current.get(message.requestId);
        if (controller) { controller.abort(); pendingStreamsRef.current.delete(message.requestId); }
        return;
      }
      // 流式请求
      if (message.type === "stream-request") {
        if (typeof message.method !== "string") return;
        logPluginDiagnostic(`stream-request plugin=${plugin.id} method=${message.method}`);
        void handleStreamRequest(event.source, message.requestId, message.method, message.params)
          .catch((reason) => streamError(event.source, channel, message.requestId, normalizeError(reason)));
        return;
      }
      // 常规请求
      if (typeof message.method !== "string") return;
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
      // abort 所有 pending 流式请求，防止 Blob URL 释放后流式回调访问已销毁 iframe
      pendingStreamsRef.current.forEach((c) => c.abort());
      pendingStreamsRef.current.clear();
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
    if (method === "llm.chat") {
      checkPermission(plugin.manifest.permissions, method);
      const messages = sanitizeMessages(record.messages);
      const api = settings.api;
      if (!api.apiKey || !api.apiKey.trim()) throw new Error("PLUGIN_LLM_NOT_CONFIGURED");
      const reqBody = buildReqBody(record, plugin.manifest, settings, messages);
      const chatStreamService = getKernelService<IChatStreamService>("chatStream");
      const controller = new AbortController();
      try {
        const stream = chatStreamService.streamLlmResponse({
          baseUrl: api.baseUrl, apiKey: api.apiKey, chatPath: api.chatPath,
          bypassProxy: api.bypassProxy, disableReasoning: api.disableReasoning,
          forceBasicParams: api.forceBasicParams, reqBody, signal: controller.signal,
        });
        let fullText = "";
        for await (const chunk of stream) {
          fullText += extractChunkText(chunk);
        }
        return { text: fullText };
      } finally {
        controller.abort();
      }
    }
    if (method === "llm.listPresets") {
      checkPermission(plugin.manifest.permissions, method);
      return { syncPreset: plugin.manifest.llm?.syncPreset ?? false };
    }
    throw new Error("PLUGIN_METHOD_NOT_ALLOWED");
  }

  async function handleStreamRequest(source: MessageEventSource | null, requestId: string, method: string, params: unknown): Promise<void> {
    checkPermission(plugin.manifest.permissions, method);
    if (method !== "llm.chatStream") throw new Error("PLUGIN_METHOD_NOT_ALLOWED");
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const messages = sanitizeMessages(record.messages);
    const api = settings.api;
    if (!api.apiKey || !api.apiKey.trim()) throw new Error("PLUGIN_LLM_NOT_CONFIGURED");
    const reqBody = buildReqBody(record, plugin.manifest, settings, messages);
    const controller = new AbortController();
    pendingStreamsRef.current.set(requestId, controller);
    try {
      const chatStreamService = getKernelService<IChatStreamService>("chatStream");
      const stream = chatStreamService.streamLlmResponse({
        baseUrl: api.baseUrl, apiKey: api.apiKey, chatPath: api.chatPath,
        bypassProxy: api.bypassProxy, disableReasoning: api.disableReasoning,
        forceBasicParams: api.forceBasicParams, reqBody, signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        const text = extractChunkText(chunk);
        if (text) streamChunk(source, channel, requestId, text);
      }
      if (!controller.signal.aborted) streamDone(source, channel, requestId);
    } catch (err) {
      if (!controller.signal.aborted) streamError(source, channel, requestId, normalizeError(err));
    } finally {
      pendingStreamsRef.current.delete(requestId);
    }
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

function streamChunk(target: MessageEventSource | null, channel: string, requestId: string, chunk: string): void {
  if (!target || !("postMessage" in target)) return;
  (target as WindowProxy).postMessage({ mtPlugin: 1, channel, type: "stream", requestId, chunk }, "*");
}

function streamDone(target: MessageEventSource | null, channel: string, requestId: string): void {
  if (!target || !("postMessage" in target)) return;
  (target as WindowProxy).postMessage({ mtPlugin: 1, channel, type: "stream", requestId, done: true }, "*");
}

function streamError(target: MessageEventSource | null, channel: string, requestId: string, error: string): void {
  if (!target || !("postMessage" in target)) return;
  (target as WindowProxy).postMessage({ mtPlugin: 1, channel, type: "stream", requestId, error }, "*");
}

function checkPermission(permissions: string[] | undefined, method: string): void {
  if (!method.startsWith("llm.")) return;
  if (!(permissions ?? []).includes(method)) throw new Error("PLUGIN_PERMISSION_DENIED");
}

function sanitizeMessages(messages: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("PLUGIN_LLM_INVALID_MESSAGES");
  return messages.map((m) => {
    if (!m || typeof m !== "object") throw new Error("PLUGIN_LLM_INVALID_MESSAGES");
    const role = (m as Record<string, unknown>).role;
    const content = (m as Record<string, unknown>).content;
    if (typeof role !== "string" || typeof content !== "string") throw new Error("PLUGIN_LLM_INVALID_MESSAGES");
    return { role, content };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReqBody(record: Record<string, unknown>, manifest: any, settings: any, messages: Array<{ role: string; content: string }>): Record<string, unknown> {
  const base: Record<string, unknown> = { model: settings.api?.modelName || "gpt-3.5-turbo", stream: true, messages };
  if (manifest.llm?.syncPreset) {
    const p = settings.preset ?? {};
    return {
      ...base,
      temperature: p.temperature, top_p: p.topP, top_k: p.topK, min_p: p.minP,
      max_tokens: p.maxTokens, presence_penalty: p.presencePenalty ?? 0,
      frequency_penalty: p.frequencyPenalty ?? 0, repetition_penalty: p.repetitionPenalty ?? 1,
    };
  }
  // syncPreset=false：合并插件自管采样参数（白名单字段）
  const sampling = record.sampling;
  if (sampling && typeof sampling === "object") {
    const ALLOWED = ["temperature", "top_p", "top_k", "min_p", "max_tokens", "presence_penalty", "frequency_penalty"];
    for (const k of ALLOWED) {
      if (k in sampling) base[k] = (sampling as Record<string, unknown>)[k];
    }
  }
  return base;
}

function extractChunkText(chunk: StreamChunk): string {
  if (chunk.__rescuedContent) return chunk.__rescuedContent;
  if (chunk.content) return chunk.content;
  return chunk.choices?.[0]?.delta?.content ?? "";
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
