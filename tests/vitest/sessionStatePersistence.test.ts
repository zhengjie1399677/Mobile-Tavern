import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/application/services/DatabaseService";
import { attachSessionStateSnapshot } from "../../src/domain/chat/sessionStateSnapshot";
import { replaceCompleteSessions } from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { updateMessageExtraction } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import type { ChatSession, Message, TableMemorySheet } from "../../src/types";

const tableMemory: TableMemorySheet[] = [{
  id: "sheet-state",
  name: "角色状态",
  columns: ["名称", "值"],
  rows: [["好感", "8"]],
  enable: true,
}];

describe("会话状态重启恢复", () => {
  beforeEach(async () => {
    __resetDBInstanceForTesting();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("从 messages Store 中恢复重发边界之前最近的变量与状态表快照", async () => {
    const snapshotMessage = attachSessionStateSnapshot({
      id: "assistant-snapshot",
      sender: "assistant",
      content: "状态已变化",
      timestamp: 2,
    }, {
      variables: { affection: 8, location: "酒馆" },
      tableMemory,
    });
    const target: Message = {
      id: "user-reroll-target",
      sender: "user",
      content: "继续",
      timestamp: 3,
    };
    const session: ChatSession = {
      id: "state-restart-session",
      characterId: "character-1",
      title: "状态恢复",
      createdAt: 1,
      messages: [
        { id: "user-1", sender: "user", content: "开始", timestamp: 1 },
        snapshotMessage,
        target,
      ],
      summaries: [],
      // 模拟当前分支已经继续演化；重发必须恢复消息边界快照，而不是复制当前值。
      variables: { affection: 99 },
      tableMemory: [{ ...tableMemory[0], rows: [["好感", "99"]] }],
    };
    await replaceCompleteSessions([session]);
    // 后台记忆抽取只能合并自己的字段，不能覆盖消息上已经存在的状态快照。
    await updateMessageExtraction(
      snapshotMessage.id,
      ["酒馆"],
      "llm",
      { modelUsed: "test-model" },
    );

    // 新建 Service 实例模拟软件重启后重新读取持久化数据。
    const restored = await new DatabaseService().getSessionStateBeforeMessage(
      session.id,
      target.id,
    );
    expect(restored).toEqual({
      variables: { affection: 8, location: "酒馆" },
      tableMemory,
    });
  });
});
