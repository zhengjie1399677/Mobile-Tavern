import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDB } from "../../src/infrastructure/storage/idbConnection";
import {
  getSessionById,
  getSessionCountsByCharacter,
  getSessionsPage,
  getSessionsPaginated,
} from "../../src/infrastructure/storage/indexedDbSessionQueries";
import {
  appendSessionSummary,
  deleteSessionSummary,
  getMessagesBySession,
  upsertFragment,
  updateSessionSummary,
} from "../../src/infrastructure/storage/indexedDbMemoryStore";
import {
  replaceCompleteSessions,
  updateSessionMetadata,
} from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { hydrateNewestFirstMessagePage } from "../../src/application/useCases/chatMessageHydration";
import { deleteSessionMessage } from "../../src/infrastructure/storage/repositories/sessionMessageDeleteRepository";
import { commitSessionTurn } from "../../src/infrastructure/storage/repositories/sessionTurnRepository";
import { updateSessionMessage } from "../../src/infrastructure/storage/repositories/sessionMessageUpdateRepository";
import { upsertDictEntry } from "../../src/infrastructure/storage/repositories/memoryDictRepository";
import { evolveTemporalFact } from "../../src/infrastructure/storage/repositories/memoryFactsRepository";
import { DatabaseService } from "../../src/application/services/DatabaseService";
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

  it("首页会话统计按 characterId 索引覆盖全部角色且不依赖会话分页", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      store.put({ id: "branch-2", characterId: "character-1", createdAt: 2, summaries: [] });
      store.put({ id: "branch-3", characterId: "character-2", createdAt: 3, summaries: [] });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    await expect(getSessionCountsByCharacter()).resolves.toEqual({
      "character-1": 2,
      "character-2": 1,
    });
  });

  it("会话目录使用稳定游标，分页期间插入新会话不会跳过旧记录", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      for (let index = 0; index < 60; index++) {
        store.put({
          id: `catalog-${String(index).padStart(2, "0")}`,
          characterId: "catalog-character",
          title: `目录 ${index}`,
          createdAt: 100 + index,
          summaries: [],
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const first = await getSessionsPage({ pageSize: 20 });
    const cursor = first.sessions.at(-1)!;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put({
        id: "catalog-newest",
        characterId: "catalog-character",
        title: "分页期间新增",
        createdAt: 10_000,
        summaries: [],
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    const second = await getSessionsPage({
      pageSize: 20,
      before: { createdAt: cursor.createdAt, id: cursor.id },
    });

    expect(new Set([...first.sessions, ...second.sessions].map((session) => session.id)).size)
      .toBe(40);
    expect(second.sessions[0].createdAt).toBeLessThan(cursor.createdAt);
  });

  it("稳定游标用 id 打破相同排序值，跨页不重复不漏项", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      for (let index = 0; index < 45; index += 1) {
        store.put({
          id: `same-time-${String(index).padStart(2, "0")}`,
          characterId: "catalog-character",
          title: `同刻目录 ${index}`,
          createdAt: 50_000,
          updatedAt: 50_000,
          lifecycle: "active",
          summaries: [],
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const first = await getSessionsPage({ pageSize: 20, sort: "created_desc" });
    const second = await getSessionsPage({
      pageSize: 20,
      sort: "created_desc",
      cursor: first.cursor,
    });
    const ids = [...first.sessions, ...second.sessions].map((item) => item.id);

    expect(first.hasMore).toBe(true);
    expect(new Set(ids).size).toBe(40);
    expect(ids.every((id) => id.startsWith("same-time-"))).toBe(true);
  });

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

    await updateSessionMetadata(staleSnapshot.id, { title: staleSnapshot.title });

    const stored = await getSessionById(sessionId);
    expect(stored?.title).toBe("更新后的标题");
    expect(stored?.summaries).toHaveLength(40);
    expect(stored?.lastSummarizedMessageId).toBe(makeSummary(40).lastMessageId);
  }, 15_000);

  it("分页消息快照更新元数据时不会回退全量消息统计", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put({
        id: sessionId,
        characterId: "character-1",
        title: "长会话",
        createdAt: 1,
        summaries: [],
        turnCount: 500,
        charCount: 6_000,
        messageCount: 1_000,
        userMessageCount: 500,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    await updateSessionMetadata(sessionId, { title: "只修改标题" });

    const stored = await getSessionById(sessionId);
    expect(stored?.title).toBe("只修改标题");
    expect(stored?.turnCount).toBe(500);
    expect(stored?.charCount).toBe(6_000);
  });

  it("消息追加在同一事务中维护会话总计数", async () => {
    await commitSessionTurn(sessionId, {}, [{
      id: "message-1001",
      sender: "user",
      content: "新增用户消息",
      timestamp: 9_999,
    }]);

    const stored = await getSessionById(sessionId);
    expect(stored?.turnCount).toBe(501);
    expect(stored?.charCount).toBe(5_899);
  });

  it("消息分页使用稳定游标，追加新消息不会改变下一页边界", async () => {
    const database = new DatabaseService();
    const first = await database.getSessionMessageWindow(sessionId, { pageSize: 50 });
    expect(first.messages[0].id).toBe("message-951");
    expect(first.messages.at(-1)?.id).toBe("message-1000");
    expect(first.hasMore).toBe(true);

    await commitSessionTurn(sessionId, {}, [{
      id: "message-1001",
      sender: "assistant",
      content: "分页期间新增",
      timestamp: 10_001,
    }]);
    const second = await database.getSessionMessageWindow(sessionId, {
      pageSize: 50,
      beforeMessageId: first.messages[0].id,
    });
    expect(second.messages[0].id).toBe("message-901");
    expect(second.messages.at(-1)?.id).toBe("message-950");
    expect(new Set([...first.messages, ...second.messages]).size).toBe(100);
  });

  it("完整消息字段经批量写入和分页水合后保持不变", async () => {
    const richMessage: Message = {
      id: "rich-message",
      sender: "system",
      content: "系统消息",
      timestamp: 20_000,
      reasoningContent: "推理内容",
      generationTime: 1.25,
      tokenCount: 42,
      promptTokenCount: 84,
      swipes: ["版本一", "版本二"],
      swipe_id: 1,
      extra: { image: "asset://image" },
      variables: { affection: 7 },
    };
    await replaceCompleteSessions([{
      id: "rich-session",
      characterId: "character-2",
      title: "字段往返",
      createdAt: 20_000,
      messages: [richMessage],
      summaries: [],
    }]);

    const records = await getMessagesBySession("rich-session", { descending: true });
    expect(hydrateNewestFirstMessagePage(records)[0]).toMatchObject({
      ...richMessage,
      turnIndex: 0,
      tags: [],
      extractSource: "none",
      metadata: richMessage.extra,
    });
  });

  it("删除消息时原子维护统计并清理受影响摘要与派生记忆", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      transaction.objectStore("memory_dict").put({
        id: `${sessionId}:旧实体`, sessionId, entity: "旧实体", count: 1,
      });
      transaction.objectStore("memory_fragments").put({
        id: "fragment-after-delete", sessionId, content: "旧派生内容", participants: [], tags: [],
        sourceMessageIds: ["message-40"], sourceRole: "assistant", sourceTurnStart: 39,
        sourceTurnEnd: 39, status: "active", importance: 1, confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.objectStore("memory_facts").put({
        id: "fact-after-delete", sessionId, subject: "甲", predicate: "认识", object: "乙",
        tags: [], status: "active", validFromTurn: 39, sourceMessageId: "message-40",
        confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    const updated = await deleteSessionMessage(sessionId, "message-30");
    expect(updated.turnCount).toBe(499);
    expect(updated.charCount).toBe(5_888);
    expect(updated.summaries.map((summary) => summary.id)).toEqual(["summary-1"]);
    expect(updated.lastSummarizedMessageId).toBe("message-25");
    expect(await getMessagesBySession(sessionId)).toHaveLength(999);

    const counts = await new Promise<number[]>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readonly",
      );
      const requests = ["memory_dict", "memory_fragments", "memory_facts"].map((store) =>
        transaction.objectStore(store).count()
      );
      transaction.oncomplete = () => resolve(requests.map((request) => request.result));
      transaction.onerror = () => reject(transaction.error);
    });
    expect(counts).toEqual([0, 0, 0]);
  }, 15_000);

  it("编辑历史消息时原子更新变量并失效下游摘要、快照与派生记忆", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["messages", "memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      const messagesStore = transaction.objectStore("messages");
      const downstream = messagesStore.get("message-40");
      downstream.onsuccess = () => messagesStore.put({
        ...downstream.result,
        metadata: {
          mobileTavernSessionState: { version: 1, variables: { stale: true } },
        },
      });
      transaction.objectStore("memory_dict").put({
        id: `${sessionId}:旧实体`, sessionId, entity: "旧实体", count: 1,
      });
      transaction.objectStore("memory_fragments").put({
        id: "fragment-before-edit", sessionId, content: "有效旧事件", participants: [], tags: [],
        sourceMessageIds: ["message-20"], sourceRole: "assistant", sourceTurnStart: 19,
        sourceTurnEnd: 19, status: "active", importance: 1, confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.objectStore("memory_fragments").put({
        id: "fragment-after-edit", sessionId, content: "应失效事件", participants: [], tags: [],
        sourceMessageIds: ["message-40"], sourceRole: "assistant", sourceTurnStart: 39,
        sourceTurnEnd: 39, status: "active", importance: 1, confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.objectStore("memory_facts").put({
        id: "fact-after-edit", sessionId, subject: "甲", predicate: "认识", object: "乙",
        tags: [], status: "active", validFromTurn: 39, sourceMessageId: "message-40",
        confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const edited = await updateSessionMessage(
      sessionId,
      { ...makeMessage(30), content: "修订后的正文" },
      { variables: { edited: true } },
    );
    const records = await getMessagesBySession(sessionId);
    const editedRecord = records.find((record) => record.id === "message-30");
    const downstreamRecord = records.find((record) => record.id === "message-40");

    expect(edited.variables).toEqual({ edited: true });
    expect(edited.summaries.map((summary) => summary.id)).toEqual(["summary-1"]);
    expect(editedRecord).toMatchObject({ content: "修订后的正文", tags: [], extractSource: "none" });
    expect(downstreamRecord?.metadata?.mobileTavernSessionState).toBeUndefined();
    expect(edited.charCount).toBe(records.reduce((total, record) => total + record.content.length, 0));

    const derived = await new Promise<[number, string[], number]>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readonly",
      );
      const dict = transaction.objectStore("memory_dict").index("sessionId")
        .count(IDBKeyRange.only(sessionId));
      const fragments = transaction.objectStore("memory_fragments").index("sessionId")
        .getAll(IDBKeyRange.only(sessionId));
      const facts = transaction.objectStore("memory_facts").index("sessionId")
        .count(IDBKeyRange.only(sessionId));
      transaction.oncomplete = () => resolve([
        dict.result,
        (fragments.result as Array<{ id: string }>).map((fragment) => fragment.id),
        facts.result,
      ]);
      transaction.onerror = () => reject(transaction.error);
    });
    expect(derived).toEqual([0, ["fragment-before-edit"], 0]);
  }, 15_000);

  it("后台抽取来源消息已被删除时不能重新插入词典、事件或事实", async () => {
    await deleteSessionMessage(sessionId, "message-40");
    const now = Date.now();
    await upsertDictEntry({
      sessionId,
      entity: "幽灵实体",
      firstSeenMsgId: "message-40",
      firstSeenTurn: 39,
      requireSourceMessage: true,
    });
    await upsertFragment({
      id: "ghost-fragment",
      sessionId,
      content: "幽灵事件",
      participants: [],
      tags: [],
      sourceMessageIds: ["message-40"],
      sourceRole: "assistant",
      sourceTurnStart: 39,
      sourceTurnEnd: 39,
      status: "active",
      importance: 1,
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    }, undefined, { requireSourceMessages: true });
    await evolveTemporalFact({
      id: "ghost-fact",
      sessionId,
      subject: "幽灵",
      predicate: "来自",
      object: "旧分支",
      tags: [],
      status: "active",
      validFromTurn: 39,
      sourceMessageId: "message-40",
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    }, undefined, { requireSourceMessage: true });

    const db = await getDB();
    const counts = await new Promise<number[]>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readonly",
      );
      const requests = ["memory_dict", "memory_fragments", "memory_facts"].map((store) =>
        transaction.objectStore(store).index("sessionId").count(IDBKeyRange.only(sessionId))
      );
      transaction.oncomplete = () => resolve(requests.map((request) => request.result));
      transaction.onerror = () => reject(transaction.error);
    });
    expect(counts).toEqual([0, 0, 0]);
  }, 15_000);

  it("完整导入覆盖已有会话时清除旧尾部消息且按最终数据重算统计", async () => {
    const importedMessages = [makeMessage(1), makeMessage(2), makeMessage(3)];
    await replaceCompleteSessions([{
      id: sessionId,
      characterId: "character-1",
      title: "覆盖导入",
      createdAt: 1,
      messages: importedMessages,
      summaries: [],
    }]);

    const records = await getMessagesBySession(sessionId);
    const stored = await getSessionById(sessionId);
    expect(records.map((record) => record.id)).toEqual(importedMessages.map((message) => message.id));
    expect(stored?.turnCount).toBe(1);
    expect(stored?.charCount).toBe(12);
  });

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
