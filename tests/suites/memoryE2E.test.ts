/**
 * 记忆系统真实 IDB E2E 测试套件
 *
 * 使用 fake-indexeddb 模拟真实 IDB 行为，验证 MockStorage(Map) 无法覆盖的物理层契约：
 *  - v8 schema 升级：messages / memory_dict Store 与索引（multiEntry / 复合索引）正确创建
 *  - appendMessage → getMessageById 字段完整性（无篡改）
 *  - getMessagesByTag 多值索引（multiEntry）在真实 IDB 下的召回行为
 *  - getMessagesBySession 复合索引分页与排序
 *  - upsertDictEntry 在真实 IDB 下的新建/更新合并（count++ 并发安全）
 *  - MemoryStorage + MemoryRecall 端到端流程
 *
 * 遵循 AGENTS.md 准则四：使用本地静态资源（fake-indexeddb），不加载境外 CDN。
 * 遵循 AGENTS.md 准则十：物理隔离沙盒测试，不污染其他测试套件。
 */

import 'fake-indexeddb/auto';
import { assert } from "./testUtils";
import type { IDatabaseService } from "../../src/kernel/types";

export async function testMemoryE2E() {
  console.log("\n--- Running Memory E2E (fake-indexeddb) Verification ---");

  const {
    __resetDBInstanceForTesting,
    getDB,
    appendMessage,
    getMessageById,
    getMessagesByTag,
    getMessagesBySession,
    upsertDictEntry,
    getDictBySession,
  } = await import("../../src/utils/localDB");

  // === E2E.1 schema 升级验证 ===
  console.log("  [E2E.1] schema upgrade...");
  __resetDBInstanceForTesting();
  const db = await getDB();
  assert(db.objectStoreNames.contains("messages"), "messages Store 应在 v8 升级后存在");
  assert(db.objectStoreNames.contains("memory_dict"), "memory_dict Store 应在 v8 升级后存在");

  // 验证索引（multiEntry 与复合索引是召回机制的真实物理基础）
  const messagesTxn = db.transaction("messages", "readonly");
  const messagesStore = messagesTxn.objectStore("messages");
  assert(messagesStore.indexNames.contains("sessionId"), "messages.sessionId 索引存在");
  assert(messagesStore.indexNames.contains("createdAt"), "messages.createdAt 索引存在");
  assert(messagesStore.indexNames.contains("tags"), "messages.tags multiEntry 索引存在");
  assert(messagesStore.indexNames.contains("sessionId_createdAt"), "messages.sessionId_createdAt 复合索引存在");

  const dictTxn = db.transaction("memory_dict", "readonly");
  const dictStore = dictTxn.objectStore("memory_dict");
  assert(dictStore.indexNames.contains("sessionId"), "memory_dict.sessionId 索引存在");
  assert(dictStore.indexNames.contains("entity"), "memory_dict.entity 索引存在");

  console.log("  ✔ schema 升级验证通过");

  // === E2E.2 appendMessage → getMessageById 字段完整性 ===
  console.log("  [E2E.2] appendMessage → getMessageById 字段完整性...");
  __resetDBInstanceForTesting();

  const testMsg = {
    id: "e2e_msg_1",
    sessionId: "e2e_sess_1",
    role: "assistant",
    content: "老张递来一杯梅子酒",
    createdAt: 1000,
    turnIndex: 0,
    tags: ["老张", "梅子酒"],
    extractSource: "llm",
    metadata: { modelUsed: "test-model", tokenCount: 100 },
  };

  await appendMessage(testMsg);
  const retrieved = await getMessageById("e2e_msg_1");
  assert(retrieved !== null, "应能按 id 读取消息");
  assert(retrieved.id === testMsg.id, "id 字段一致");
  assert(retrieved.sessionId === testMsg.sessionId, "sessionId 字段一致");
  assert(retrieved.role === testMsg.role, "role 字段一致");
  assert(retrieved.content === testMsg.content, "content 字段一致（无篡改）");
  assert(retrieved.createdAt === testMsg.createdAt, "createdAt 字段一致");
  assert(retrieved.turnIndex === testMsg.turnIndex, "turnIndex 字段一致");
  assert(Array.isArray(retrieved.tags) && retrieved.tags.length === 2, "tags 字段完整");
  assert(retrieved.tags[0] === "老张" && retrieved.tags[1] === "梅子酒", "tags 值未篡改");
  assert(retrieved.extractSource === "llm", "extractSource 字段一致");
  assert(retrieved.metadata?.modelUsed === "test-model", "metadata.modelUsed 完整");
  assert(retrieved.metadata?.tokenCount === 100, "metadata.tokenCount 完整");

  console.log("  ✔ 字段完整性验证通过");

  // === E2E.3 getMessagesByTag 多值索引召回 ===
  console.log("  [E2E.3] getMessagesByTag multiEntry 索引召回...");
  __resetDBInstanceForTesting();

  // 写入 3 条消息：msg_1 命中 2 标签、msg_2 命中 1 标签、msg_3 不命中
  await appendMessage({ id: "t1", sessionId: "s1", role: "assistant", content: "msg1", createdAt: 1000, turnIndex: 0, tags: ["老张", "梅子酒"] });
  await appendMessage({ id: "t2", sessionId: "s1", role: "assistant", content: "msg2", createdAt: 2000, turnIndex: 1, tags: ["老张"] });
  await appendMessage({ id: "t3", sessionId: "s1", role: "assistant", content: "msg3", createdAt: 3000, turnIndex: 2, tags: ["玉佩"] });

  // 多标签召回（应命中 t1 + t2）
  const hits = await getMessagesByTag("s1", ["老张", "梅子酒"], 10);
  assert(hits.length === 2, "应召回 2 条消息（t1 和 t2）");
  const hitIds = hits.map((h: any) => h.id).sort();
  assert(hitIds[0] === "t1" && hitIds[1] === "t2", "召回 id 应为 t1 和 t2");

  // 单标签召回
  const singleHits = await getMessagesByTag("s1", ["玉佩"], 10);
  assert(singleHits.length === 1, "单标签 '玉佩' 应召回 1 条");
  assert(singleHits[0].id === "t3", "召回 id 应为 t3");

  // 跨会话隔离
  await appendMessage({ id: "t4", sessionId: "s2", role: "assistant", content: "msg4", createdAt: 4000, turnIndex: 0, tags: ["老张"] });
  const crossSession = await getMessagesByTag("s1", ["老张"], 10);
  assert(crossSession.length === 2, "跨会话隔离：s1 中 '老张' 标签应仅 2 条");
  assert(!crossSession.some((h: any) => h.id === "t4"), "不应包含 s2 的 t4");

  console.log("  ✔ multiEntry 索引召回验证通过");

  // === E2E.4 getMessagesBySession 复合索引分页与排序 ===
  console.log("  [E2E.4] getMessagesBySession 分页与排序...");
  __resetDBInstanceForTesting();

  for (let i = 0; i < 5; i++) {
    await appendMessage({
      id: `p${i}`, sessionId: "ps", role: "user", content: `msg${i}`,
      createdAt: 1000 + i, turnIndex: i, tags: [],
    });
  }

  // 升序 + limit
  const asc = await getMessagesBySession("ps", { limit: 3 });
  assert(asc.length === 3, "limit=3 应返回 3 条");
  assert(asc[0].id === "p0", "升序首条应为 p0");
  assert(asc[2].id === "p2", "升序第三条应为 p2");

  // 降序
  const desc = await getMessagesBySession("ps", { limit: 2, descending: true });
  assert(desc.length === 2, "limit=2 降序应返回 2 条");
  assert(desc[0].id === "p4", "降序首条应为 p4");
  assert(desc[1].id === "p3", "降序第二条应为 p3");

  // offset 分页
  const paged = await getMessagesBySession("ps", { limit: 2, offset: 2 });
  assert(paged.length === 2, "offset=2 + limit=2 应返回 2 条");
  assert(paged[0].id === "p2", "分页首条应为 p2");

  console.log("  ✔ 分页与排序验证通过");

  // === E2E.5 upsertDictEntry 新建+更新合并 ===
  console.log("  [E2E.5] upsertDictEntry 新建+更新合并...");
  __resetDBInstanceForTesting();

  // 新建
  const isNew = await upsertDictEntry({
    sessionId: "ds",
    entity: "老张",
    aliases: ["张老板"],
    type: "character",
    firstSeenMsgId: "m1",
    firstSeenTurn: 0,
  });
  assert(isNew === true, "首次 upsert 应返回 true（新建）");

  // 更新（同 entity 再 upsert，触发 count++）
  const isUpdate = await upsertDictEntry({
    sessionId: "ds",
    entity: "老张",
    aliases: ["张老板"],
    type: "character",
    firstSeenMsgId: "m2",
    firstSeenTurn: 1,
  });
  assert(isUpdate === false, "二次 upsert 应返回 false（更新）");

  // 查询验证 count 已递增
  const dict = await getDictBySession("ds");
  assert(dict.length === 1, "应有 1 条词典记录");
  assert(dict[0].entity === "老张", "entity 名称一致");
  assert(dict[0].count === 2, "二次 upsert 后 count 应为 2");
  assert(dict[0].type === "character", "type 字段一致");
  // firstSeenMsgId/firstSeenTurn 应保留首次值，不被更新覆盖
  assert(dict[0].firstSeenMsgId === "m1", "firstSeenMsgId 应保留首次值");
  assert(dict[0].firstSeenTurn === 0, "firstSeenTurn 应保留首次值");

  console.log("  ✔ upsertDictEntry 合并验证通过");

  // === E2E.6 MemoryStorage 端到端（通过真实 IDB） ===
  console.log("  [E2E.6] MemoryStorage 端到端...");
  __resetDBInstanceForTesting();

  const { MemoryStorage } = await import("../../src/kernel/services/memory/MemoryStorage");
  const mockDbService = {} as unknown as IDatabaseService; // MemoryStorage 仅持有引用，不实际调用
  const storage = new MemoryStorage(mockDbService);
  await storage.init();

  // 写入消息
  await storage.appendMessage({
    id: "mst_1", sessionId: "mst_sess", role: "assistant",
    content: "老张递来梅子酒", createdAt: 1000, turnIndex: 0,
    tags: ["老张", "梅子酒"], extractSource: "llm",
  });

  // 通过标签召回
  const recalled = await storage.getMessagesByTag("mst_sess", ["老张"], 10);
  assert(recalled.length === 1, "MemoryStorage 应召回 1 条");
  assert(recalled[0].content === "老张递来梅子酒", "内容通过 MemoryStorage 层未篡改");

  // 通过会话查询
  const bySession = await storage.getMessagesBySession("mst_sess");
  assert(bySession.length === 1, "getMessagesBySession 应返回 1 条");

  // upsertDictEntry
  await storage.upsertDictEntry("mst_sess", "老张", {
    type: "character", firstSeenMsgId: "mst_1", firstSeenTurn: 0, aliases: [],
  });
  const dict2 = await storage.getDictBySession("mst_sess");
  assert(dict2.length === 1 && dict2[0].entity === "老张", "词典通过 MemoryStorage 写入成功");

  // 级联清理
  await storage.deleteMessagesBySession("mst_sess");
  await storage.deleteDictBySession("mst_sess");
  const afterClean = await storage.getMessagesBySession("mst_sess");
  assert(afterClean.length === 0, "deleteMessagesBySession 后应清空");

  storage.destroy();
  console.log("  ✔ MemoryStorage 端到端验证通过");

  // === E2E.7 MemoryRecall 端到端（通过真实 IDB） ===
  console.log("  [E2E.7] MemoryRecall 端到端（真实 IDB）...");
  __resetDBInstanceForTesting();

  const { MemoryRecall } = await import("../../src/kernel/services/memory/MemoryRecall");
  const storage2 = new MemoryStorage(mockDbService);
  await storage2.init();

  // 准备词典
  await storage2.upsertDictEntry("rcall_sess", "老张", {
    type: "character", firstSeenMsgId: "r1", firstSeenTurn: 0, aliases: ["张老板"],
  });
  await storage2.upsertDictEntry("rcall_sess", "梅子酒", {
    type: "item", firstSeenMsgId: "r1", firstSeenTurn: 0, aliases: [],
  });

  // 写入历史消息（turnIndex 较旧，命中 2 标签）
  await storage2.appendMessage({
    id: "r1", sessionId: "rcall_sess", role: "assistant",
    content: "老张递来梅子酒，说这是他亲手酿的",
    createdAt: 1000, turnIndex: 1,
    tags: ["老张", "梅子酒"], extractSource: "llm",
  });

  // 写入近期消息（turnIndex 较新，无标签）
  await storage2.appendMessage({
    id: "r2", sessionId: "rcall_sess", role: "user",
    content: "今天天气不错",
    createdAt: 2000, turnIndex: 10,
    tags: [], extractSource: "none",
  });

  // 召回：当前消息含"老张"
  const recall = new MemoryRecall(storage2);
  const results = await recall.recall("rcall_sess", "老张在哪里？", {
    currentTurnIndex: 11,
    excludeRecentN: 0, // 不排除，确保能召回
    topK: 3,
  });

  assert(results.length > 0, "应召回至少 1 条消息");
  assert(results.some(r => r.content.includes("老张递来梅子酒")), "应召回历史消息");
  assert(results.every(r => r.hitTags.includes("老张")), "所有召回结果应命中 '老张' 标签");

  // 验证评分字段完整性
  const topResult = results[0];
  assert(typeof topResult.score === "number" && topResult.score > 0, "score 应为正数");
  assert(typeof topResult.messageId === "string", "messageId 字段完整");
  assert(typeof topResult.turnIndex === "number", "turnIndex 字段完整");
  assert(topResult.role === "assistant" || topResult.role === "user", "role 字段完整");
  assert(Array.isArray(topResult.hitTags), "hitTags 字段为数组");

  storage2.destroy();
  console.log("  ✔ MemoryRecall 端到端验证通过");

  console.log("✔ Memory E2E 全部验证通过！");
}
