// 回归：平行宇宙视图必须拿到消息窗口。
//
// sessions Store 拆分后 queryDirectory 返回的 session.messages 恒为空数组，
// 平行宇宙图只剩空柱子；本用例钉住"补消息窗口"的行为。
import { describe, expect, it, vi } from "vitest";
import { loadUniverseSessionsForCharacter } from "../../src/application/useCases/sessionDirectoryUseCases";
import type { ISessionManagementService } from "../../src/application/serviceContracts";
import type { ChatSession } from "../../src/types";

function createSession(id: string): ChatSession {
  return {
    id,
    characterId: "char-1",
    title: id,
    createdAt: 1,
    messages: [],
    summaries: [],
  };
}

describe("loadUniverseSessionsForCharacter", () => {
  it("为目录里的空会话补上按 turnIndex 对齐的消息窗口", async () => {
    const service = {
      queryDirectory: vi.fn(async () => ({
        active: [
          { session: createSession("s1"), characterName: "角色", branchCount: 0 },
        ],
        favorites: [],
        archived: [],
        pageInfo: { active: { hasMore: false }, favorite: { hasMore: false }, archived: { hasMore: false } },
        characters: [],
      })),
    } as unknown as ISessionManagementService<ChatSession>;
    const reader = {
      getSessionPromptMessages: vi.fn(async () => [
        { id: "m0", sender: "user" as const, content: "你好", timestamp: 1, turnIndex: 0 },
        { id: "m1", sender: "assistant" as const, content: "回应", timestamp: 2, turnIndex: 1 },
      ]),
    };

    const sessions = await loadUniverseSessionsForCharacter(service, reader, "char-1");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages.map((message) => message.turnIndex)).toEqual([0, 1]);
    expect(reader.getSessionPromptMessages).toHaveBeenCalledWith("s1", {
      limit: expect.any(Number),
      preserveFirstAssistant: false,
    });
  });

  it("已带消息的会话不再重复读取", async () => {
    const hydrated: ChatSession = {
      ...createSession("s2"),
      messages: [{ id: "m0", sender: "assistant", content: "开场", timestamp: 1 }],
    };
    const service = {
      queryDirectory: vi.fn(async () => ({
        active: [{ session: hydrated, characterName: "角色", branchCount: 0 }],
        favorites: [],
        archived: [],
        pageInfo: { active: { hasMore: false }, favorite: { hasMore: false }, archived: { hasMore: false } },
        characters: [],
      })),
    } as unknown as ISessionManagementService<ChatSession>;
    const reader = { getSessionPromptMessages: vi.fn() };

    const sessions = await loadUniverseSessionsForCharacter(service, reader, "char-1");

    expect(sessions[0].messages).toHaveLength(1);
    expect(reader.getSessionPromptMessages).not.toHaveBeenCalled();
  });
});
