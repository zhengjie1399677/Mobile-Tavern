/**
 * C1a 回归：适配器接纳通用上下文来源贡献，且缺省时不改变任何既有数据源。
 *
 * 只测适配层：不涉及发送链路，缺省路径必须与接线前逐字段一致。
 */
import { describe, expect, it } from "vitest";
import type { CharacterCard, ChatSession, UserSettings } from "@/src/types";
import type { ContextContribution } from "@/src/domain/contextSources/contracts";
import { buildPromptCompositionRuntimeData } from "@/src/application/services/prompt/PromptCompositionRuntimeAdapter";
import {
  buildMemoryContextContribution,
  MEMORY_RECALL_MACRO_NAME,
} from "@/src/application/contextSources/memoryContextContribution";
import type { RecalledMessage } from "@/src/application/services/memory/types";

const character = {
  name: "角色",
  description: "简介",
  personality: "性格",
  scenario: "场景",
  system_prompt: "系统",
  mes_example: "示例",
} as unknown as CharacterCard;

const settings = {
  userName: "玩家",
  userInfo: "玩家信息",
  api: { sendNames: false },
  promptConfig: {},
  enableReplySuggestions: false,
} as unknown as UserSettings;

const chat = {
  id: "session",
  summaries: [],
  tableMemory: [],
  messages: [],
} as unknown as ChatSession;

function adapt(contextContributions?: readonly ContextContribution[]) {
  return buildPromptCompositionRuntimeData({
    character,
    chat,
    userInput: "输入",
    settings,
    triggeredLorebook: [],
    recalledMemories: [],
    ...(contextContributions ? { contextContributions } : {}),
  });
}

function contribution(overrides: Partial<ContextContribution> & { macroName: string }): ContextContribution {
  return {
    sourceId: overrides.macroName,
    content: "",
    status: "ok",
    characters: 0,
    ...overrides,
  };
}

describe("Prompt 运行时数据源与上下文贡献", () => {
  it("缺省与空数组都不改变既有数据源（逐字段一致）", () => {
    const base = adapt();
    const withEmpty = adapt([]);
    expect(withEmpty.values).toEqual(base.values);
    expect(withEmpty.history).toEqual(base.history);
  });

  it("贡献按宏名写入数据源", () => {
    const runtime = adapt([
      contribution({ macroName: "context.kb", sourceId: "kb", content: "知识库正文", characters: 5 }),
    ]);
    expect(runtime.values["context.kb"]).toBe("知识库正文");
  });

  it("空占位写入空串，避免未注册宏把字面量漏进提示词", () => {
    const runtime = adapt([
      contribution({ macroName: "context.absent", sourceId: "absent", status: "empty" }),
    ]);
    expect(Object.prototype.hasOwnProperty.call(runtime.values, "context.absent")).toBe(true);
    expect(runtime.values["context.absent"]).toBe("");
  });

  it("不覆盖既有内建数据源（来源误伤 char/memory.recalled 无效）", () => {
    const runtime = adapt([
      contribution({ macroName: "char", sourceId: "evil", content: "被覆盖了", characters: 5 }),
      contribution({ macroName: "memory.recalled", sourceId: "evil2", content: "注入", characters: 2 }),
    ]);
    expect(runtime.values.char).toBe("角色");
    expect(runtime.values["memory.recalled"]).toBe("");
  });
});

describe("记忆召回的上下文贡献", () => {
  const recalled = [
    {
      memoryId: "m1",
      messageId: "msg1",
      turnIndex: 2,
      role: "user",
      content: "第一段记忆",
      hitCount: 1,
      hitTags: ["tag"],
      score: 0.9,
    },
    {
      memoryId: "m2",
      messageId: "msg2",
      turnIndex: 4,
      role: "assistant",
      content: "第二段记忆",
      hitCount: 1,
      hitTags: ["tag"],
      score: 0.8,
    },
  ] as unknown as RecalledMessage[];

  it("内容与适配器输出的 memory.recalled 逐字节一致（黄金对比）", () => {
    const contribution = buildMemoryContextContribution(recalled);
    const runtime = buildPromptCompositionRuntimeData({
      character,
      chat,
      userInput: "输入",
      settings,
      triggeredLorebook: [],
      recalledMemories: recalled,
    });

    expect(contribution.macroName).toBe(MEMORY_RECALL_MACRO_NAME);
    expect(contribution.content).toBe(runtime.values["memory.recalled"]);
    expect(contribution.content).toBe("第一段记忆\n\n第二段记忆");
    expect(contribution.status).toBe("ok");
  });

  it("审计保留结构化召回项，供记忆抽屉做 pin/mute 与统计", () => {
    const contribution = buildMemoryContextContribution(recalled);
    expect(contribution.audit).toEqual({ recalled });
  });

  it("空召回产出 empty 占位而不是 ok", () => {
    const contribution = buildMemoryContextContribution([]);
    expect(contribution.status).toBe("empty");
    expect(contribution.content).toBe("");
    expect(contribution.characters).toBe(0);
  });
});
