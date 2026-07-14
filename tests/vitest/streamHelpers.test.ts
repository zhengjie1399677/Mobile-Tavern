/**
 * streamHelpers.ts 纯函数单元测试
 *
 * 覆盖 generateUniqueId、buildFinalAiMessage、replacePlaceholderMessage、
 * buildOutputContext、getTrialCount、incrementTrialCount
 * 不覆盖 buildThrottledUpdater（依赖 React setState，已在组件集成测试中间接覆盖）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateUniqueId,
  buildFinalAiMessage,
  replacePlaceholderMessage,
  buildOutputContext,
  getTrialCount,
  incrementTrialCount,
} from "../../src/hooks/useChat/helpers/streamHelpers";
import type { ChatSession, Message, UserSettings, CharacterCard } from "../../src/types";

// ─── 测试夹具 ──────────────────────────────────────────────────────────────────
const mockSession: ChatSession = {
  id: "session-1",
  characterId: "char-1",
  title: "测试会话",
  messages: [
    { id: "msg-1", sender: "user", content: "你好", timestamp: 1000 },
    { id: "ai-msg-1", sender: "assistant", content: "正在生成...", timestamp: 2000 },
  ],
  createdAt: 1000,
  turnCount: 1,
} as any;

const mockSettings: UserSettings = {
  api: { baseUrl: "", apiKey: "", chatPath: "", modelName: "" },
} as any;

const mockCharacter: CharacterCard = {
  id: "char-1",
  name: "测试角色",
  avatar: "",
} as any;

describe("generateUniqueId", () => {
  it("带前缀生成唯一 ID", () => {
    const id1 = generateUniqueId("msg-");
    const id2 = generateUniqueId("msg-");
    expect(id1).toMatch(/^msg-/);
    expect(id2).toMatch(/^msg-/);
    expect(id1).not.toBe(id2);
  });

  it("空前缀也能正常工作", () => {
    const id = generateUniqueId("");
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });
});

describe("buildFinalAiMessage", () => {
  it("构建包含内容的最终 AI 消息", () => {
    const { finalAiMsg } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: "这是 AI 的回复",
      reasoningText: "",
      startTime: performance.now() - 100,
      tokenUsage: { prompt: 50, completion: 20 },
      enableReplySuggestions: false,
      latestSession: mockSession,
    });

    expect(finalAiMsg.id).toBe("ai-msg-1");
    expect(finalAiMsg.sender).toBe("assistant");
    expect(finalAiMsg.content).toBe("这是 AI 的回复");
    expect(finalAiMsg.tokenCount).toBe(20);
    expect(finalAiMsg.promptTokenCount).toBe(50);
    expect(finalAiMsg.extra).toBeDefined();
  });

  it("含 think 标签时正确分离 reasoningContent", () => {
    const { finalAiMsg } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: "<think>推理过程</think>正文回复",
      reasoningText: "",
      startTime: performance.now() - 100,
      tokenUsage: { prompt: 0, completion: 0 },
      enableReplySuggestions: false,
      latestSession: mockSession,
    });

    expect(finalAiMsg.content).toBe("正文回复");
    expect(finalAiMsg.reasoningContent).toBe("推理过程");
  });

  it("启用建议且含 suggestions 标签时提取建议", () => {
    const { finalAiMsg, suggestions } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: '正文<suggestions>["继续", "停止"]</suggestions>',
      reasoningText: "",
      startTime: performance.now() - 100,
      tokenUsage: { prompt: 0, completion: 0 },
      enableReplySuggestions: true,
      latestSession: mockSession,
    });

    expect(suggestions).toEqual(["继续", "停止"]);
    expect(finalAiMsg.extra?.suggestions).toEqual(["继续", "停止"]);
  });

  it("禁用建议时不提取 suggestions", () => {
    const { finalAiMsg, suggestions } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: '正文<suggestions>["继续"]</suggestions>',
      reasoningText: "",
      startTime: performance.now() - 100,
      tokenUsage: { prompt: 0, completion: 0 },
      enableReplySuggestions: false,
      latestSession: mockSession,
    });

    expect(suggestions).toEqual([]);
    expect(finalAiMsg.extra?.suggestions).toBeUndefined();
  });

  it("保留已有 extra 字段", () => {
    const sessionWithExtra: ChatSession = {
      ...mockSession,
      messages: mockSession.messages.map((m) =>
        m.id === "ai-msg-1" ? { ...m, extra: { image: "url.png" } } : m
      ),
    } as any;

    const { finalAiMsg } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: "回复",
      reasoningText: "",
      startTime: performance.now() - 100,
      tokenUsage: { prompt: 0, completion: 0 },
      enableReplySuggestions: false,
      latestSession: sessionWithExtra,
    });

    expect(finalAiMsg.extra?.image).toBe("url.png");
  });

  it("generationTime 大于 0", () => {
    const { finalAiMsg } = buildFinalAiMessage({
      aiMsgId: "ai-msg-1",
      responseText: "回复",
      reasoningText: "",
      startTime: performance.now() - 500,
      tokenUsage: { prompt: 0, completion: 0 },
      enableReplySuggestions: false,
      latestSession: mockSession,
    });

    expect(finalAiMsg.generationTime).toBeGreaterThan(0);
  });
});

describe("replacePlaceholderMessage", () => {
  it("替换已存在的占位消息", () => {
    const finalMsg: Message = {
      id: "ai-msg-1",
      sender: "assistant",
      content: "最终回复",
      timestamp: Date.now(),
    } as any;

    const result = replacePlaceholderMessage(mockSession, finalMsg);
    const target = result.messages.find((m) => m.id === "ai-msg-1");
    expect(target?.content).toBe("最终回复");
  });

  it("消息不存在时追加到末尾", () => {
    const finalMsg: Message = {
      id: "new-msg",
      sender: "assistant",
      content: "新消息",
      timestamp: Date.now(),
    } as any;

    const result = replacePlaceholderMessage(mockSession, finalMsg);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[result.messages.length - 1].id).toBe("new-msg");
  });

  it("不修改原始 session 对象", () => {
    const finalMsg: Message = {
      id: "ai-msg-1",
      sender: "assistant",
      content: "修改后",
      timestamp: Date.now(),
    } as any;

    const original = mockSession.messages.find((m) => m.id === "ai-msg-1");
    replacePlaceholderMessage(mockSession, finalMsg);
    // 原对象应未被修改（因为 messages 数组被浅拷贝了）
    expect(original?.content).toBe("正在生成...");
  });
});

describe("buildOutputContext", () => {
  it("正确展开所有字段", () => {
    const controller = new AbortController();
    const ctx = buildOutputContext({
      session: mockSession,
      responseText: "回复",
      reasoningText: "推理",
      settings: mockSettings,
      activeCharacter: mockCharacter,
      controller,
      isStillActive: true,
      isBisonConsecutive: false,
      bisonRemainingCount: 0,
    });

    expect(ctx.session).toBe(mockSession);
    expect(ctx.responseText).toBe("回复");
    expect(ctx.reasoningText).toBe("推理");
    expect(ctx.settings).toBe(mockSettings);
    expect(ctx.activeCharacter).toBe(mockCharacter);
    expect(ctx.controller).toBe(controller);
    expect(ctx.isStillActive).toBe(true);
    expect(ctx.isBisonConsecutive).toBe(false);
    expect(ctx.bisonRemainingCount).toBe(0);
  });
});

describe("试用次数计数", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("初始值为 0", () => {
    expect(getTrialCount()).toBe(0);
  });

  it("递增后值为 1", () => {
    incrementTrialCount();
    expect(getTrialCount()).toBe(1);
  });

  it("多次递增正确累加", () => {
    incrementTrialCount();
    incrementTrialCount();
    incrementTrialCount();
    expect(getTrialCount()).toBe(3);
  });

  it("从已有值开始递增", () => {
    localStorage.setItem("mobile_tavern_free_trial_count", "5");
    incrementTrialCount();
    expect(getTrialCount()).toBe(6);
  });

  it("非数字值返回 NaN（Number('abc') 的实际行为）", () => {
    localStorage.setItem("mobile_tavern_free_trial_count", "abc");
    expect(getTrialCount()).toBeNaN();
  });
});
