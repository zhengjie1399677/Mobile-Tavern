import { describe, expect, it, vi } from "vitest";
import {
  createCharacterReadTool,
  createSessionBranchTool,
} from "../../src/application/tools/builtinAgentTools";
import type {
  ICharacterService,
  IDatabaseService,
} from "../../src/application/serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
} from "../../src/types";

type Database = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message,
  ChatSessionMetadataPatch
>;

const context = {
  sessionId: "session-source",
  turnId: "turn-1",
  callId: "call-1",
  signal: new AbortController().signal,
};

describe("内置 Agent Tools", () => {
  it("character.read 只返回当前会话角色的安全公开字段", async () => {
    const database = {
      getSessionById: vi.fn().mockResolvedValue({ characterId: "character-1" }),
    } as unknown as Database;
    const characterService = {
      getCharacterById: vi.fn().mockResolvedValue({
        id: "character-1",
        name: "测试角色",
        description: "公开简介",
        personality: "冷静",
        scenario: "酒馆",
        first_mes: "你好",
        mes_example: "示例",
        creator: "作者",
        tags: ["测试"],
        avatar: "data:image/png;base64,secret",
        extensions: { private: true },
        variables: { secret: "不可泄露" },
      }),
    } as unknown as ICharacterService<CharacterCard>;
    const tool = createCharacterReadTool(database, characterService);

    await expect(tool.execute({}, context)).resolves.toEqual({
      id: "character-1",
      name: "测试角色",
      description: "公开简介",
      personality: "冷静",
      scenario: "酒馆",
      creator: "作者",
      tags: ["测试"],
    });
    expect(tool.policy).toBe("allow");
    expect(tool.sideEffect).toBe("none");
  });

  it("session.branch 创建带来源记录的新分支并支持取消", async () => {
    const source = {
      id: "session-source",
      characterId: "character-1",
      title: "来源会话",
      createdAt: 1,
      summaries: [],
      messages: [],
    } as ChatSession;
    const character = {
      id: "character-1",
      name: "测试角色",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
    } as CharacterCard;
    const branch = {
      id: "session-branch",
      characterId: "character-1",
      title: "新的分支",
      createdAt: 2,
      summaries: [],
      messages: [],
    } as ChatSession;
    const database = {
      getSessionById: vi.fn().mockResolvedValue(source),
      getCharacterById: vi.fn().mockResolvedValue(character),
      createEmptyBranch: vi.fn().mockResolvedValue(branch),
    } as unknown as Database;
    const tool = createSessionBranchTool(database);

    await expect(tool.execute({ title: "  新的分支  " }, context)).resolves.toEqual({
      sessionId: "session-branch",
      title: "新的分支",
      sourceSessionId: "session-source",
      createdAt: 2,
    });
    expect(database.createEmptyBranch).toHaveBeenCalledWith(
      character,
      "新的分支",
      "session-source",
      expect.any(AbortSignal),
    );
    expect(tool.policy).toBe("ask");

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(tool.execute({ title: "取消" }, { ...context, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
