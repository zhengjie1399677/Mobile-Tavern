import type {
  ToolPluginNetworkRequest,
  ToolPluginWorkerExecution,
  ToolPluginWorkerPort,
} from "../../application/toolPlugins/executionContracts";

type WorkerFactory = (sourceUrl: string) => Worker;

interface WorkerMessage {
  readonly type?: string;
  readonly id?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly request?: ToolPluginNetworkRequest;
}

export class BrowserToolPluginExecutor implements ToolPluginWorkerPort {
  private readonly workers = new Set<Worker>();

  constructor(private readonly factory: WorkerFactory = (url) => new Worker(url)) {}

  execute(request: ToolPluginWorkerExecution): Promise<unknown> {
    if (request.signal.aborted) return Promise.reject(request.signal.reason);
    const sourceUrl = URL.createObjectURL(new Blob([createWorkerSource(request.entryCode)], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = this.factory(sourceUrl); }
    finally { URL.revokeObjectURL(sourceUrl); }
    this.workers.add(worker);
    return new Promise((resolve, reject) => {
      let hostRequests = 0;
      const finish = (error?: unknown, result?: unknown) => {
        request.signal.removeEventListener("abort", onAbort);
        worker.terminate();
        this.workers.delete(worker);
        if (error !== undefined) reject(error);
        else resolve(result);
      };
      const onAbort = () => finish(request.signal.reason ?? new Error("TOOL_PLUGIN_WORKER_ABORTED"));
      request.signal.addEventListener("abort", onAbort, { once: true });
      worker.onerror = (event) => finish(new Error(event.message || "TOOL_PLUGIN_WORKER_FAILED"));
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "result") finish(undefined, message.result);
        else if (message.type === "error") finish(new Error(message.error || "TOOL_PLUGIN_WORKER_FAILED"));
        else if (message.type === "network" && message.id && message.request) {
          hostRequests += 1;
          if (hostRequests > request.maxRequests) {
            worker.postMessage({ type: "network.result", id: message.id, error: "TOOL_PLUGIN_NETWORK_QUOTA_EXCEEDED" });
            return;
          }
          void request.network(message.request).then(
            (result) => worker.postMessage({ type: "network.result", id: message.id, result }),
            (error: unknown) => worker.postMessage({ type: "network.result", id: message.id, error: normalizeError(error) }),
          );
        }
      };
      worker.postMessage({ type: "execute", exportName: request.exportName, input: request.input });
    });
  }

  getActiveWorkerCount(): number { return this.workers.size; }

  destroy(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.clear();
  }
}

function createWorkerSource(entryCode: string): string {
  return `"use strict";
const blocked = () => { throw new Error("TOOL_PLUGIN_WORKER_API_DENIED"); };
for (const name of ["fetch","XMLHttpRequest","WebSocket","EventSource","importScripts","Worker","SharedWorker","indexedDB","caches"]) {
  try { Object.defineProperty(globalThis, name, { value: blocked, configurable: false, writable: false }); } catch {}
}
try { Object.defineProperty(globalThis, "eval", { value: blocked, configurable: false, writable: false }); } catch {}
try { Object.defineProperty(globalThis, "Function", { value: blocked, configurable: false, writable: false }); } catch {}
const pending = new Map(); let sequence = 0;
const host = Object.freeze({ network(request) { const id = String(++sequence); postMessage({ type: "network", id, request }); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); } });
${entryCode}
const definition = globalThis.MobileTavernToolPlugin;
onmessage = async (event) => {
  const message = event.data;
  if (message.type === "network.result") { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(new Error(message.error)) : item.resolve(message.result); return; }
  if (message.type !== "execute") return;
  try {
    const handler = definition && definition.tools && definition.tools[message.exportName];
    if (typeof handler !== "function") throw new Error("TOOL_PLUGIN_WORKER_EXPORT_NOT_FOUND");
    const result = await handler(message.input, host);
    postMessage({ type: "result", result });
  } catch (error) { postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) }); }
};`;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
