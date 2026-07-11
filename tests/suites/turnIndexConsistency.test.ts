/**
 * turnIndex 一致性测试套件
 *
 * 验证新存储架构下 turnIndex 的正确性：
 *  - testTurnIndexBasicAppend：syncSessionMessages 批量写入，turnIndex = [0, 1, 2, ...]
 *  - testTurnIndexDeleteMiddleThenAppend：deleteMessageById + appendMessage 显式删除与追加
 *  - testTurnIndexDeleteAllThenAppend：全部删除后重新批量写入，turnIndex 从 0 开始
 *  - testTurnIndexMultipleAppends：多次 appendMessage 单条追加，turnIndex 持续递增
 *
 * 使用 fake-indexeddb 模拟真实 IDB 行为。
 */

import 'fake-indexeddb/auto';
import { assert } from "./testUtils";

/**
 * 辅助函数：读取指定会话的所有消息，按 turnIndex 排序
 */
async function getSessionMessages(db: IDBDatabase, sessionId: string): Promise<any[]> {
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");
  const index = store.index("sessionId");
  return new Promise((resolve, reject) => {
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const result = (req.result || []).sort((a: any, b: any) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
      resolve(result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function testTurnIndexBasicAppend() {
  console.log("\n--- Running turnIndex Basic Append Verification ---");
  const { __resetDBInstanceForTesting, syncSessionMessages, getDB } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_basic";

  // 批量写入 5 条消息
  const msgs = Array.from({ length: 5 }, (_, i) => ({
    id: `msg_${i}`,
    sender: i % 2 === 0 ? "user" : "assistant",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await syncSessionMessages(sessionId, msgs);

  const db = await getDB();
  const saved = await getSessionMessages(db, sessionId);
  assert(saved.length === 5, `Should have 5 messages, got ${saved.length}`);

  const turnIndices = saved.map(m => m.turnIndex);
  assert(JSON.stringify(turnIndices) === JSON.stringify([0, 1, 2, 3, 4]),
    `Initial turnIndex should be [0,1,2,3,4], got ${JSON.stringify(turnIndices)}`);

  console.log("✔ turnIndex basic append verified!");
}

export async function testTurnIndexDeleteMiddleThenAppend() {
  console.log("\n--- Running turnIndex Delete-Middle-Then-Append Verification ---");
  const { __resetDBInstanceForTesting, syncSessionMessages, appendMessage, deleteMessageById, getDB } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_delete_append";
  const db = await getDB();

  // 1. 初始批量写入 5 条消息 (turnIndex = [0, 1, 2, 3, 4])
  const msgs1 = Array.from({ length: 5 }, (_, i) => ({
    id: `msg_${i}`,
    sender: i % 2 === 0 ? "user" : "assistant",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await syncSessionMessages(sessionId, msgs1);

  const saved1 = await getSessionMessages(db, sessionId);
  assert(saved1.length === 5, `Should have 5 messages after initial sync`);

  // 2. 显式删除第 3 条 (msg_2)
  await deleteMessageById("msg_2");

  const afterDelete = await getSessionMessages(db, sessionId);
  assert(afterDelete.length === 4, `Should have 4 messages after delete, got ${afterDelete.length}`);
  assert(!afterDelete.find(m => m.id === "msg_2"), "msg_2 should be deleted");

  // 3. 单条追加新消息 (turnIndex 由调用方指定为 5，即 max(4)+1)
  await appendMessage({
    id: "msg_5",
    sessionId,
    role: "user",
    content: "新消息",
    createdAt: Date.now() + 5,
    turnIndex: 5,
  });

  const saved2 = await getSessionMessages(db, sessionId);
  assert(saved2.length === 5, `Should have 5 messages after append, got ${saved2.length}`);

  // 4. 验证保留的旧消息 turnIndex 未变
  const msg0 = saved2.find(m => m.id === "msg_0");
  const msg1 = saved2.find(m => m.id === "msg_1");
  const msg3 = saved2.find(m => m.id === "msg_3");
  const msg4 = saved2.find(m => m.id === "msg_4");
  assert(msg0 && msg0.turnIndex === 0, `msg_0 turnIndex should be 0, got ${msg0?.turnIndex}`);
  assert(msg1 && msg1.turnIndex === 1, `msg_1 turnIndex should be 1, got ${msg1?.turnIndex}`);
  assert(msg3 && msg3.turnIndex === 3, `msg_3 turnIndex should be 3, got ${msg3?.turnIndex}`);
  assert(msg4 && msg4.turnIndex === 4, `msg_4 turnIndex should be 4, got ${msg4?.turnIndex}`);

  // 5. 验证新消息 turnIndex = 5
  const msg5 = saved2.find(m => m.id === "msg_5");
  assert(msg5, `New message msg_5 should exist`);
  assert(msg5.turnIndex === 5,
    `New message turnIndex should be exactly 5, got ${msg5.turnIndex}`);

  // 6. 验证无重复
  const turnIndices2 = saved2.map(m => m.turnIndex);
  const uniqueSet = new Set(turnIndices2);
  assert(uniqueSet.size === turnIndices2.length,
    `turnIndex should have no duplicates, got ${JSON.stringify(turnIndices2)}`);

  console.log("✔ turnIndex delete-middle-then-append verified! (no duplicate)");
}

export async function testTurnIndexDeleteAllThenAppend() {
  console.log("\n--- Running turnIndex Delete-All-Then-Append Verification ---");
  const { __resetDBInstanceForTesting, syncSessionMessages, deleteMessageById, getDB } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_delete_all";
  const db = await getDB();

  // 1. 初始批量写入 3 条消息
  const msgs1 = Array.from({ length: 3 }, (_, i) => ({
    id: `msg_${i}`,
    sender: "user",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await syncSessionMessages(sessionId, msgs1);

  // 2. 显式删除所有消息
  for (const msg of msgs1) {
    await deleteMessageById(msg.id);
  }

  const afterDelete = await getSessionMessages(db, sessionId);
  assert(afterDelete.length === 0, `Should have 0 messages after delete-all, got ${afterDelete.length}`);

  // 3. 重新批量写入 2 条新消息 (turnIndex 从 0 重新开始)
  const msgs2 = [
    { id: "msg_new_0", sender: "user", content: "新消息 0", timestamp: Date.now() + 10 },
    { id: "msg_new_1", sender: "assistant", content: "新消息 1", timestamp: Date.now() + 11 },
  ];

  await syncSessionMessages(sessionId, msgs2);

  const saved = await getSessionMessages(db, sessionId);
  assert(saved.length === 2, `Should have 2 messages after delete-all+append, got ${saved.length}`);

  const turnIndices = saved.map(m => m.turnIndex).sort((a, b) => a - b);
  assert(JSON.stringify(turnIndices) === JSON.stringify([0, 1]),
    `turnIndex should be [0,1] after delete-all+append, got ${JSON.stringify(turnIndices)}`);

  console.log("✔ turnIndex delete-all-then-append verified!");
}

export async function testTurnIndexMultipleAppends() {
  console.log("\n--- Running turnIndex Multiple Appends Verification ---");
  const { __resetDBInstanceForTesting, syncSessionMessages, appendMessage, deleteMessageById, getDB } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_multiple";
  const db = await getDB();

  // 第一轮：批量写入 3 条消息 (turnIndex = [0, 1, 2])
  const msgs1 = Array.from({ length: 3 }, (_, i) => ({
    id: `msg_${i}`,
    sender: "user",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await syncSessionMessages(sessionId, msgs1);

  // 第二轮：单条追加 2 条新消息 (turnIndex = 3, 4)
  await appendMessage({
    id: "msg_3",
    sessionId,
    role: "user",
    content: "消息 3",
    createdAt: Date.now() + 3,
    turnIndex: 3,
  });
  await appendMessage({
    id: "msg_4",
    sessionId,
    role: "assistant",
    content: "消息 4",
    createdAt: Date.now() + 4,
    turnIndex: 4,
  });

  // 第三轮：删除中间(msg_1)，追加 1 条新消息 (turnIndex = 5)
  await deleteMessageById("msg_1");
  await appendMessage({
    id: "msg_5",
    sessionId,
    role: "user",
    content: "消息 5",
    createdAt: Date.now() + 5,
    turnIndex: 5,
  });

  const saved = await getSessionMessages(db, sessionId);
  assert(saved.length === 5, `Should have 5 messages after multiple appends, got ${saved.length}`);

  // 验证无重复
  const turnIndices = saved.map(m => m.turnIndex);
  const uniqueSet = new Set(turnIndices);
  assert(uniqueSet.size === turnIndices.length,
    `turnIndex should have no duplicates after multiple appends, got ${JSON.stringify(turnIndices)}`);

  // 验证保留的旧消息 turnIndex 未变
  const msg0 = saved.find(m => m.id === "msg_0");
  const msg2 = saved.find(m => m.id === "msg_2");
  assert(msg0 && msg0.turnIndex === 0, `msg_0 turnIndex should be 0, got ${msg0?.turnIndex}`);
  assert(msg2 && msg2.turnIndex === 2, `msg_2 turnIndex should be 2, got ${msg2?.turnIndex}`);

  // 验证第二轮新消息 turnIndex 精确值
  const msg3 = saved.find(m => m.id === "msg_3");
  const msg4 = saved.find(m => m.id === "msg_4");
  assert(msg3 && msg3.turnIndex === 3, `msg_3 turnIndex should be 3, got ${msg3?.turnIndex}`);
  assert(msg4 && msg4.turnIndex === 4, `msg_4 turnIndex should be 4, got ${msg4?.turnIndex}`);

  // 验证第三轮新消息 turnIndex 精确值
  const msg5 = saved.find(m => m.id === "msg_5");
  assert(msg5, `New message msg_5 should exist`);
  assert(msg5.turnIndex === 5,
    `msg_5 turnIndex should be exactly 5, got ${msg5.turnIndex}`);

  console.log("✔ turnIndex multiple appends verified! (no duplicate across rounds)");
}
