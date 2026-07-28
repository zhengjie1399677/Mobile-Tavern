import { describe, expect, it, vi } from "vitest";
import { loadServiceModules, registerServiceModules } from "../../src/kernel/bootstrap/serviceCatalog";
import { WorkerPluginService } from "../../src/kernel/services/WorkerPluginService";
import { createKernel } from "../../src/kernel/Kernel";
import type { IKernelService } from "../../src/kernel/types";

describe("服务动态装载", () => {
  it("并行装载声明式服务并校验名称", async () => {
    const service: IKernelService = { name: "demo", init: vi.fn() };
    const entries = await loadServiceModules([{ name: "demo", load: async () => service }]);
    expect(entries).toEqual([{ name: "demo", service }]);
  });

  it("拒绝目录名称与服务契约不一致", async () => {
    await expect(loadServiceModules([{
      name: "expected",
      load: async () => ({ name: "actual", init: vi.fn() }),
    }])).rejects.toThrow("Service descriptor mismatch");
  });

  it("支持运行时装载并通过 Kernel 生命周期卸载服务", async () => {
    const kernel = createKernel();
    const destroy = vi.fn();
    await registerServiceModules(kernel, [{
      name: "runtime.demo",
      load: async () => ({ name: "runtime.demo", init: vi.fn(), destroy }),
    }]);
    expect(kernel.hasService("runtime.demo")).toBe(true);

    await kernel.destroyService("runtime.demo");
    expect(kernel.hasService("runtime.demo")).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe("后台 Worker 插件宿主", () => {
  it("只转发白名单消息并在注销时终止 Worker", async () => {
    const kernel = createKernel();
    const published: string[] = [];
    kernel.subscribe("worker-plugin:demo.worker:ready", () => {
      published.push("ready");
    });
    const service = new WorkerPluginService();
    await kernel.registerService(service.name, service);
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;

    service.register({
      id: "demo.worker",
      createWorker: () => worker,
      allowedIncomingTopics: ["ready"],
    });
    worker.onmessage?.({ data: { topic: "blocked", payload: null } } as MessageEvent);
    worker.onmessage?.({ data: { topic: "ready", payload: null } } as MessageEvent);
    await Promise.resolve();
    expect(published).toEqual(["ready"]);

    service.unregister("demo.worker");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
