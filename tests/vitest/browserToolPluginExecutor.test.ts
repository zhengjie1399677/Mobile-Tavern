import { describe, expect, it } from "vitest";
import { BrowserToolPluginExecutor } from "../../src/infrastructure/toolPlugins/browserToolPluginExecutor";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  respond = true;

  postMessage(message: { type: string }): void {
    if (message.type === "execute" && this.respond) {
      queueMicrotask(() => this.onmessage?.({ data: { type: "result", result: { ok: true } } } as MessageEvent));
    }
  }

  terminate(): void { this.terminated = true; }
}

describe("一次性 External Tool Worker", () => {
  it("完成后立即终止且不保留后台 Worker", async () => {
    const worker = new FakeWorker();
    const executor = new BrowserToolPluginExecutor(() => worker as unknown as Worker);
    await expect(executor.execute({
      pluginId: "example.worker",
      entryCode: "globalThis.MobileTavernToolPlugin = { tools: { echo: async () => ({}) } };",
      exportName: "echo",
      input: {},
      signal: new AbortController().signal,
      maxRequests: 0,
      network: async () => { throw new Error("unexpected"); },
    })).resolves.toEqual({ ok: true });
    expect(worker.terminated).toBe(true);
    expect(executor.getActiveWorkerCount()).toBe(0);
  });

  it("AbortSignal 会强制终止正在执行的 Worker", async () => {
    const worker = new FakeWorker();
    worker.respond = false;
    const executor = new BrowserToolPluginExecutor(() => worker as unknown as Worker);
    const controller = new AbortController();
    const pending = executor.execute({
      pluginId: "example.worker",
      entryCode: "globalThis.MobileTavernToolPlugin = { tools: {} };",
      exportName: "echo",
      input: {},
      signal: controller.signal,
      maxRequests: 0,
      network: async () => { throw new Error("unexpected"); },
    });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(worker.terminated).toBe(true);
  });
});
