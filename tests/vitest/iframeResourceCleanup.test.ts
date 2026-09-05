import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { createIframeResourceCleanupBootstrap } from "../../src/utils/tavernHelper/iframeResourceCleanup";

it("资源登记保留字符串 interval 语义，并且清理可重复调用", () => {
  const nativeInterval = vi.fn(() => 42);
  const clearInterval = vi.fn();
  const surface = {
    setTimeout: vi.fn(), clearTimeout: vi.fn(), setInterval: nativeInterval, clearInterval,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  const context = { window: surface, document: { querySelectorAll: () => [] } };
  runInNewContext(createIframeResourceCleanupBootstrap(), context);
  runInNewContext('window.setInterval("window.tick++", 20); window.__MT_RESOURCE_CLEANUP__(); window.__MT_RESOURCE_CLEANUP__();', context);
  expect(nativeInterval).toHaveBeenCalledWith("window.tick++", 20);
  expect(clearInterval).toHaveBeenCalledTimes(1);
  expect(clearInterval.mock.calls[0][0]).toBe(42);
});
