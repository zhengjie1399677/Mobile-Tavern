import { describe, expect, it, vi } from "vitest";
import { registerMainTabExtensions } from "../../src/composition/registerMainTabExtensions";
import { createKernel } from "../../src/kernel/Kernel";
import type { IKernelService } from "../../src/kernel/types";

describe("主 Tab 扩展 Scope", () => {
  it("注册结果可统一回收且重复释放安全", async () => {
    const kernel = createKernel();
    const settingsService: IKernelService & { getUsageMetrics(): Promise<null> } = {
      name: "settings",
      init: vi.fn(),
      getUsageMetrics: async () => null,
    };
    await kernel.registerService("settings", settingsService);

    const dispose = await registerMainTabExtensions(kernel);
    expect(kernel.getExtensions("main:tabs").length).toBeGreaterThan(0);

    await dispose();
    await dispose();
    expect(kernel.getExtensions("main:tabs")).toEqual([]);
    await kernel.destroy();
  });
});
