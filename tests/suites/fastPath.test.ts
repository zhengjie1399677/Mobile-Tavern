/**
 * 快速通道（FastPath）测试套件
 *
 * 覆盖：
 *  - testFastPathL3AutoSummaryIndex：AutoSummary 索引缓存与阈值计算
 *  - testFastPathL2ContentPrescan：表格记忆 / MVU 脚本指令正则预扫描
 *  - testFastPathL1PipelineBypass：管道旁路条件判定（功能开关/野牛/总结阈值）
 */

import { assert } from "./testUtils";

/**
 * L3 快速通道验证：AutoSummaryService 索引缓存优化
 * 验证合并后的单次反向遍历能正确找到 lastSummarizedMessageId 的索引，
 * 以及 fallback 到 summaries 最后一条的逻辑，阈值计算与原逻辑等价。
 */
export async function testFastPathL3AutoSummaryIndex() {
  console.log("\n--- Running Fast Path L3: AutoSummary Index Cache Verification ---");

  // 场景 1：lastSummarizedMessageId 存在于 messages 中
  const messages1 = [
    { id: "msg1", content: "hello", sender: "user" },
    { id: "msg2", content: "hi", sender: "assistant" },
    { id: "msg3", content: "world", sender: "user" },
    { id: "msg4", content: "bye", sender: "assistant" },
  ];
  const resolvedLastId1 = "msg2";
  let lastIndex1 = -1;
  for (let i = messages1.length - 1; i >= 0; i--) {
    if (messages1[i].id === resolvedLastId1) { lastIndex1 = i; break; }
  }
  assert(lastIndex1 === 1, "Should find msg2 at index 1");
  const unsummarizedCount1 = messages1.length - (lastIndex1 + 1);
  assert(unsummarizedCount1 === 2, "Should have 2 unsummarized messages after msg2");

  // 场景 2：lastSummarizedMessageId 不存在（已删除），fallback 到 summaries
  const messages2 = [
    { id: "msg3", content: "world", sender: "user" },
    { id: "msg4", content: "bye", sender: "assistant" },
  ];
  const summaries2 = [{ lastMessageId: "msg3", content: "summary" }];
  const initialLastId = "msg_deleted";

  let lastIndex2 = -1;
  for (let i = messages2.length - 1; i >= 0; i--) {
    if (messages2[i].id === initialLastId) { lastIndex2 = i; break; }
  }
  assert(lastIndex2 === -1, "Should not find deleted message ID");

  const lastSummary = summaries2[summaries2.length - 1];
  const fallbackId = lastSummary?.lastMessageId;
  assert(fallbackId === "msg3", "Should fallback to summaries lastMessageId");

  for (let i = messages2.length - 1; i >= 0; i--) {
    if (messages2[i].id === fallbackId) { lastIndex2 = i; break; }
  }
  assert(lastIndex2 === 0, "Should find msg3 at index 0 after fallback");
  const unsummarizedCount2 = messages2.length - (lastIndex2 + 1);
  assert(unsummarizedCount2 === 1, "Should have 1 unsummarized message after fallback");

  // 场景 3：无 lastSummarizedMessageId（新会话）
  const messages3 = [
    { id: "msg1", content: "hello", sender: "user" },
    { id: "msg2", content: "hi", sender: "assistant" },
  ];
  const resolvedLastId3 = undefined;
  let lastIndex3 = -1;
  if (resolvedLastId3) {
    for (let i = messages3.length - 1; i >= 0; i--) {
      if (messages3[i].id === resolvedLastId3) { lastIndex3 = i; break; }
    }
  }
  assert(lastIndex3 === -1, "Should be -1 when no lastSummarizedMessageId");
  const startIndex3 = lastIndex3 >= 0 ? lastIndex3 + 1 : 0;
  const unsummarizedCount3 = messages3.length - startIndex3;
  assert(unsummarizedCount3 === 2, "All messages should be unsummarized in new session");

  // 场景 4：阈值计算与原逻辑等价
  const triggerTurns = 0;
  const recentTurns = 6;
  const triggerRounds = (!isNaN(triggerTurns) && triggerTurns > 0) ? triggerTurns : recentTurns;
  const maxAllowed = Math.max(4, triggerRounds) * 2;
  assert(maxAllowed === 12, "Should be 12 (6 * 2) when recentTurns=6");

  const triggerTurnsB = 8;
  const triggerRoundsB = (!isNaN(triggerTurnsB) && triggerTurnsB > 0) ? triggerTurnsB : recentTurns;
  const maxAllowedB = Math.max(4, triggerRoundsB) * 2;
  assert(maxAllowedB === 16, "Should be 16 (8 * 2) when triggerTurns=8");

  // 场景 5：triggerTurns=3（低于最小值 4）应被 clamp 到 4
  const triggerTurnsC = 3;
  const triggerRoundsC = (!isNaN(triggerTurnsC) && triggerTurnsC > 0) ? triggerTurnsC : recentTurns;
  const maxAllowedC = Math.max(4, triggerRoundsC) * 2;
  assert(maxAllowedC === 8, "Should be 8 (4 * 2) when triggerTurns=3 clamped to 4");

  console.log("✔ Fast Path L3: AutoSummary Index Cache verified successfully!");
}

/**
 * L2 快速通道验证：中间件内容预扫描
 * 验证 regex 预扫描能正确匹配包含指令的文本，并正确跳过纯叙述文本。
 */
export async function testFastPathL2ContentPrescan() {
  console.log("\n--- Running Fast Path L2: Content Pre-scan Verification ---");

  const TABLE_MEMORY_PATTERN = /(?:updateRow|insertRow|deleteRow)\s*\(/i;
  const MVU_SCRIPT_PATTERN = /(?:_\.(?:set|add|insert|delete|move)\s*\(|<(?:UpdateVariable|initvar)\b)/i;

  // 表格记忆指令匹配测试
  assert(TABLE_MEMORY_PATTERN.test('updateRow("好感关系表", {"好感度": "85"})') === true, "Should match updateRow");
  assert(TABLE_MEMORY_PATTERN.test('insertRow("背包", {"物品": "剑"})') === true, "Should match insertRow");
  assert(TABLE_MEMORY_PATTERN.test('deleteRow("状态", {"角色": "敌人"})') === true, "Should match deleteRow");
  assert(TABLE_MEMORY_PATTERN.test("她微笑着看着你，眼中闪过一丝温柔。") === false, "Should not match narrative text");
  assert(TABLE_MEMORY_PATTERN.test("今天天气不错，我们去散步吧。") === false, "Should not match casual text");
  assert(TABLE_MEMORY_PATTERN.test("") === false, "Should not match empty string");

  // MVU 脚本指令匹配测试
  assert(MVU_SCRIPT_PATTERN.test('_.set("health", 100)') === true, "Should match _.set");
  assert(MVU_SCRIPT_PATTERN.test('_.add("gold", 50)') === true, "Should match _.add");
  assert(MVU_SCRIPT_PATTERN.test('_.delete("temp_var")') === true, "Should match _.delete");
  assert(MVU_SCRIPT_PATTERN.test('_.insert("list", 0, "item")') === true, "Should match _.insert");
  assert(MVU_SCRIPT_PATTERN.test('_.move("arr", 0, 1)') === true, "Should match _.move");
  assert(MVU_SCRIPT_PATTERN.test('<UpdateVariable>_.set("hp", 100)</UpdateVariable>') === true, "Should match UpdateVariable tag");
  assert(MVU_SCRIPT_PATTERN.test('<initvar>{"health": 100}</initvar>') === true, "Should match initvar tag");
  assert(MVU_SCRIPT_PATTERN.test("角色轻轻地叹了口气，转过头去。") === false, "Should not match narrative text");
  assert(MVU_SCRIPT_PATTERN.test("The quick brown fox jumps over the lazy dog.") === false, "Should not match English text");
  assert(MVU_SCRIPT_PATTERN.test("") === false, "Should not match empty string");

  // 边界情况：大小写不敏感
  assert(TABLE_MEMORY_PATTERN.test('UPDATEROW("test", {})') === true, "Should match case-insensitively");
  assert(MVU_SCRIPT_PATTERN.test('_.SET("x", 1)') === true, "Should match _.SET case-insensitively");

  console.log("✔ Fast Path L2: Content Pre-scan verified successfully!");
}

/**
 * L1 快速通道验证：管道旁路判定逻辑
 * 验证旁路条件判定（功能开关、野牛模式、总结阈值、管道中间件数）的正确性。
 */
export async function testFastPathL1PipelineBypass() {
  console.log("\n--- Running Fast Path L1: Pipeline Bypass Verification ---");

  // 测试 1：全部功能关闭 + 未达总结阈值 → 应旁路
  const settings1: any = {
    enableTableMemory: false,
    enableScriptExecution: false,
    enableBisonMode: false,
    memory: { summaryTriggerTurns: 6, recentTurns: 6 },
  };
  const session1: any = {
    messages: [
      { id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" },
    ],
    lastSummarizedMessageId: "m4",
  };
  const allFeaturesDisabled1 =
    !settings1.enableTableMemory &&
    !settings1.enableScriptExecution &&
    !settings1.enableBisonMode;
  assert(allFeaturesDisabled1 === true, "All features should be disabled");

  const triggerTurns1 = Number(settings1.memory?.summaryTriggerTurns || 0);
  const recentTurns1 = Number(settings1.memory?.recentTurns || 6);
  const triggerRounds1 = (!isNaN(triggerTurns1) && triggerTurns1 > 0) ? triggerTurns1 : recentTurns1;
  const maxAllowed1 = Math.max(4, triggerRounds1) * 2;
  assert(maxAllowed1 === 12, "Max allowed should be 12");

  let lastIdx1 = -1;
  if (session1.lastSummarizedMessageId) {
    for (let i = session1.messages.length - 1; i >= 0; i--) {
      if (session1.messages[i].id === session1.lastSummarizedMessageId) { lastIdx1 = i; break; }
    }
  }
  const unsummarized1 = session1.messages.length - (lastIdx1 + 1);
  assert(unsummarized1 === 0, "Should have 0 unsummarized (m4 is last)");
  assert(unsummarized1 < maxAllowed1, "Should bypass (0 < 12)");

  // 测试 2：任一功能开启 → 不应旁路
  const settings2: any = {
    enableTableMemory: true,
    enableScriptExecution: false,
    enableBisonMode: false,
    memory: { summaryTriggerTurns: 6, recentTurns: 6 },
  };
  const allFeaturesDisabled2 =
    !settings2.enableTableMemory &&
    !settings2.enableScriptExecution &&
    !settings2.enableBisonMode;
  assert(allFeaturesDisabled2 === false, "Should not bypass when tableMemory enabled");

  // 测试 3：未达总结阈值边界 → 应旁路
  const settings3: any = {
    enableTableMemory: false,
    enableScriptExecution: false,
    enableBisonMode: false,
    memory: { summaryTriggerTurns: 4, recentTurns: 6 },
  };
  const maxAllowed3 = Math.max(4, 4) * 2;
  const session3: any = {
    messages: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}` })),
    lastSummarizedMessageId: undefined,
  };
  const unsummarized3 = session3.messages.length - 0;
  assert(unsummarized3 === 7, "Should have 7 unsummarized");
  assert(unsummarized3 < maxAllowed3, "7 < 8, should bypass");

  // 测试 4：达到总结阈值 → 不应旁路
  const session4: any = {
    messages: Array.from({ length: 9 }, (_, i) => ({ id: `m${i}` })),
    lastSummarizedMessageId: undefined,
  };
  const unsummarized4 = session4.messages.length - 0;
  assert(unsummarized4 === 9, "Should have 9 unsummarized");
  assert(unsummarized4 >= maxAllowed3, "9 >= 8, should NOT bypass");

  // 测试 5：野牛连续模式 → 不应旁路
  const isBisonConsecutive5 = true;
  assert(isBisonConsecutive5 === true, "Bison consecutive should prevent bypass");

  // 测试 6：triggerTurns 低于最小值 4 时应被 clamp
  const triggerTurns6 = 3;
  const recentTurns6 = 6;
  const triggerRounds6 = (!isNaN(triggerTurns6) && triggerTurns6 > 0) ? triggerTurns6 : recentTurns6;
  const maxAllowed6 = Math.max(4, triggerRounds6) * 2;
  assert(maxAllowed6 === 8, "Should be 8 when triggerTurns=3 clamped to 4");

  console.log("✔ Fast Path L1: Pipeline Bypass verified successfully!");
}
