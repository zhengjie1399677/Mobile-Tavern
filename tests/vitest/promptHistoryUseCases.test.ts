import { describe, expect, it, vi } from "vitest";
import {
  buildAuthoritativePromptSession,
  resolvePromptHistoryRequirement,
} from "../../src/application/useCases/promptHistoryUseCases";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  UserSettings,
} from "../../src/types";
import type { IDatabaseService } from "../../src/application/serviceContracts";

const session: ChatSession = {
  id: "prompt-history-session",
  characterId: "character-1",
  title: "提示词历史",
  createdAt: 1,
  messages: [],
  summaries: [],
};

function settingsWithHistorySource(
  selection?: { mode: "all" } | { mode: "recent"; count: number; preserveFirstAssistant: boolean },
): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    promptConfig: {
      ...DEFAULT_SETTINGS.promptConfig,
      usePromptComposition: true,
      composition: {
        id: "composition-1",
        name: "测试编排",
        version: 1,
        blocks: [{
          id: "history",
          name: "聊天记录",
          enabled: true,
          role: "system",
          source: { type: "chat_history", selection },
          template: "",
          order: 1,
          placement: { type: "ordered" },
        }],
      },
    },
  };
}

describe("Prompt 权威历史窗口", () => {
  it("旧编排按 recentTurns 请求最近消息并保留首条助手开场", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      memory: { ...DEFAULT_SETTINGS.memory, recentTurns: 9 },
    };
    expect(resolvePromptHistoryRequirement(session, settings)).toEqual({
      limit: 9,
      preserveFirstAssistant: true,
    });
  });

  it("自由编排明确区分全量、最近窗口，并为世界书保留独立扫描窗口", () => {
    expect(resolvePromptHistoryRequirement(session, settingsWithHistorySource({ mode: "all" })))
      .toEqual({ preserveFirstAssistant: false });
    expect(resolvePromptHistoryRequirement(session, settingsWithHistorySource({
      mode: "recent",
      count: 12,
      preserveFirstAssistant: true,
    }))).toEqual({ limit: 12, preserveFirstAssistant: true });

    const disabled = settingsWithHistorySource({ mode: "all" });
    disabled.promptConfig.composition!.blocks[0].enabled = false;
    expect(resolvePromptHistoryRequirement(session, disabled))
      .toEqual({ limit: DEFAULT_SETTINGS.memory.recentTurns, preserveFirstAssistant: false });
  });

  it("构建提示词会话时把重发边界交给数据库，并不使用 UI 消息切片", async () => {
    const authoritativeMessages: Message[] = [{
      id: "persisted-message",
      sender: "assistant",
      content: "数据库历史",
      timestamp: 1,
    }];
    const getSessionPromptMessages = vi.fn(async () => authoritativeMessages);
    const database = {
      getSessionPromptMessages,
    } as unknown as IDatabaseService<
      ChatSession,
      CharacterCard,
      SummaryCard,
      Message,
      ChatSessionMetadataPatch
    >;

    const result = await buildAuthoritativePromptSession(
      database,
      { ...session, messages: [{ id: "ui-only", sender: "user", content: "切片", timestamp: 2 }] },
      settingsWithHistorySource({ mode: "recent", count: 5, preserveFirstAssistant: true }),
      "reroll-boundary",
    );

    expect(getSessionPromptMessages).toHaveBeenCalledWith(session.id, {
      limit: DEFAULT_SETTINGS.memory.recentTurns,
      preserveFirstAssistant: true,
      beforeMessageId: "reroll-boundary",
    });
    expect(result.messages).toEqual(authoritativeMessages);
  });
});
