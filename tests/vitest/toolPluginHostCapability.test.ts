import { describe, expect, it } from "vitest";
import { executeToolPluginHostCapability } from "../../src/application/toolPlugins/hostCapabilityExecutor";
import type { MemoryServiceTyped } from "../../src/application/services/memory";

describe("Tool Plugin Host Capability", () => {
  it("按指定本地时区生成可直接回填的日期时间文本", async () => {
    const result = await executeToolPluginHostCapability({
      capability: "system.time",
      input: {},
      context: {
        sessionId: "session-time",
        turnId: "turn-time",
        callId: "call-time",
        signal: new AbortController().signal,
      },
      memory: {} as MemoryServiceTyped,
      now: () => Date.UTC(2026, 8, 2, 1, 5, 6),
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    });

    expect(result).toEqual({
      text: "📅 2026年9月2日星期三\n🕒 09:05:06 · Asia/Shanghai",
    });
  });

  it("已取消时不读取设备时间", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(executeToolPluginHostCapability({
      capability: "system.time",
      input: {},
      context: {
        sessionId: "session-time",
        turnId: "turn-time",
        callId: "call-time",
        signal: controller.signal,
      },
      memory: {} as MemoryServiceTyped,
    })).rejects.toThrow("cancelled");
  });
});
