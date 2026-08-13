import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDB } from "../../src/infrastructure/storage/idbConnection";
import {
  getSessionById,
  getSessionsPaginated,
} from "../../src/infrastructure/storage/indexedDbSessionQueries";
import {
  appendSessionSummary,
  deleteSessionSummary,
  getMessagesBySession,
  updateSessionSummary,
} from "../../src/infrastructure/storage/indexedDbMemoryStore";
import {
  saveSession,
} from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import type { ChatSession, Message, SummaryCard } from "../../src/types";

const sessionId = "timeline-integrity-session";

function makeMessage(index: number): Message {
  return {
    id: `message-${index}`,
    sender: index % 2 === 0 ? "user" : "assistant",
    content: `对话 ${index}`,
    timestamp: 1_000 + index,
  };
}

function makeSummary(index: number): SummaryCard {
  return {
    id: `summary-${index}`,
    timeTag: `第${index}幕`,
    location: "测试地点",
    content: `总结 ${index}`,
    lastMessageId: `message-${index * 25}`,
  };
}

async function seedLegacySession(): Promise<void> {
  const db = await getDB();
  const messages = Array.from({ length: 1_000 }, (_, index) => makeMessage(index + 1));
  const summaries = Array.from({ length: 40 }, (_, index) => makeSummary(index + 1));

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["sessions", "messages"], "readwrite");
    transaction.objectStore("sessions").put({
      id: sessionId,
      characterId: "character-1",
      title: "长会话",
      createdAt: 1,
      // 模拟旧版本残留的非权威内嵌切片：只含首条和末尾 24 条。
      messages: [messages[0], ...messages.slice(-24)],
      summaries,
      lastSummarizedMessageId: summaries.at(-1)?.lastMessageId,
    });
    for (const [turnIndex, message] of messages.entries()) {
      transaction.objectStore("messages").put({
        id: message.id,
        sessionId,
        role: message.sender,
        content: message.content,
        createdAt: message.timestamp,
        turnIndex,
        tags: [],
        extractSource: "none",
      });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe("长会话消息与时间线摘要完整性", () => {
  beforeEach(async () => {
    __resetDBInstanceForTesting();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await seedLegacySession();
  });

  afterEach(() => {
    __resetDBInstanceForTesting();
  });

  it("会话查询忽略旧版内嵌消息切片，消息分页始终以 messages Store 为准", async () => {
    const direct = await getSessionById(sessionId);
    const page = await getSessionsPaginated(1, 50);
    const authoritativeMessages = await getMessagesBySession(sessionId);

    expect(direct?.messages).toEqual([]);
    expect(page[0]?.messages).toEqual([]);
    expect(direct?.summaries).toHaveLength(40);
    expect(authoritativeMessages).toHaveLength(1_000);
  }, 15_000);

  it("并发追加摘要不会被同键写合并吞掉", async () => {
    await Promise.all([
      appendSessionSummary(sessionId, makeSummary(41)),
      appendSessionSummary(sessionId, makeSummary(42)),
    ]);

    const stored = await getSessionById(sessionId);
    expect(stored?.summaries.map((summary) => summary.id)).toEqual(
      Array.from({ length: 42 }, (_, index) => `summary-${index + 1}`),
    );
  }, 15_000);

  it("普通会话保存不会用陈旧快照覆盖已有摘要时间线", async () => {
    const staleSnapshot: ChatSession = {
      id: sessionId,
      characterId: "character-1",
      title: "更新后的标题",
      createdAt: 1,
      messages: [makeMessage(1)],
      summaries: [makeSummary(40)],
      lastSummarizedMessageId: makeSummary(40).lastMessageId,
    };

    await saveSession(staleSnapshot);

    const stored = await getSessionById(sessionId);
    expect(stored?.title).toBe("更新后的标题");
    expect(stored?.summaries).toHaveLength(40);
    expect(stored?.lastSummarizedMessageId).toBe(makeSummary(40).lastMessageId);
  }, 15_000);

  it("编辑和删除只修改目标摘要，不影响其余时间线节点", async () => {
    await updateSessionSummary(sessionId, {
      ...makeSummary(20),
      content: "修订后的第 20 条总结",
    });
    await deleteSessionSummary(sessionId, makeSummary(10).id);

    const stored = await getSessionById(sessionId);
    expect(stored?.summaries).toHaveLength(39);
    expect(stored?.summaries.find((summary) => summary.id === "summary-20")?.content)
      .toBe("修订后的第 20 条总结");
    expect(stored?.summaries.some((summary) => summary.id === "summary-10")).toBe(false);
    expect(stored?.lastSummarizedMessageId).toBe(makeSummary(40).lastMessageId);
  }, 15_000);
});
