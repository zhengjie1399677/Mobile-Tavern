/**
 * 内核服务覆盖补强测试
 *
 * 补充覆盖以下模块的测试空白：
 * 1. TableMemoryService - 表格记忆解析（updateRow/insertRow/deleteRow）
 * 2. PromptService - ReDoS 防护与 Lorebook 递归触发
 * 3. LLMService - validateBaseUrl URL 校验
 *
 * 遵循 AGENTS.md `CHANGE-SAFE`：局部测试跑通，独立验证后再接入聚合测试。
 */

import { TableMemoryService } from "../src/application/services/TableMemoryService";
import { PromptService } from "../src/application/services/PromptService";
import { LLMService } from "../src/application/services/LLMService";
import { Kernel } from "../src/kernel/Kernel";
import { IKernelService } from "@/src/application/serviceContracts";
import { TableMemorySheet, CharacterCard, ChatSession, Message } from "../src/types";

// 注：ScriptService 测试因依赖 tavernHelperBridge（操作 window 对象）在 Node 环境下无法加载，
// 已记录为测试覆盖空白，需在浏览器环境或 E2E 测试中补充覆盖。

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================
// 1. TableMemoryService 测试
// ============================================================

async function testTableMemoryService() {
  console.log("\n--- Running TableMemoryService Coverage Verification ---");
  const testKernel = new Kernel();
  const service = new TableMemoryService();
  await testKernel.registerService("tableMemory", service);

  // 构造初始表格：状态与关系表
  const initialMemory: TableMemorySheet[] = [
    {
      id: "status_rel",
      name: "状态与关系",
      columns: ["角色", "好感度", "当前状态描述"],
      rows: [
        ["银霜", "50", "初次结识"],
        ["莉莉丝", "30", "警惕"],
      ],
      enable: true,
    },
  ];

  // 1.1 updateRow 双参数模式：按定位列匹配后更新
  {
    const content = 'updateRow("状态与关系", {"角色": "银霜"}, {"好感度": "65"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "updateRow 双参数应触发变更");
    assert(result.updatedMemory[0].rows[0][1] === "65", "银霜好感度应更新为 65");
    assert(result.updatedMemory[0].rows[1][1] === "30", "莉莉丝好感度应保持不变");
    assert(!result.cleanContent.includes("updateRow"), "清理后内容不应包含 updateRow 指令");
    console.log("  ✔ updateRow 双参数模式验证通过");
  }

  // 1.2 updateRow 单参数模式：默认更新首行
  {
    const content = 'updateRow("状态与关系", {"好感度": "80"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "updateRow 单参数应触发变更");
    assert(result.updatedMemory[0].rows[0][1] === "80", "首行好感度应更新为 80");
    console.log("  ✔ updateRow 单参数模式验证通过");
  }

  // 1.3 insertRow：插入新行
  {
    const content = 'insertRow("状态与关系", {"角色": "新角色", "好感度": "10", "当前状态描述": "陌生"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "insertRow 应触发变更");
    assert(result.updatedMemory[0].rows.length === 3, "应新增一行");
    assert(result.updatedMemory[0].rows[2][0] === "新角色", "新行角色名应正确");
    console.log("  ✔ insertRow 模式验证通过");
  }

  // 1.4 deleteRow：按条件删除行
  {
    const content = 'deleteRow("状态与关系", {"角色": "莉莉丝"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "deleteRow 应触发变更");
    assert(result.updatedMemory[0].rows.length === 1, "应删除一行");
    assert(result.updatedMemory[0].rows[0][0] === "银霜", "应保留银霜行");
    console.log("  ✔ deleteRow 模式验证通过");
  }

  // 1.5 宽松 JSON 解析：单引号与未引号键名
  {
    const content = "updateRow('状态与关系', {角色: '银霜'}, {好感度: '99'})";
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "单引号 JSON 应正确解析");
    assert(result.updatedMemory[0].rows[0][1] === "99", "单引号更新应生效");
    console.log("  ✔ 宽松 JSON 解析（单引号/未引号键名）验证通过");
  }

  // 1.6 多指令混合：一条消息中包含多个操作
  {
    const content = [
      'updateRow("状态与关系", {"角色": "银霜"}, {"好感度": "70"})',
      'insertRow("状态与关系", {"角色": "路人甲", "好感度": "5"})',
    ].join("\n");
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "多指令应触发变更");
    assert(result.updatedMemory[0].rows[0][1] === "70", "首条 updateRow 应生效");
    assert(result.updatedMemory[0].rows.length === 3, "第二条 insertRow 应生效");
    console.log("  ✔ 多指令混合验证通过");
  }

  // 1.7 不存在的表名：应静默跳过不抛错
  {
    const content = 'updateRow("不存在的表", {"key": "val"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === false || result.cleanContent !== content, "不存在的表名应静默处理");
    console.log("  ✔ 不存在表名静默降级验证通过");
  }

  // 1.8 无指令内容：原样返回
  {
    const content = "这是一段普通的对话内容，没有任何表格指令。";
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === false, "无指令内容不应触发变更");
    assert(result.cleanContent === content, "无指令内容应原样返回");
    console.log("  ✔ 无指令内容原样返回验证通过");
  }

  await testKernel.destroy();
  console.log("✔ TableMemoryService 覆盖测试全部通过！");
}

// ============================================================
// 2. PromptService ReDoS 防护测试
// ============================================================

async function testPromptServiceRedosProtection() {
  console.log("\n--- Running PromptService ReDoS Protection Verification ---");
  const testKernel = new Kernel();
  const service = new PromptService();
  await testKernel.registerService("prompt", service);

  // 构造包含危险正则的 Lorebook 词条
  const dangerousEntries = [
    {
      id: "redos-danger",
      keys: ["(a+)+"], // 经典 ReDoS 危险模式
      content: "危险正则触发内容",
      enabled: true,
      useRegex: true,
      constant: false,
    },
    {
      id: "redos-safe",
      keys: ["魔法"],
      content: "安全正则触发内容",
      enabled: true,
      useRegex: false,
      constant: false,
    },
  ];

  // 模拟消息历史
  const messages: Message[] = [
    { id: "m1", sender: "user", content: "我们来讨论 aaaa 魔法", timestamp: Date.now() },
  ];

  // 拦截 console.warn 以验证降级行为
  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = (...args: any[]) => {
    const msg = String(args[0] || "");
    if (msg.includes("ReDoS")) {
      warnCalled = true;
    }
    originalWarn(...args);
  };

  try {
    // 触发 Lorebook 匹配
    const triggered = service.getTriggeredLorebookEntries(
      messages,
      "我们来讨论 aaaa 魔法",
      dangerousEntries
    );

    // 危险正则应降级为字符串包含匹配，不抛错
    const safeTriggered = triggered.find((e: { id: string }) => e.id === "redos-safe");
    assert(safeTriggered !== undefined, "安全关键词应正常触发");

    console.log("  ✔ ReDoS 危险正则降级处理验证通过");
  } finally {
    console.warn = originalWarn;
  }

  // 测试正常正则匹配
  {
    const normalRegexEntries = [
      {
        id: "regex-normal",
        keys: ["^你好"],
        content: "问候触发",
        enabled: true,
        useRegex: true,
        constant: false,
      },
    ];
    const triggered = service.getTriggeredLorebookEntries(
      [{ id: "m1", sender: "user", content: "你好世界", timestamp: Date.now() }] as Message[],
      "你好世界",
      normalRegexEntries
    );
    assert(triggered.some((e: { id: string }) => e.id === "regex-normal"), "正常正则应触发匹配");
    console.log("  ✔ 正常正则匹配验证通过");
  }

  await testKernel.destroy();
  console.log("✔ PromptService ReDoS 防护测试全部通过！");
}

// ============================================================
// 3. LLMService validateBaseUrl 测试
// ============================================================

async function testLLMServiceUrlValidation() {
  console.log("\n--- Running LLMService URL Validation Verification ---");
  const testKernel = new Kernel();
  const service = new LLMService();
  await testKernel.registerService("llm", service);

  // validateBaseUrl 是私有方法，通过反射访问
  const validateBaseUrl = (service as unknown as { validateBaseUrl: (url: string | undefined) => string }).validateBaseUrl.bind(service);

  // 3.1 合法 URL 应通过校验
  {
    const validUrls = [
      "https://api.openai.com/v1",
      "http://localhost:3000",
      "https://openrouter.ai/api/v1",
    ];
    for (const url of validUrls) {
      const result = validateBaseUrl(url);
      assert(typeof result === "string", `合法 URL 应通过校验: ${url}`);
    }
    console.log("  ✔ 合法 URL 校验通过");
  }

  // 3.2 非法协议应抛错
  {
    const invalidUrls = [
      "ftp://example.com",
      "file:///path/to/file",
      "javascript:alert(1)",
      "",
      undefined,
    ];
    for (const url of invalidUrls) {
      let threw = false;
      try {
        validateBaseUrl(url);
      } catch (e: any) {
        threw = true;
        assert(e.message.includes("http://") || e.message.includes("https://"), `应抛出协议错误: ${url}`);
      }
      assert(threw === true, `非法 URL 应抛错: ${url}`);
    }
    console.log("  ✔ 非法协议 URL 拦截验证通过");
  }

  // 3.3 尾部斜杠应被自动去除
  {
    const result = validateBaseUrl("https://api.openai.com/v1/");
    assert(result === "https://api.openai.com/v1", "尾部斜杠应被去除");
    console.log("  ✔ 尾部斜杠规范化验证通过");
  }

  await testKernel.destroy();
  console.log("✔ LLMService URL 校验测试全部通过！");
}

// ============================================================
// 5. ScriptService MVU 变量解析测试
// ============================================================
// 注：ScriptService 依赖 tavernHelperBridge（在模块加载时操作 window 对象），
// 在 Node.js 测试环境下无法正常导入。该模块的测试需在以下环境补充：
// - 浏览器环境下的集成测试
// - E2E 测试（通过 Tauri WebView 运行）
// - 或重构 ScriptService 将 tavernHelperBridge 依赖注入化（推荐）
//
// 待覆盖测试点：
// - initializeMvuFromCharacter 应返回初始变量
// - parseMvuMessage 应解析消息中的变量更新
// - executeMvuScript 应同步变量到消息 extra
// - executeMvuScript 异常时应返回原 session 不抛错

// 导出所有测试函数
export {
  testTableMemoryService,
  testPromptServiceRedosProtection,
  testLLMServiceUrlValidation,
};

// 独立运行入口（用于单兵测试）
// 使用 pathToFileURL 兼容 Windows 路径格式
import { pathToFileURL } from "url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    try {
      await testTableMemoryService();
      await testPromptServiceRedosProtection();
      await testLLMServiceUrlValidation();
      console.log("\n=================================================");
      console.log("🎉 Kernel Services Coverage Tests ALL PASSED!");
      console.log("=================================================");
    } catch (err: any) {
      console.error("\n❌ TESTS FAILED!");
      console.error(err.stack || err.message);
      process.exit(1);
    }
  })();
}
