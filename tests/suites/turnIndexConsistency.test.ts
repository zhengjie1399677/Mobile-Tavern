/**
 * turnIndex 一致性测试套件
 *
 * 验证新存储架构下 turnIndex 的正确性：
 *  - testTurnIndexBasicAppend：完整会话导入后 turnIndex = [0, 1, 2, ...]
 *  - testTurnIndexDeleteMiddleThenAppend：会话删除事务 + 提交事务保持绝对序号
 *  - testTurnIndexDeleteAllThenAppend：全部删除后重新批量写入，turnIndex 从 0 开始
 *  - testTurnIndexMultipleAppends：不传局部数组长度，存储层原子分配绝对 turnIndex
 *
 * 使用 fake-indexeddb 模拟真实 IDB 行为。
 */

import 'fake-indexeddb/auto';
import { assert } from "./testUtils";
import {
  __resetDBInstanceForTesting,
  getDB,
  replaceCompleteSessions,
} from "../../src/utils/localDB";
import {
  appendMessage,
  replaceSessionBranch,
  upsertFragment,
  supersedeFragment,
  updateFragmentStatus,
} from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { commitSessionTurn } from "../../src/infrastructure/storage/repositories/sessionTurnRepository";
import { deleteSessionMessage } from "../../src/infrastructure/storage/repositories/sessionMessageDeleteRepository";
import type { Message } from "../../src/types";

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

async function seedSession(sessionId: string, messages: Message[]): Promise<void> {
  await replaceCompleteSessions([{
    id: sessionId,
    characterId: `character-${sessionId}`,
    title: "turnIndex 测试",
    createdAt: Date.now(),
    summaries: [],
    messages,
  }]);
}

export async function testTurnIndexBasicAppend() {
  console.log("\n--- Running turnIndex Basic Append Verification ---");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_basic";

  // 批量写入 5 条消息
  const msgs = Array.from({ length: 5 }, (_, i) => ({
    id: `basic_msg_${i}`,
    sender: i % 2 === 0 ? "user" : "assistant",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await seedSession(sessionId, msgs as Message[]);

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
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_delete_append";
  const db = await getDB();

  // 1. 初始批量写入 5 条消息 (turnIndex = [0, 1, 2, 3, 4])
  const msgs1 = Array.from({ length: 5 }, (_, i) => ({
    id: `middle_msg_${i}`,
    sender: i % 2 === 0 ? "user" : "assistant",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await seedSession(sessionId, msgs1 as Message[]);

  const saved1 = await getSessionMessages(db, sessionId);
  assert(saved1.length === 5, `Should have 5 messages after initial sync`);

  // 2. 显式删除第 3 条 (msg_2)
  await deleteSessionMessage(sessionId, "middle_msg_2");

  const afterDelete = await getSessionMessages(db, sessionId);
  assert(afterDelete.length === 4, `Should have 4 messages after delete, got ${afterDelete.length}`);
  assert(!afterDelete.find(m => m.id === "middle_msg_2"), "middle_msg_2 should be deleted");

  // 3. 单条追加新消息 (turnIndex 由调用方指定为 5，即 max(4)+1)
  await commitSessionTurn(sessionId, {}, [{
    id: "middle_msg_5",
    sender: "user",
    content: "新消息",
    timestamp: Date.now() + 5,
    turnIndex: 5,
  } as Message]);

  const saved2 = await getSessionMessages(db, sessionId);
  assert(saved2.length === 5, `Should have 5 messages after append, got ${saved2.length}`);

  // 4. 验证保留的旧消息 turnIndex 未变
  const msg0 = saved2.find(m => m.id === "middle_msg_0");
  const msg1 = saved2.find(m => m.id === "middle_msg_1");
  const msg3 = saved2.find(m => m.id === "middle_msg_3");
  const msg4 = saved2.find(m => m.id === "middle_msg_4");
  assert(msg0 && msg0.turnIndex === 0, `msg_0 turnIndex should be 0, got ${msg0?.turnIndex}`);
  assert(msg1 && msg1.turnIndex === 1, `msg_1 turnIndex should be 1, got ${msg1?.turnIndex}`);
  assert(msg3 && msg3.turnIndex === 3, `msg_3 turnIndex should be 3, got ${msg3?.turnIndex}`);
  assert(msg4 && msg4.turnIndex === 4, `msg_4 turnIndex should be 4, got ${msg4?.turnIndex}`);

  // 5. 验证新消息 turnIndex = 5
  const msg5 = saved2.find(m => m.id === "middle_msg_5");
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
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_delete_all";
  const db = await getDB();

  // 1. 初始批量写入 3 条消息
  const msgs1 = Array.from({ length: 3 }, (_, i) => ({
    id: `delete_all_msg_${i}`,
    sender: "user",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await seedSession(sessionId, msgs1 as Message[]);

  // 2. 显式删除所有消息
  for (const msg of msgs1) {
    await deleteSessionMessage(sessionId, msg.id);
  }

  const afterDelete = await getSessionMessages(db, sessionId);
  assert(afterDelete.length === 0, `Should have 0 messages after delete-all, got ${afterDelete.length}`);

  // 3. 重新批量写入 2 条新消息 (turnIndex 从 0 重新开始)
  const msgs2 = [
    { id: "msg_new_0", sender: "user", content: "新消息 0", timestamp: Date.now() + 10 },
    { id: "msg_new_1", sender: "assistant", content: "新消息 1", timestamp: Date.now() + 11 },
  ];

  await commitSessionTurn(sessionId, {}, msgs2 as Message[]);

  const saved = await getSessionMessages(db, sessionId);
  assert(saved.length === 2, `Should have 2 messages after delete-all+append, got ${saved.length}`);

  const turnIndices = saved.map(m => m.turnIndex).sort((a, b) => a - b);
  assert(JSON.stringify(turnIndices) === JSON.stringify([0, 1]),
    `turnIndex should be [0,1] after delete-all+append, got ${JSON.stringify(turnIndices)}`);

  console.log("✔ turnIndex delete-all-then-append verified!");
}

export async function testTurnIndexMultipleAppends() {
  console.log("\n--- Running turnIndex Multiple Appends Verification ---");
  __resetDBInstanceForTesting();

  const sessionId = "test_turnindex_multiple";
  const db = await getDB();

  // 第一轮：批量写入 3 条消息 (turnIndex = [0, 1, 2])
  const msgs1 = Array.from({ length: 3 }, (_, i) => ({
    id: `multi_msg_${i}`,
    sender: "user",
    content: `消息 ${i}`,
    timestamp: Date.now() + i,
  }));

  await seedSession(sessionId, msgs1 as Message[]);

  // 第二轮：模拟只加载尾页后继续对话；调用方不传局部数组长度，
  // 存储层必须从完整会话分配绝对 turnIndex = 3, 4。
  await commitSessionTurn(sessionId, {}, [{
    id: "multi_msg_3",
    sender: "user",
    content: "消息 3",
    timestamp: Date.now() + 3,
  }]);
  await commitSessionTurn(sessionId, {}, [{
    id: "multi_msg_4",
    sender: "assistant",
    content: "消息 4",
    timestamp: Date.now() + 4,
  }]);

  // 第三轮：删除中间消息后继续追加，必须取 max(turnIndex) + 1，而不是消息总数。
  await deleteSessionMessage(sessionId, "multi_msg_1");
  await commitSessionTurn(sessionId, {}, [{
    id: "multi_msg_5",
    sender: "user",
    content: "消息 5",
    timestamp: Date.now() + 5,
  }]);

  const saved = await getSessionMessages(db, sessionId);
  assert(saved.length === 5, `Should have 5 messages after multiple appends, got ${saved.length}`);

  // 验证无重复
  const turnIndices = saved.map(m => m.turnIndex);
  const uniqueSet = new Set(turnIndices);
  assert(uniqueSet.size === turnIndices.length,
    `turnIndex should have no duplicates after multiple appends, got ${JSON.stringify(turnIndices)}`);

  // 验证保留的旧消息 turnIndex 未变
  const msg0 = saved.find(m => m.id === "multi_msg_0");
  const msg2 = saved.find(m => m.id === "multi_msg_2");
  assert(msg0 && msg0.turnIndex === 0, `msg_0 turnIndex should be 0, got ${msg0?.turnIndex}`);
  assert(msg2 && msg2.turnIndex === 2, `msg_2 turnIndex should be 2, got ${msg2?.turnIndex}`);

  // 验证第二轮新消息 turnIndex 精确值
  const msg3 = saved.find(m => m.id === "multi_msg_3");
  const msg4 = saved.find(m => m.id === "multi_msg_4");
  assert(msg3 && msg3.turnIndex === 3, `msg_3 turnIndex should be 3, got ${msg3?.turnIndex}`);
  assert(msg4 && msg4.turnIndex === 4, `msg_4 turnIndex should be 4, got ${msg4?.turnIndex}`);

  // 验证第三轮新消息 turnIndex 精确值
  const msg5 = saved.find(m => m.id === "multi_msg_5");
  assert(msg5, `New message msg_5 should exist`);
  assert(msg5.turnIndex === 5,
    `msg_5 turnIndex should be exactly 5, got ${msg5.turnIndex}`);

  console.log("✔ turnIndex multiple appends verified! (no duplicate across rounds)");
}

async function getSessionFragments(db: IDBDatabase, sessionId: string): Promise<any[]> {
  const transaction = db.transaction("memory_fragments", "readonly");
  const request = transaction.objectStore("memory_fragments").index("sessionId")
    .getAll(IDBKeyRange.only(sessionId));
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function testRerollBranchAtomicReplace() {
  console.log("\n--- Running Reroll Branch Atomic Replace Verification ---");
  __resetDBInstanceForTesting();

  const sessionId = "test_reroll_atomic_branch";
  const originalMessages = Array.from({ length: 6 }, (_, index) => ({
    id: `reroll_old_${index}`,
    sender: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `旧消息 ${index}`,
    timestamp: Date.now() + index,
  }));
  const originalSession = {
    id: sessionId,
    characterId: "character-reroll",
    title: "重发原子事务",
    createdAt: Date.now(),
    summaries: [] as never[],
    messages: originalMessages,
  };

  await replaceCompleteSessions([originalSession]);
  const initialDb = await getDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = initialDb.transaction("memory_dict", "readwrite");
    transaction.objectStore("memory_dict").put({
      id: `${sessionId}:旧分支实体`,
      sessionId,
      entity: "旧分支实体",
      count: 1,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  // 模拟折叠边界或旧版本异常留下的孤儿回复：它与待覆盖分支拥有相同
  // turnIndex，但不在调用方根据当前 UI 快照计算出的 removedMessageIds 中。
  await appendMessage({
    id: "reroll_orphan_assistant",
    sessionId,
    role: "assistant",
    content: "不应残留的重复回复",
    createdAt: Date.now() + 9,
    turnIndex: 3,
  });
  const makeFragment = (id: string, turn: number) => ({
    id,
    sessionId,
    content: `事件 ${turn}`,
    participants: [] as never[],
    tags: ["测试"],
    sourceMessageIds: [`reroll_old_${turn}`],
    sourceRole: "assistant" as const,
    sourceTurnStart: turn,
    sourceTurnEnd: turn,
    status: "active" as const,
    importance: 0.7,
    confidence: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await upsertFragment(makeFragment("fragment_before_branch", 2));
  await upsertFragment(makeFragment("fragment_in_old_branch", 4));
  const correctedFragment = {
    ...makeFragment("fragment_corrected", 2),
    content: "修正后的事件",
    supersedesId: "fragment_before_branch",
  };
  await supersedeFragment("fragment_before_branch", correctedFragment);
  let correctionChain = await getSessionFragments(await getDB(), sessionId);
  assert(
    correctionChain.find((fragment) => fragment.id === "fragment_before_branch")?.status === "superseded",
    "纠错必须保留原片段并标记为已被修订"
  );
  assert(
    correctionChain.find((fragment) => fragment.id === "fragment_corrected")?.status === "active",
    "纠错后的新片段必须成为有效记忆"
  );
  await updateFragmentStatus("fragment_corrected", "invalid");
  correctionChain = await getSessionFragments(await getDB(), sessionId);
  assert(
    correctionChain.find((fragment) => fragment.id === "fragment_corrected")?.status === "invalid",
    "事件片段必须支持显式失效"
  );

  const replacement = {
    id: "reroll_new_assistant",
    sender: "assistant" as const,
    content: "新的重发回复",
    timestamp: Date.now() + 10,
  };
  const finalSession = {
    ...originalSession,
    // 将孤儿副本也放入内存快照，模拟旧 APK 双回复导致数组长度比真实分支多 1。
    // replaceSessionBranch 必须从 removedMessageIds 对应记录校准到 turnIndex=3，
    // 不能采用数组长度推导出的错误边界 4。
    messages: [
      ...originalMessages.slice(0, 3),
      {
        id: "reroll_orphan_assistant",
        sender: "assistant" as const,
        content: "不应残留的重复回复",
        timestamp: Date.now() + 9,
      },
      replacement,
    ],
  };
  await replaceSessionBranch(
    finalSession,
    originalMessages.slice(3).map((message) => message.id),
    [replacement]
  );

  const db = await getDB();
  const savedMessages = await getSessionMessages(db, sessionId);
  assert(savedMessages.length === 4, `原子替换后应有 4 条消息，实际 ${savedMessages.length}`);
  assert(
    originalMessages.slice(3).every((message) => !savedMessages.some((saved) => saved.id === message.id)),
    "原子替换后旧分支消息必须全部删除"
  );
  assert(
    !savedMessages.some((message) => message.id === "reroll_orphan_assistant"),
    "分支起点之后未列入 removedMessageIds 的孤儿回复也必须删除"
  );
  assert(savedMessages.some((message) => message.id === replacement.id), "新回复必须与删除操作同事务写入");
  const savedFragments = await getSessionFragments(db, sessionId);
  assert(savedFragments.some((fragment) => fragment.id === "fragment_before_branch"), "分支起点前的事件修订链必须保留");
  assert(savedFragments.some((fragment) => fragment.id === "fragment_corrected"), "分支起点前的纠错片段必须保留");
  assert(!savedFragments.some((fragment) => fragment.id === "fragment_in_old_branch"), "旧分支事件记忆必须与消息原子清理");
  const dictCount = await new Promise<number>((resolve, reject) => {
    const request = db.transaction("memory_dict", "readonly").objectStore("memory_dict")
      .index("sessionId").count(IDBKeyRange.only(sessionId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert(dictCount === 0, "分支替换后无法证明有效的自动词典必须清空重建");

  const sessionRecord = await new Promise<any>((resolve, reject) => {
    const request = db.transaction("sessions", "readonly").objectStore("sessions").get(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert(!("messages" in sessionRecord), "sessions Store 不得写入 messages 大数组");
  assert(sessionRecord.turnCount === 2, `会话缓存轮数应同步更新为 2，实际 ${sessionRecord.turnCount}`);

  let staleBoundaryError: unknown = null;
  try {
    await replaceSessionBranch(
      { ...finalSession, messages: [...finalSession.messages.slice(0, -1), { ...replacement, id: "stale_boundary_new" }] },
      ["missing-old-branch-message"],
      [{ ...replacement, id: "stale_boundary_new" }],
    );
  } catch (error) {
    staleBoundaryError = error;
  }
  assert(staleBoundaryError !== null, "失效的旧分支边界必须失败关闭，不能退回内存数组长度清扫");
  const afterStaleBoundary = await getSessionMessages(db, sessionId);
  assert(afterStaleBoundary.some((message) => message.id === replacement.id), "边界失效时原分支必须保持不变");
  assert(!afterStaleBoundary.some((message) => message.id === "stale_boundary_new"), "边界失效时不得提交新消息");

  const aborted = new AbortController();
  aborted.abort();
  let abortError: unknown = null;
  try {
    await replaceSessionBranch(
      { ...finalSession, messages: [...finalSession.messages.slice(0, -1), { ...replacement, id: "should_not_commit" }] },
      [replacement.id],
      [{ ...replacement, id: "should_not_commit" }],
      aborted.signal
    );
  } catch (error) {
    abortError = error;
  }
  assert(abortError !== null, "预中断的分支替换必须拒绝提交");
  const afterAbort = await getSessionMessages(db, sessionId);
  assert(afterAbort.some((message) => message.id === replacement.id), "中断后原分支替换结果必须保留");
  assert(!afterAbort.some((message) => message.id === "should_not_commit"), "中断事务不得写入新消息");

  // 空 removedMessageIds：重发最后一条用户消息时只能追加，不得删除更早历史。
  const appendOnlySessionId = "test_reroll_append_only";
  const appendOnlyMessages = Array.from({ length: 5 }, (_, index) => ({
    id: `append_old_${index}`,
    sender: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `旧消息 ${index}`,
    timestamp: Date.now() + index,
  }));
  const appendOnlySession = {
    id: appendOnlySessionId,
    characterId: "character-append-only",
    title: "追加不删历史",
    createdAt: Date.now(),
    summaries: [] as never[],
    messages: appendOnlyMessages,
  };
  await replaceCompleteSessions([appendOnlySession]);

  const newAi = {
    id: "append_new_ai",
    sender: "assistant" as const,
    content: "新的重发回复",
    timestamp: Date.now() + 10,
  };
  await replaceSessionBranch(
    { ...appendOnlySession, messages: [appendOnlyMessages[4], newAi] },
    [],
    [newAi]
  );
  const appendOnlySaved = await getSessionMessages(db, appendOnlySessionId);
  assert(appendOnlySaved.length === 6, `无 removedMessageIds 时必须只追加不删历史，实际 ${appendOnlySaved.length}`);
  assert(appendOnlySaved.some((message) => message.id === "append_old_4"), "重发最后一条用户消息必须保留该用户消息");
  assert(appendOnlySaved.some((message) => message.id === "append_new_ai"), "新 AI 回复必须写入");

  console.log("✔ Reroll branch atomic replace and abort rollback verified!");
}
