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

  it("掷骰子返回每次结果与总和", async () => {
    const result = await executeToolPluginHostCapability({
      capability: "random.dice",
      input: { expression: "2d6+1" },
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
      random: () => 0.99,
    });
    expect(result).toEqual({ text: "🎲 2d6+1 = [6, 6] → 13" });
  });

  it("非法掷骰表达式 fail-closed", async () => {
    await expect(executeToolPluginHostCapability({
      capability: "random.dice",
      input: { expression: "abc" },
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
    })).rejects.toThrow("TOOL_PLUGIN_DICE_INPUT_INVALID");
  });

  it("掷硬币按随机源返回正面或反面", async () => {
    const base = {
      capability: "random.coin" as const,
      input: {},
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
    };
    await expect(executeToolPluginHostCapability({ ...base, random: () => 0.1 }))
      .resolves.toEqual({ text: "🪙 正面" });
    await expect(executeToolPluginHostCapability({ ...base, random: () => 0.9 }))
      .resolves.toEqual({ text: "🪙 反面" });
  });

  it("随机抽取从多个选项里返回一个", async () => {
    const result = await executeToolPluginHostCapability({
      capability: "random.pick",
      input: { options: "苹果,香蕉,橘子" },
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
      random: () => 0,
    });
    expect(result).toEqual({ text: "🎯 从 3 个选项抽中：苹果" });
  });

  it("随机抽取少于两个选项时拒绝", async () => {
    await expect(executeToolPluginHostCapability({
      capability: "random.pick",
      input: { options: "只有一个" },
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
    })).rejects.toThrow("TOOL_PLUGIN_PICK_INPUT_INVALID");
  });

  it("统计文本的字符、非空白、汉字与行数", async () => {
    const result = await executeToolPluginHostCapability({
      capability: "text.count",
      input: { text: "你好 world\n第二行" },
      context: { sessionId: "s", turnId: "t", callId: "c", signal: new AbortController().signal },
      memory: {} as MemoryServiceTyped,
    });
    expect(result).toEqual({ text: "字符 12（含空白）· 非空白 10 · 汉字 5 · 行 2" });
  });
});
