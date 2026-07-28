import type { IKernel, IKernelService } from "../types";
import { KernelServices } from "../types";

export interface WorkerPluginDefinition {
  id: string;
  createWorker: () => Worker;
  allowedIncomingTopics: readonly string[];
}

export interface IWorkerPluginService extends IKernelService {
  register(definition: WorkerPluginDefinition): void;
  unregister(id: string): void;
  post(id: string, topic: string, payload: unknown): void;
  list(): readonly string[];
}

interface WorkerRecord {
  worker: Worker;
  allowedIncomingTopics: ReadonlySet<string>;
}

/** 受控后台 Worker 宿主；只转发白名单消息，不向 Worker 暴露 Kernel 实例。 */
export class WorkerPluginService implements IWorkerPluginService {
  readonly name = KernelServices.WorkerPlugins;
  private kernel: IKernel | null = null;
  private workers = new Map<string, WorkerRecord>();

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    signal?.addEventListener("abort", () => this.terminateAll(), { once: true });
  }

  destroy(): void {
    this.terminateAll();
    this.kernel = null;
  }

  register(definition: WorkerPluginDefinition): void {
    if (!this.kernel) throw new Error("WORKER_PLUGIN_SERVICE_NOT_INITIALIZED");
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(definition.id)) {
      throw new Error("WORKER_PLUGIN_INVALID_ID");
    }
    if (this.workers.has(definition.id)) throw new Error("WORKER_PLUGIN_ALREADY_REGISTERED");

    const worker = definition.createWorker();
    const allowedIncomingTopics = new Set(definition.allowedIncomingTopics);
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isWorkerMessage(message) || !allowedIncomingTopics.has(message.topic)) return;
      void this.kernel?.publish({
        topic: `worker-plugin:${definition.id}:${message.topic}`,
        payload: message.payload,
      });
    };
    worker.onerror = (event) => {
      void this.kernel?.publish({
        topic: "worker-plugin:error",
        payload: { pluginId: definition.id, message: event.message },
      });
    };
    this.workers.set(definition.id, { worker, allowedIncomingTopics });
  }

  unregister(id: string): void {
    const record = this.workers.get(id);
    if (!record) return;
    record.worker.onmessage = null;
    record.worker.onerror = null;
    record.worker.terminate();
    this.workers.delete(id);
  }

  post(id: string, topic: string, payload: unknown): void {
    const record = this.workers.get(id);
    if (!record) throw new Error("WORKER_PLUGIN_NOT_FOUND");
    record.worker.postMessage({ topic, payload });
  }

  list(): readonly string[] {
    return [...this.workers.keys()];
  }

  private terminateAll(): void {
    for (const id of [...this.workers.keys()]) this.unregister(id);
  }
}

function isWorkerMessage(value: unknown): value is { topic: string; payload: unknown } {
  return !!value && typeof value === "object" && typeof (value as { topic?: unknown }).topic === "string";
}
