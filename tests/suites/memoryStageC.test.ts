/**
 * 记忆系统阶段 C 测试套件
 *
 * 覆盖阶段 C 全部交付物：
 *  - testMemoryStateTable：默认表初始化 + getSheet + parseAICommand + processTableMemory CRUD
 *  - testMemorySummary：触发检测 + LLM 调用 + 瘦身 SummaryCard（砸 5 条正则状态抽离）
 *
 * 拆分为独立文件遵循 AGENTS.md 准则一（单文件 ≤1000 行），与 memoryService.test.ts 物理分轨。
 * 测试遵循 AGENTS.md 准则八/十 TDD 单兵验证流程，在 tests/run_all_tests.ts 中聚合执行。
 */

import { assert } from "./testUtils";
import type { MemoryStorage } from "../../src/kernel/services/memory/MemoryStorage";
import type { IKernel } from "../../src/kernel/types";
import type { ChatSession, UserSettings, CharacterCard, Message, SummaryCard } from "../../src/types";

// ===== 测试 7：MemoryStateTable =====

export async function testMemoryStateTable() {
  console.log("\n--- Running MemoryStateTable Verification ---");
  const { MemoryStateTable } = await import(
    "../../src/kernel/services/memory/MemoryStateTable"
  );

  // 用 MockStorage 占位（MemoryStateTable 仅持有引用，目前不实际调用）
  const mockStorage = {} as unknown as MemoryStorage;
  const stateTable = new MemoryStateTable(mockStorage);
  stateTable.init();

  // === 7.1 initDefaultSheets ===
  console.log("  [7.1] initDefaultSheets...");

  const sheets = stateTable.initDefaultSheets("艾莉丝");
  assert(sheets.length === 4, "Should create 4 default sheets");
  assert(sheets[0].name === "关系", "First sheet should be '关系'");
  assert(sheets[1].name === "物品", "Second sheet should be '物品'");
  assert(sheets[2].name === "位置", "Third sheet should be '位置'");
  assert(sheets[3].name === "任务", "Fourth sheet should be '任务'");

  // "关系"表应有初始行
  assert(sheets[0].rows.length === 1, "Relation sheet should have 1 initial row");
  assert(sheets[0].rows[0][0] === "艾莉丝", "Relation sheet initial row should use character name");
  assert(sheets[0].rows[0][1] === "50", "Relation sheet initial 好感度 = 50");

  // 其他表应为空
  assert(sheets[1].rows.length === 0, "Inventory sheet should be empty");
  assert(sheets[2].rows.length === 0, "Location sheet should be empty");
  assert(sheets[3].rows.length === 0, "Quest sheet should be empty");

  // 深拷贝验证：修改返回值不影响内部状态
  sheets[0].rows[0][0] = "modified";
  const sheets2 = stateTable.initDefaultSheets("艾莉丝");
  assert(sheets2[0].rows[0][0] === "艾莉丝", "initDefaultSheets should return deep copy");

  console.log("  ✔ initDefaultSheets verified");

  // === 7.2 getSheet ===
  console.log("  [7.2] getSheet...");

  const relationSheet = stateTable.getSheet(sheets2, "关系");
  assert(relationSheet !== undefined, "getSheet should find '关系'");
  assert(relationSheet?.id === "sheet_relation", "Relation sheet id correct");

  const notFound = stateTable.getSheet(sheets2, "不存在的表");
  assert(notFound === undefined, "getSheet should return undefined for non-existent sheet");

  console.log("  ✔ getSheet verified");

  // === 7.3 parseAICommand ===
  console.log("  [7.3] parseAICommand...");

  const rawContent = `对话内容前缀
updateRow("关系", {"角色": "艾莉丝"}, {"好感度": "60"})
insertRow("物品", {"物品名": "梅子酒", "数量": "1"})
deleteRow("任务", {"任务名": "旧任务"})
对话内容后缀`;

  const actions = stateTable.parseAICommand(rawContent);
  assert(actions.length === 3, "Should parse 3 actions");

  assert((actions[0].type as string) === "updaterow", "First action type = updateRow");
  assert(actions[0].sheetName === "关系", "First action sheet = '关系'");
  assert(actions[0].param1["角色"] === "艾莉丝", "First action param1 correct");
  assert(actions[0].param2?.["好感度"] === "60", "First action param2 correct");

  assert((actions[1].type as string) === "insertrow", "Second action type = insertRow");
  assert(actions[1].param2 === undefined, "insertRow has no param2");

  assert((actions[2].type as string) === "deleterow", "Third action type = deleteRow");

  // 空内容
  assert(stateTable.parseAICommand("").length === 0, "Empty content returns empty");

  // 无指令内容
  assert(
    stateTable.parseAICommand("普通对话内容").length === 0,
    "Content without actions returns empty"
  );

  console.log("  ✔ parseAICommand verified");

  // === 7.4 processTableMemory: updateRow 双参数模式 ===
  console.log("  [7.4] processTableMemory updateRow double-param...");

  const sheets3 = stateTable.initDefaultSheets("艾莉丝");
  const result1 = stateTable.processTableMemory(
    sheets3,
    `updateRow("关系", {"角色": "艾莉丝"}, {"好感度": "75", "当前状态描述": "关系更亲近了"})`
  );
  assert(result1.hasChanges === true, "updateRow should report hasChanges");
  const relationSheet1 = result1.updatedMemory.find((s) => s.name === "关系")!;
  assert(relationSheet1.rows[0][1] === "75", "好感度 should be updated to 75");
  assert(
    relationSheet1.rows[0][3] === "关系更亲近了",
    "当前状态描述 should be updated"
  );
  // 清理后文本应为空（原始内容只有指令）
  assert(result1.cleanContent === "", "Clean content should be empty after stripping instruction");

  console.log("  ✔ updateRow double-param verified");

  // === 7.5 processTableMemory: updateRow 单参数模式 ===
  console.log("  [7.5] processTableMemory updateRow single-param...");

  const sheets4 = stateTable.initDefaultSheets("艾莉丝");
  const result2 = stateTable.processTableMemory(
    sheets4,
    `updateRow("关系", {"好感度": "90"})`
  );
  assert(result2.hasChanges === true, "Single-param updateRow should report hasChanges");
  const relationSheet2 = result2.updatedMemory.find((s) => s.name === "关系")!;
  assert(relationSheet2.rows[0][1] === "90", "好感度 should be updated to 90 (default first row)");

  console.log("  ✔ updateRow single-param verified");

  // === 7.6 processTableMemory: insertRow ===
  console.log("  [7.6] processTableMemory insertRow...");

  const sheets5 = stateTable.initDefaultSheets("艾莉丝");
  const result3 = stateTable.processTableMemory(
    sheets5,
    `insertRow("物品", {"物品名": "梅子酒", "数量": "1", "获得方式": "老张赠送", "备注": "暖心礼物"})`
  );
  assert(result3.hasChanges === true, "insertRow should report hasChanges");
  const inventorySheet = result3.updatedMemory.find((s) => s.name === "物品")!;
  assert(inventorySheet.rows.length === 1, "Inventory should have 1 row after insert");
  assert(inventorySheet.rows[0][0] === "梅子酒", "Inserted 物品名 = 梅子酒");
  assert(inventorySheet.rows[0][1] === "1", "Inserted 数量 = 1");

  console.log("  ✔ insertRow verified");

  // === 7.7 processTableMemory: deleteRow ===
  console.log("  [7.7] processTableMemory deleteRow...");

  const sheets6 = stateTable.initDefaultSheets("艾莉丝");
  // 先 insert 2 行再 delete 1 行
  const insertContent = `insertRow("物品", {"物品名": "梅子酒", "数量": "1"})
insertRow("物品", {"物品名": "玉佩", "数量": "1"})`;
  const afterInsert = stateTable.processTableMemory(sheets6, insertContent);
  assert(
    afterInsert.updatedMemory.find((s) => s.name === "物品")!.rows.length === 2,
    "Should have 2 rows after 2 inserts"
  );

  const afterDelete = stateTable.processTableMemory(
    afterInsert.updatedMemory,
    `deleteRow("物品", {"物品名": "梅子酒"})`
  );
  assert(afterDelete.hasChanges === true, "deleteRow should report hasChanges");
  const inventoryAfterDelete = afterDelete.updatedMemory.find((s) => s.name === "物品")!;
  assert(inventoryAfterDelete.rows.length === 1, "Should have 1 row after delete");
  assert(inventoryAfterDelete.rows[0][0] === "玉佩", "Remaining row should be 玉佩");

  console.log("  ✔ deleteRow verified");

  // === 7.8 宽松 JSON 解析（单引号、未引号键名） ===
  console.log("  [7.8] loose JSON parsing...");

  const sheets7 = stateTable.initDefaultSheets("艾莉丝");
  const result4 = stateTable.processTableMemory(
    sheets7,
    `updateRow('关系', {角色: '艾莉丝'}, {好感度: '88'})`
  );
  assert(result4.hasChanges === true, "Loose JSON (single quotes + unquoted keys) should parse");
  const relationSheet4 = result4.updatedMemory.find((s) => s.name === "关系")!;
  assert(relationSheet4.rows[0][1] === "88", "好感度 should be updated via loose JSON");

  console.log("  ✔ loose JSON parsing verified");

  // === 7.9 多指令混合 + 文本清理 ===
  console.log("  [7.9] mixed actions + text cleanup...");

  const sheets8 = stateTable.initDefaultSheets("艾莉丝");
  const mixedContent = `老张递来一杯梅子酒。
updateRow("关系", {"角色": "艾莉丝"}, {"好感度": "80"})
insertRow("物品", {"物品名": "梅子酒", "数量": "1"})
"这酒是我亲手酿的，"老张笑着说。`;

  const result5 = stateTable.processTableMemory(sheets8, mixedContent);
  assert(result5.hasChanges === true, "Mixed actions should report hasChanges");
  // 验证指令残留被清理，对话文本保留
  assert(
    result5.cleanContent.includes("老张递来一杯梅子酒"),
    "Clean content should preserve dialogue before instructions"
  );
  assert(
    result5.cleanContent.includes("老张笑着说"),
    "Clean content should preserve dialogue after instructions"
  );
  assert(
    !result5.cleanContent.includes("updateRow"),
    "Clean content should NOT contain updateRow"
  );
  assert(
    !result5.cleanContent.includes("insertRow"),
    "Clean content should NOT contain insertRow"
  );

  console.log("  ✔ mixed actions + text cleanup verified");

  // === 7.10 不存在的表名静默降级 ===
  console.log("  [7.10] non-existent sheet name graceful degradation...");

  const sheets9 = stateTable.initDefaultSheets("艾莉丝");
  const result6 = stateTable.processTableMemory(
    sheets9,
    `updateRow("不存在的表", {"key": "val"}, {"key2": "val2"})`
  );
  // 不存在的表名：指令被清理，但 hasChanges 为 false（无实际变更）
  assert(result6.cleanContent === "", "Instruction should be stripped even for non-existent sheet");
  assert(result6.hasChanges === false, "No actual changes for non-existent sheet");
  assert(result6.updatedMemory.length === 4, "Memory array unchanged");

  console.log("  ✔ non-existent sheet name graceful degradation verified");

  // === 7.11 无指令内容原样返回 ===
  console.log("  [7.11] no-instruction content passthrough...");

  const sheets10 = stateTable.initDefaultSheets("艾莉丝");
  const plainText = "这是一段普通的对话内容，没有任何表格指令。";
  const result7 = stateTable.processTableMemory(sheets10, plainText);
  assert(result7.hasChanges === false, "No-instruction content should not report hasChanges");
  assert(result7.cleanContent === plainText, "Plain text should pass through unchanged");
  assert(result7.updatedMemory.length === 4, "Memory array unchanged");

  console.log("  ✔ no-instruction content passthrough verified");

  // === 7.12 destroy 后仍可调用纯计算方法（契约一致性） ===
  console.log("  [7.12] destroy lifecycle...");

  const stateTable2 = new MemoryStateTable(mockStorage);
  stateTable2.init();
  stateTable2.destroy();
  // 纯计算服务 destroy 后仍可调用（无异步任务依赖 abortController）
  const sheetsAfterDestroy = stateTable2.initDefaultSheets("test");
  assert(sheetsAfterDestroy.length === 4, "initDefaultSheets should work after destroy (pure compute)");

  console.log("  ✔ destroy lifecycle verified");

  // === 7.13 空表 updateRow 单参数 no-op（E-4 修复） ===
  console.log("  [7.13] empty sheet updateRow single-param no-op...");

  const sheets11 = stateTable.initDefaultSheets("艾莉丝");
  // 物品表初始为空
  const inventoryBefore = sheets11.find((s) => s.name === "物品")!;
  assert(inventoryBefore.rows.length === 0, "物品表初始应为空");

  // 对空表执行 updateRow 单参数：应静默跳过，不插入半空行
  const result8 = stateTable.processTableMemory(
    sheets11,
    `updateRow("物品", {"物品名": "梅子酒", "数量": "1"})`
  );
  assert(result8.hasChanges === false, "空表 updateRow 单参数应 no-op (hasChanges=false)");
  const inventoryAfter = result8.updatedMemory.find((s) => s.name === "物品")!;
  assert(inventoryAfter.rows.length === 0, "空表 updateRow 单参数不应插入半空行");
  // 指令残留仍被清理
  assert(result8.cleanContent === "", "指令残留仍应被清理");

  // 对照：非空表 updateRow 单参数仍正常工作
  const sheets12 = stateTable.initDefaultSheets("艾莉丝");
  const result9 = stateTable.processTableMemory(
    sheets12,
    `updateRow("关系", {"好感度": "88"})`
  );
  assert(result9.hasChanges === true, "非空表 updateRow 单参数应正常生效");
  const relationAfter = result9.updatedMemory.find((s) => s.name === "关系")!;
  assert(relationAfter.rows[0][1] === "88", "非空表 updateRow 单参数应更新第一行");

  console.log("  ✔ empty sheet updateRow single-param no-op verified");

  console.log("✔ MemoryStateTable verified successfully!");
}

// ===== 测试 8：MemorySummary =====

export async function testMemorySummary() {
  console.log("\n--- Running MemorySummary Verification ---");
  const { MemorySummary } = await import("../../src/kernel/services/memory/MemorySummary");

  // === Mock 基础设施 ===

  /** Mock LLM 响应内容 */
  let mockLlmResponse = "";
  let mockLlmStatus = 200;
  let llmCallCount = 0;

  /** Mock LLM 服务 */
  const mockLlm = {
    universalFetch: async (_type: string, _config: any, _signal?: AbortSignal) => {
      llmCallCount++;
      return {
        ok: mockLlmStatus === 200,
        status: mockLlmStatus,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: mockLlmResponse } }],
          }),
      };
    },
  };

  /** Mock Database 服务：内存版 sessions 存储 */
  const mockDb = {
    sessions: new Map<string, any>(),
    async getSessionById(id: string) {
      return this.sessions.get(id) ?? null;
    },
    async saveSession(session: any) {
      this.sessions.set(session.id, { ...session });
    },
    async appendSessionSummary(sessionId: string, summary: SummaryCard) {
      const current = this.sessions.get(sessionId);
      if (!current) throw new Error(`Session not found: ${sessionId}`);
      const next = {
        ...current,
        summaries: [...(current.summaries || []), summary],
        lastSummarizedMessageId: summary.lastMessageId,
      };
      this.sessions.set(sessionId, next);
      return next;
    },
  };

  /** Mock Kernel */
  const mockKernel = {
    getService(name: string) {
      if (name === "llm") return mockLlm;
      if (name === "database") return mockDb;
      throw new Error(`Unknown service: ${name}`);
    },
  } as unknown as IKernel;

  /** 构造测试用 session */
  function buildSession(msgCount: number, opts?: { lastSummarizedId?: string; summaryCount?: number }): ChatSession {
    const messages: Message[] = [];
    for (let i = 0; i < msgCount; i++) {
      messages.push({
        id: `msg_${i}`,
        sender: i % 2 === 0 ? "user" : "assistant",
        content: `消息内容 ${i}`,
        timestamp: 1000 + i,
      });
    }
    const summaries: SummaryCard[] = [];
    for (let i = 0; i < (opts?.summaryCount ?? 0); i++) {
      summaries.push({
        id: `summary_${i}`,
        timeTag: `第${i + 1}幕`,
        location: "未知地点",
        content: `摘要 ${i}`,
        lastMessageId: `msg_${i * 10}`,
      });
    }
    return {
      id: "sess_test",
      characterId: "test_character",
      title: "Test Session",
      createdAt: 0,
      messages,
      summaries,
      lastSummarizedMessageId: opts?.lastSummarizedId,
    };
  }

  /** 构造测试用 settings */
  function buildSettings(opts?: { apiKey?: string; triggerTurns?: number }): UserSettings {
    return {
      api: {
        type: "openai-compat",
        apiKey: opts?.apiKey ?? "test-key",
        baseUrl: "https://api.test.com",
        modelName: "test-model",
        bypassProxy: false,
      },
      memory: {
        recentTurns: 6,
        summaryTriggerTurns: opts?.triggerTurns ?? 5,
        summaryLength: 150,
        summarySystemPrompt: "请总结这段对话",
        timeTagTemplate: "第{{index}}幕",
      },
      preset: {
        id: "test_preset",
        name: "Test Preset",
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        repetitionPenalty: 1.1,
        maxTokens: 1000,
      },
      promptConfig: {
        mainPrompt: "",
        jailbreakPrompt: "",
        useJailbreak: false,
        instructTemplate: "default",
        systemPrefix: "",
        systemSuffix: "",
        userPrefix: "",
        userSuffix: "",
        assistantPrefix: "",
        assistantSuffix: "",
      },
      userName: "玩家",
    };
  }

  /** 构造测试用 character */
  const testCharacter: CharacterCard = {
    id: "char_test",
    name: "艾莉丝",
    description: "",
    personality: "",
    scenario: "王都旅馆的深夜",
    first_mes: "",
    mes_example: "",
  };

  // === 8.1 未达阈值不触发 ===
  console.log("  [8.1] below threshold - no trigger...");

  const storage1 = {} as unknown as MemoryStorage;
  const summary1 = new MemorySummary(storage1);
  summary1.init(mockKernel);

  // triggerTurns=5 → maxAllowedUnsummarized=10；只有 5 条消息未总结 → 不触发
  const session1 = buildSession(5);
  const result1 = await summary1.checkAndSummarize(
    session1,
    buildSettings(),
    testCharacter,
    false
  );
  assert(result1 === session1, "Below threshold should return original session");
  assert(llmCallCount === 0, "LLM should NOT be called below threshold");

  console.log("  ✔ below threshold verified");

  // === 8.2 达阈值触发 ===
  console.log("  [8.2] reach threshold - trigger summary...");

  const storage2 = {} as unknown as MemoryStorage;
  const summary2 = new MemorySummary(storage2);
  summary2.init(mockKernel);

  // triggerTurns=5 → maxAllowedUnsummarized=10；12 条消息未总结 → 触发
  const session2 = buildSession(12);
  mockDb.sessions.set("sess_test", { ...session2 });
  mockLlmResponse = "主角与艾莉丝在王都旅馆相识，交谈甚欢。";
  llmCallCount = 0;

  const result2 = await summary2.checkAndSummarize(
    session2,
    buildSettings(),
    testCharacter,
    false
  );
  assert(result2 !== session2, "Triggered should return new session");
  assert(llmCallCount === 1, "LLM should be called once");
  assert(result2.summaries.length === 1, "Should have 1 summary card");
  assert(
    result2.summaries[0].content === "主角与艾莉丝在王都旅馆相识，交谈甚欢。",
    "Summary content should match LLM response"
  );
  assert(result2.summaries[0].timeTag === "第1幕", "timeTag should use template");
  assert(
    result2.summaries[0].location === "王都旅馆的深夜",
    "location should fallback to activeCharacter.scenario (first 8 chars)"
  );
  // 砍掉 5 条正则状态抽离：condition/inventory/bonding 应为 undefined
  assert(result2.summaries[0].condition === undefined, "condition should be undefined (deprecated)");
  assert(result2.summaries[0].inventory === undefined, "inventory should be undefined (deprecated)");
  assert(result2.summaries[0].bonding === undefined, "bonding should be undefined (deprecated)");
  assert(
    result2.lastSummarizedMessageId === "msg_9",
    "lastSummarizedMessageId should be last compressed message"
  );

  console.log("  ✔ reach threshold verified");

  // === 8.3 免 Key 模式静默跳过 ===
  console.log("  [8.3] no-key mode - silent skip...");

  const storage3 = {} as unknown as MemoryStorage;
  const summary3 = new MemorySummary(storage3);
  summary3.init(mockKernel);

  const session3 = buildSession(12);
  llmCallCount = 0;
  const result3 = await summary3.checkAndSummarize(
    session3,
    buildSettings({ apiKey: "" }),
    testCharacter,
    false
  );
  assert(result3 === session3, "No-key mode should return original session");
  assert(llmCallCount === 0, "LLM should NOT be called in no-key mode");

  console.log("  ✔ no-key mode verified");

  // === 8.4 force=true + 免 Key 模式抛错 ===
  console.log("  [8.4] force=true + no-key mode - throw error...");

  const storage4 = {} as unknown as MemoryStorage;
  const summary4 = new MemorySummary(storage4);
  summary4.init(mockKernel);

  const session4 = buildSession(5);
  let errorThrown: Error | null = null;
  try {
    await summary4.checkAndSummarize(
      session4,
      buildSettings({ apiKey: "" }),
      testCharacter,
      true
    );
  } catch (e) {
    errorThrown = e as Error;
  }
  assert(errorThrown !== null, "force=true + no-key should throw");
  assert(
    errorThrown!.message.includes("免 Key 体验模式"),
    "Error message should mention no-key mode"
  );

  console.log("  ✔ force=true + no-key mode verified");

  // === 8.5 force=true + 无未总结消息抛错 ===
  console.log("  [8.5] force=true + no unsummarized - throw error...");

  const storage5 = {} as unknown as MemoryStorage;
  const summary5 = new MemorySummary(storage5);
  summary5.init(mockKernel);

  // 所有消息都已总结（lastSummarizedMessageId 指向最后一条）
  const session5 = buildSession(5, { lastSummarizedId: "msg_4" });
  errorThrown = null;
  try {
    await summary5.checkAndSummarize(
      session5,
      buildSettings(),
      testCharacter,
      true
    );
  } catch (e) {
    errorThrown = e as Error;
  }
  assert(errorThrown !== null, "force=true + no unsummarized should throw");
  assert(
    errorThrown!.message.includes("没有未被总结的有效对话"),
    "Error message should mention no unsummarized messages"
  );

  console.log("  ✔ force=true + no unsummarized verified");

  // === 8.6 AbortSignal 触发返回原 session ===
  console.log("  [8.6] abort signal - return original session...");

  const storage6 = {} as unknown as MemoryStorage;
  const summary6 = new MemorySummary(storage6);
  summary6.init(mockKernel);

  const session6 = buildSession(12);
  const ac = new AbortController();
  ac.abort(); // 立即 abort

  llmCallCount = 0;
  const result6 = await summary6.checkAndSummarize(
    session6,
    buildSettings(),
    testCharacter,
    false,
    ac.signal
  );
  assert(result6 === session6, "Aborted should return original session");
  assert(llmCallCount === 0, "LLM should NOT be called when aborted");

  console.log("  ✔ abort signal verified");

  // === 8.7 LLM 调用失败抛错 ===
  console.log("  [8.7] LLM failure - throw error...");

  const storage7 = {} as unknown as MemoryStorage;
  const summary7 = new MemorySummary(storage7);
  summary7.init(mockKernel);

  const session7 = buildSession(12);
  mockDb.sessions.set("sess_test", { ...session7 });
  mockLlmStatus = 500;
  llmCallCount = 0;

  errorThrown = null;
  try {
    await summary7.checkAndSummarize(
      session7,
      buildSettings(),
      testCharacter,
      false
    );
  } catch (e) {
    errorThrown = e as Error;
  }
  assert(errorThrown !== null, "LLM failure should throw");
  assert(
    errorThrown!.message.includes("API 返回错误状态码 500"),
    "Error message should mention status code"
  );

  // 恢复 mock 状态
  mockLlmStatus = 200;

  console.log("  ✔ LLM failure verified");

  // === 8.8 timeTag 模板渲染（多幕场景）===
  console.log("  [8.8] timeTag template with multiple summaries...");

  const storage8 = {} as unknown as MemoryStorage;
  const summary8 = new MemorySummary(storage8);
  summary8.init(mockKernel);

  // 已有 2 条摘要，新摘要应为"第3幕"
  const session8 = buildSession(15, { summaryCount: 2, lastSummarizedId: "msg_4" });
  mockDb.sessions.set("sess_test", { ...session8 });
  mockLlmResponse = "第三幕的剧情摘要";
  llmCallCount = 0;

  const result8 = await summary8.checkAndSummarize(
    session8,
    buildSettings(),
    testCharacter,
    false
  );
  assert(llmCallCount === 1, "LLM should be called");
  assert(result8.summaries.length === 3, "Should have 3 summaries");
  assert(result8.summaries[2].timeTag === "第3幕", "New summary timeTag should be '第3幕'");

  console.log("  ✔ timeTag template verified");

  // === 8.9 自定义 timeTag 模板 ===
  console.log("  [8.9] custom timeTag template...");

  const storage9 = {} as unknown as MemoryStorage;
  const summary9 = new MemorySummary(storage9);
  summary9.init(mockKernel);

  const session9 = buildSession(12);
  mockDb.sessions.set("sess_test", { ...session9 });
  mockLlmResponse = "摘要内容";
  llmCallCount = 0;

  const customSettings = buildSettings();
  customSettings.memory.timeTagTemplate = "Chapter {{index}}";

  const result9 = await summary9.checkAndSummarize(
    session9,
    customSettings,
    testCharacter,
    false
  );
  assert(result9.summaries[0].timeTag === "Chapter 1", "Custom timeTag template should render");

  console.log("  ✔ custom timeTag template verified");

  // === 8.10 destroy 生命周期 ===
  console.log("  [8.10] destroy lifecycle...");

  const storage10 = {} as unknown as MemoryStorage;
  const summary10 = new MemorySummary(storage10);
  summary10.init(mockKernel);
  summary10.destroy();

  // destroy 后调用 checkAndSummarize 应被 abortSignal 拦截
  const session10 = buildSession(12);
  llmCallCount = 0;
  const result10 = await summary10.checkAndSummarize(
    session10,
    buildSettings(),
    testCharacter,
    false
  );
  assert(result10 === session10, "After destroy should return original session");
  assert(llmCallCount === 0, "LLM should NOT be called after destroy");

  console.log("  ✔ destroy lifecycle verified");

  console.log("✔ MemorySummary verified successfully!");
}
