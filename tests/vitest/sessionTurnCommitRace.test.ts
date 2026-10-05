// @vitest-environment node
/**
 * 场景级回归：同一会话连续两次 turn 提交必须都落盘。
 *
 * 提交类写入按「消息增量 upsert」实现（读现有会话 → 逐条 put → 重算计数），
 * 但它的 key 是会话级 `session:<id>:turn`。在写队列的 coalesceable 语义下，
 * 两次排队提交会被合并成一次，先到那轮的 messages 永远不会落盘——这是数据丢失。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_NAME } from "@/src/infrastructure/storage/dbSchema";
import { __resetConnectionForTesting, getDB } from "@/src/infrastructure/storage/idbConnection";
import { __resetWriteQueueForTesting } from "@/src/infrastructure/storage/idbQueue";
import { commitSessionTurn } from "@/src/infrastructure/storage/repositories/sessionTurnRepository";
import { replaceCompleteSessions } from "@/src/infrastructure/storage/repositories/sessionsWriteRepository";
import type { ChatSession, Message } from "@/src/types";

function message(id: string, content: string, timestamp: number): Message {
  return { id, sender: "user", content, timestamp } as Message;
}

function baseSession(): ChatSession {
  return {
    id: "session-race",
    characterId: "character-1",
    title: "并发提交会话",
    summaries: [],
    createdAt: 1,
    messages: [message("welcome", "欢迎", 0)],
  } as ChatSession;
}

async function readMessageIds(): Promise<string[]> {
  const db = await getDB();
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const request = transaction.objectStore("messages").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("read messages failed"));
  });
  return (rows as Array<{ id: string }>).map((row) => row.id).sort();
}

beforeEach(async () => {
  __resetWriteQueueForTesting();
  __resetConnectionForTesting();
  await new Promise<void>((resolve) => {
    const deletion = indexedDB.deleteDatabase(DB_NAME);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => resolve();
    deletion.onblocked = () => resolve();
  });
});

describe("同会话连续 turn 提交", () => {
  it("两次提交的 messages 都必须落盘", async () => {
    await replaceCompleteSessions([baseSession()]);

    // 不 await 第一次，制造「同 key 排队」的场景（连续发送 / 提交与重发交错）。
    const first = commitSessionTurn("session-race", {}, [message("m1", "第一轮", 1)]);
    const second = commitSessionTurn("session-race", {}, [message("m2", "第二轮", 2)]);
    await Promise.all([first, second]);

    expect(await readMessageIds()).toEqual(["m1", "m2", "welcome"]);
  });
});
