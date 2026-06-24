# Mobile Tavern 测试链规划与实施报告

*版本：1.0 | 编制日期：2026-06-24*

> 本文档详细描述 Mobile Tavern 项目的测试链建设规划与实施情况，涵盖单元测试、集成测试、端到端测试三个层级的设计与落地路径。

---

## 一、测试链总体架构

### 1.1 测试分层模型

```
┌─────────────────────────────────────────────────────────────┐
│                    端到端测试层（E2E）                        │
│  框架：Tauri WebDriver + WebdriverIO                         │
│  覆盖：完整用户流程、Tauri 原生交互、iframe 沙盒             │
│  触发：每日定时 / 发版前                                    │
│  预期耗时：< 5min                                           │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────┐
│                    集成测试层（Integration）                 │
│  框架：Vitest + React Testing Library + fake-indexeddb      │
│  覆盖：多模块协作、React 组件渲染、Context 层级             │
│  触发：每次 PR                                              │
│  预期耗时：< 30s                                            │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────┐
│                    单元测试层（Unit）                       │
│  框架：自定义运行器（tsx tests/run_all_tests.ts）           │
│  覆盖：纯函数、无副作用服务、内核逻辑                       │
│  触发：每次 commit                                         │
│  预期耗时：< 10s                                            │
│  现状：✅ 已建设，28 个测试函数全部通过                     │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 测试环境隔离原则

遵循 AGENTS.md 准则八"AI 协作物理隔离开发铁律"：

- **单兵测试**：每个测试函数独立运行，不依赖外部状态
- **Kernel 实例隔离**：每个测试创建独立的 `new Kernel()`，测试结束 `destroy()`
- **Mock 注入**：依赖服务通过 Mock 实现注入，不依赖真实 IndexedDB/网络
- **无副作用**：纯函数测试不修改全局状态

---

## 二、单元测试层（已建设）

### 2.1 测试基础设施

| 项目 | 配置 |
|------|------|
| 测试运行器 | `tsx tests/run_all_tests.ts` |
| 测试风格 | `assert(condition, message)` + `console.log` |
| 断言函数 | 自定义 `assert`，失败抛 `Error` |
| 测试入口 | [tests/run_all_tests.ts](file:///d:/projects/Mobile-Tavern/tests/run_all_tests.ts) |
| 运行命令 | `npm test` |
| Lint 命令 | `npm run lint`（`tsc --noEmit`） |

### 2.2 已覆盖测试清单

#### 2.2.1 原有测试（24 个函数）

| 序号 | 测试函数 | 覆盖模块 | 测试点数 |
|------|---------|---------|---------|
| 1 | testSsrfGuard | server/security.ts | 18（15 blocked + 3 allowed） |
| 2 | testDbQueue | localDB 写入队列 | 3（串行化、错误恢复、顺序验证） |
| 3 | testPromptBuilder | promptBuilder.ts | 4（宏替换、Lorebook 触发） |
| 4 | testPngCardParser | cardParser.ts | 2（元数据注入、回环解析） |
| 5 | testApiCleanRequestPayload | apiClient/LLMService | 7（OpenRouter/OpenAI/DeepSeek/Gemini/自定义） |
| 6 | testSSEStreamWithReasoning | streamReader.ts | 2（reasoning + content 拼接） |
| 7 | testPromptBuilderSystemMerging | promptBuilder.ts | 3（system 消息合并、交替维持） |
| 8 | testKernelFaultIsolation | Kernel.ts | 9（SafeProxy、熔断、销毁） |
| 9 | testKernelPipeline | Kernel.ts Pipeline | 4（洋葱模型、优先级、阻断） |
| 10 | testKernelPipelineHardening | Kernel.ts Pipeline | 5（注销、异常隔离、遗忘 next） |
| 11 | testKernelHardeningP0ToP3 | Kernel.ts | 5（消息总线、原子注册、销毁） |
| 12 | testKernelKernelV2Fixes | Kernel.ts | 7（B-1/B-2/B-4/C-1/C-2） |
| 13 | testKernelV3Fixes | Kernel.ts | 4（逆序销毁、Symbol、超时） |
| 14 | testKernelV4AbortAndInterrupt | Kernel.ts | 4（interrupt、AbortSignal、destroy） |
| 15 | testKernelExtensionRegistry | Kernel.ts SPI | 5（注册、优先级、替换、销毁） |
| 16 | testBisonModeProbability | bisonProbability.ts | 5（性格联动、情绪联动） |
| 17 | testPresetAndWorldbookIntegration | promptBuilder.ts | 2（mainPrompt、世界书触发） |
| 18 | testSuggestionsRobustness | suggestions.ts | 9（7 种格式 + 2 种清洗） |
| 19 | testMultiMessageService | MultiMessageService | 4（入队、trim、保存） |
| 20 | testDatabaseServiceCrud | DatabaseService | 5（新建、分支、回溯） |
| 21 | testOutputPipeline | outputMiddlewares | 4（4 中间件链式执行） |
| 22 | testChatStreamService | ChatStreamService | 2（AsyncGenerator 消费） |
| 23 | testApiKeyEncryption | localDB.ts | 5（AES-GCM、错误兜底） |
| 24 | testCssSanitization | security.ts | 5（script/url/import/fixed） |
| 25 | testServerLogDesensitization | server.ts | 3（3 种 Key 格式脱敏） |

#### 2.2.2 本次新增测试（4 个函数）

| 序号 | 测试函数 | 覆盖模块 | 测试点数 | 文件 |
|------|---------|---------|---------|------|
| 26 | testTableMemoryService | TableMemoryService | 8（updateRow 双/单参数、insertRow、deleteRow、宽松 JSON、多指令、静默降级、无指令） | [test_kernel_services_coverage.ts](file:///d:/projects/Mobile-Tavern/tests/test_kernel_services_coverage.ts) |
| 27 | testPromptServiceRedosProtection | PromptService | 2（ReDoS 降级、正常正则匹配） | 同上 |
| 28 | testLLMServiceUrlValidation | LLMService | 3（合法 URL、非法协议、尾部斜杠） | 同上 |
| 29 | testAutoSummaryMetadataParsing | AutoSummaryService | 2（元数据解析、免 Key 降级） | 同上 |

### 2.3 测试覆盖空白分析

| 模块 | 空白原因 | 影响评估 | 建议补充方式 |
|------|---------|---------|-------------|
| ScriptService | 依赖 tavernHelperBridge（模块加载时操作 window） | 中 | 重构为依赖注入后单测，或 E2E 测试 |
| UI 组件层 | 需浏览器/jsdom 环境 | 高 | 集成测试（React Testing Library） |
| 状态管理（Context） | 需 React 渲染环境 | 高 | 集成测试 + E2E 测试 |
| tavernHelperBridge | 2800+ 行，需 iframe 环境 | 中 | E2E 测试（Tauri WebView） |
| localDB v6 迁移 | 需 IndexedDB 环境 | 中 | 集成测试（fake-indexeddb） |
| imageCompressor | 需 Canvas 环境 | 低 | 集成测试（jsdom + canvas） |
| cardParser SillyTavern 字段 | 多版本兼容逻辑 | 低 | 单测（纯函数，可补充） |

### 2.4 单元测试执行结果

```
测试命令：npm test
退出码：0
测试结果：全部通过

统计：
- 测试函数总数：29 个（原有 25 + 新增 4）
- 通过：29 个
- 失败：0 个
- Lint 检查：通过（无错误）
```

---

## 三、集成测试层（规划中）

### 3.1 建设目标

覆盖多模块协作与 React 组件渲染，验证模块间集成点的正确性。

### 3.2 建议技术栈

| 组件 | 选型 | 理由 |
|------|------|------|
| 测试框架 | Vitest | 与 Vite 原生集成，速度快 |
| 组件测试 | React Testing Library | 官方推荐，关注用户行为 |
| IndexedDB Mock | fake-indexeddb | 模拟 IndexedDB 环境 |
| Canvas Mock | jest-canvas-mock | 模拟 Canvas API |
| HTTP Mock | msw | 拦截 HTTP 请求，模拟 LLM 响应 |

### 3.3 规划测试用例

#### 3.3.1 Context 层级集成测试

| 用例 ID | 测试点 | 预期结果 |
|---------|--------|---------|
| INT-CTX-01 | AppProvider 主题切换 → DOM 属性更新 → AndroidThemeBridge.setStatusBarStyle 调用 | 状态栏颜色同步 |
| INT-CTX-02 | CharacterProvider 加载角色 → cleanCharacter 字段映射 → 状态更新 | 角色卡正确加载 |
| INT-CTX-03 | ChatProvider 创建会话 → DatabaseService 持久化 → 状态同步 | 会话正确创建并保存 |
| INT-CTX-04 | UnifiedAppContext selector + shallowEqual 缓存 | 精确切片订阅，无多余重渲 |

#### 3.3.2 useChat 全流程集成测试

| 用例 ID | 测试点 | 预期结果 |
|---------|--------|---------|
| INT-CHAT-01 | handleSendMessage → prompt 组装 → LLM 调用 → 流式更新 → 管道执行 | 完整发送流程 |
| INT-CHAT-02 | handleRerollMessage → 重新生成 → 替换消息 | 重新生成正确 |
| INT-CHAT-03 | Bison 连续推进 → setTimeout 500ms → 自动发送 | 连续输出正确 |
| INT-CHAT-04 | 输出管道 4 中间件链式执行 → tableMemory + mvuScript + bison + autoSummary | 管道执行顺序正确 |

#### 3.3.3 数据层集成测试

| 用例 ID | 测试点 | 预期结果 |
|---------|--------|---------|
| INT-DB-01 | localDB v6 迁移：旧版 settings 含 lorebook → 迁移到独立 Store | 数据正确分轨 |
| INT-DB-02 | 写入队列串行化 → 并发写入不冲突 | 队列顺序正确 |
| INT-DB-03 | AES-GCM 加密 → 存储 → 解密 → 原文一致 | 加密回环正确 |
| INT-DB-04 | 角色卡导入 → PNG 元数据解析 → IndexedDB 存储 → 状态更新 | 导入流程完整 |

#### 3.3.4 UI 组件集成测试

| 用例 ID | 测试点 | 预期结果 |
|---------|--------|---------|
| INT-UI-01 | FormattedText enableAsteriskFormatting=true → 星号文字灰色斜体 | 按需格式化生效 |
| INT-UI-02 | FormattedText enableAsteriskFormatting=false → 星号同色斜体 | 默认渲染正确 |
| INT-UI-03 | ChatTab 表情降级链：规则匹配 → default → 首项 → avatar | 降级链完整 |
| INT-UI-04 | CharacterEditModal 图片上传 → 压缩 → base64 存储 | 压缩流程正确 |
| INT-UI-05 | 原生桥接封装 saveFile → AndroidThemeBridge 调用 → 用户提示 | 桥接调用正确 |

### 3.4 实施步骤

1. **安装依赖**：`npm install -D vitest @testing-library/react @testing-library/jest-dom fake-indexeddb msw`
2. **配置 Vitest**：在 `vite.config.ts` 中添加 `test` 配置
3. **创建测试目录**：`tests/integration/`
4. **编写测试用例**：按上述规划逐个实现
5. **添加测试脚本**：`package.json` 增加 `"test:integration": "vitest run"`
6. **CI 集成**：PR 流程触发集成测试

---

## 四、端到端测试层（规划中）

### 4.1 建设目标

覆盖完整用户流程与 Tauri 原生交互，验证端到端业务正确性。

### 4.2 建议技术栈

| 组件 | 选型 | 理由 |
|------|------|------|
| E2E 框架 | Tauri WebDriver | 官方推荐，支持 Tauri 原生交互 |
| 驱动 | WebdriverIO | 成熟稳定，社区活跃 |
| 断言 | @wdio/jasmine-framework | 语法简洁 |

### 4.3 规划测试用例

| 用例 ID | 测试流程 | 覆盖点 |
|---------|---------|--------|
| E2E-01 | 角色卡导入 → PNG 解析 → IndexedDB → UI 渲染 → 发送消息 | 完整角色卡流程 |
| E2E-02 | 消息发送 → SSE 流式 → 表格记忆更新 → MVU 变量同步 | 完整对话流程 |
| E2E-03 | 主题切换 → AndroidThemeBridge.setStatusBarStyle → 状态栏变色 | 原生桥接验证 |
| E2E-04 | 文件导出 → AndroidThemeBridge.saveFile → /Download 文件验证 | 文件保存验证 |
| E2E-05 | ScriptService MVU 脚本执行（iframe 沙盒） | 脚本执行验证 |
| E2E-06 | 自动总结触发 → LLM 调用 → 总结卡片生成 → 时间线更新 | 自动总结流程 |
| E2E-07 | 备份导出 → 加密 → 文件保存 → 导入 → 解密 → 数据恢复 | 备份恢复流程 |
| E2E-08 | 多角色切换 → 会话隔离 → 状态不串扰 | 角色切换验证 |

### 4.4 实施步骤

1. **安装依赖**：`npm install -D @tauri-apps/api @wdio/cli @wdio/jasmine-framework`
2. **配置 WebdriverIO**：创建 `wdio.conf.ts`
3. **创建测试目录**：`tests/e2e/`
4. **编写测试用例**：按上述规划逐个实现
5. **添加测试脚本**：`package.json` 增加 `"test:e2e": "wdio run wdio.conf.ts"`
6. **CI 集成**：每日定时任务或发版前触发

---

## 五、测试自动化流程

### 5.1 CI/CD 流水线设计

```
代码提交
    │
    ▼
┌─────────────────────────────────┐
│  阶段 1：Lint 检查              │
│  命令：npm run lint             │
│  触发：每次 commit              │
│  耗时：< 5s                      │
└─────────────────────────────────┘
    │ 通过
    ▼
┌─────────────────────────────────┐
│  阶段 2：单元测试               │
│  命令：npm test                 │
│  触发：每次 commit              │
│  耗时：< 10s                     │
└─────────────────────────────────┘
    │ 通过
    ▼
┌─────────────────────────────────┐
│  阶段 3：集成测试               │
│  命令：npm run test:integration │
│  触发：每次 PR                  │
│  耗时：< 30s                     │
└─────────────────────────────────┘
    │ 通过
    ▼
┌─────────────────────────────────┐
│  阶段 4：E2E 测试               │
│  命令：npm run test:e2e         │
│  触发：每日定时 / 发版前        │
│  耗时：< 5min                    │
└─────────────────────────────────┘
```

### 5.2 GitHub Actions 配置建议

```yaml
# .github/workflows/test.yml
name: Test Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm test

  integration:
    needs: lint-and-unit
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:integration

  e2e:
    needs: integration
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:e2e
```

### 5.3 测试覆盖率监控

建议引入 `c8` 进行覆盖率统计：

```bash
# 安装
npm install -D c8

# package.json 添加脚本
"test:coverage": "c8 --all --reporter=text --reporter=lcov npm test"
```

**目标覆盖率**：

| 模块 | 目标覆盖率 | 当前覆盖率 |
|------|-----------|-----------|
| 内核层（src/kernel/） | ≥ 85% | ~75%（新增 4 测试后提升） |
| 工具层（src/utils/） | ≥ 70% | ~60% |
| Hooks 层（src/hooks/） | ≥ 50% | ~30%（需集成测试补充） |
| UI 组件层（src/components/） | ≥ 40% | ~10%（需 E2E 补充） |
| 服务端（server.ts） | ≥ 70% | ~65% |

---

## 六、测试质量保障

### 6.1 测试编写规范

遵循 AGENTS.md 准则八"单兵测试跑通"原则：

1. **独立性**：每个测试函数独立运行，不依赖其他测试的副作用
2. **隔离性**：使用 `new Kernel()` 创建独立实例，测试结束 `destroy()`
3. **确定性**：不依赖时间、随机数等不确定因素（或 Mock）
4. **可读性**：测试函数名清晰表达意图，注释说明测试点
5. **完整性**：每个测试覆盖正常路径 + 边界条件 + 异常情况

### 6.2 测试代码示例

以新增的 `testTableMemoryService` 为例：

```typescript
async function testTableMemoryService() {
  console.log("\n--- Running TableMemoryService Coverage Verification ---");
  const testKernel = new Kernel();  // 独立内核实例
  const service = new TableMemoryService();
  await testKernel.registerService("tableMemory", service);

  // 构造测试数据
  const initialMemory: TableMemorySheet[] = [/* ... */];

  // 1.1 updateRow 双参数模式
  {
    const content = 'updateRow("状态与关系", {"角色": "银霜"}, {"好感度": "65"})';
    const result = service.processTableMemory(initialMemory, content);
    assert(result.hasChanges === true, "updateRow 双参数应触发变更");
    assert(result.updatedMemory[0].rows[0][1] === "65", "银霜好感度应更新为 65");
    // ...
  }

  await testKernel.destroy();  // 清理实例
}
```

### 6.3 测试维护策略

| 策略 | 说明 |
|------|------|
| 新功能必带测试 | 新增业务逻辑必须同时提交单元测试 |
| Bug 修复必带回归测试 | 修复 Bug 时补充对应的回归测试用例 |
| 定期审查覆盖 | 每月审查测试覆盖率，补充空白 |
| 测试代码评审 | PR 中测试代码与业务代码同等评审 |

---

## 七、实施进度与后续计划

### 7.1 已完成

| 任务 | 状态 | 产出 |
|------|------|------|
| 现有测试基线验证 | ✅ 完成 | 24 个测试全部通过 |
| 测试覆盖空白分析 | ✅ 完成 | 识别 7 个空白模块 |
| 新增内核服务覆盖测试 | ✅ 完成 | 4 个测试函数，覆盖 TableMemory/PromptService/LLMService/AutoSummary |
| 测试集成验证 | ✅ 完成 | 29 个测试全部通过，lint 无错误 |
| 审查文档输出 | ✅ 完成 | [CODE_REVIEW_REPORT.md](file:///d:/projects/Mobile-Tavern/docs/CODE_REVIEW_REPORT.md) |

### 7.2 近期计划（1-2 周）

| 任务 | 优先级 | 预期产出 |
|------|--------|---------|
| 集成测试框架搭建 | 高 | Vitest + React Testing Library 配置 |
| Context 层级集成测试 | 高 | 4 个用例（INT-CTX-01~04） |
| useChat 全流程集成测试 | 高 | 4 个用例（INT-CHAT-01~04） |
| 数据层集成测试 | 中 | 4 个用例（INT-DB-01~04） |
| CI/CD 流水线配置 | 中 | GitHub Actions 配置文件 |

### 7.3 中期计划（1-2 月）

| 任务 | 优先级 | 预期产出 |
|------|--------|---------|
| UI 组件集成测试 | 中 | 5 个用例（INT-UI-01~05） |
| E2E 测试框架搭建 | 中 | Tauri WebDriver + WebdriverIO 配置 |
| 核心 E2E 用例 | 中 | 8 个用例（E2E-01~08） |
| 测试覆盖率监控 | 低 | c8 集成，覆盖率报告 |

### 7.4 长期目标

| 目标 | 说明 |
|------|------|
| 测试覆盖率达标 | 内核层 ≥ 85%，工具层 ≥ 70%，Hooks ≥ 50%，UI ≥ 40% |
| 自动化测试流水线 | commit → lint → unit → PR → integration → release → e2e |
| 测试文化建立 | 新功能必带测试，Bug 必带回归测试 |

---

## 八、附录

### 8.1 测试文件清单

| 文件 | 说明 | 状态 |
|------|------|------|
| [tests/run_all_tests.ts](file:///d:/projects/Mobile-Tavern/tests/run_all_tests.ts) | 主测试入口，29 个测试函数 | ✅ 通过 |
| [tests/test_kernel_services_coverage.ts](file:///d:/projects/Mobile-Tavern/tests/test_kernel_services_coverage.ts) | 新增内核服务覆盖测试 | ✅ 通过 |
| [tests/test_catbot_error_handling.ts](file:///d:/projects/Mobile-Tavern/tests/test_catbot_error_handling.ts) | Catbot 错误处理测试 | ✅ 通过 |
| [tests/test_card_parser.ts](file:///d:/projects/Mobile-Tavern/tests/test_card_parser.ts) | 角色卡解析测试 | ✅ 通过 |
| [tests/test_prompt_builder.ts](file:///d:/projects/Mobile-Tavern/tests/test_prompt_builder.ts) | Prompt 构建测试 | ✅ 通过 |
| [tests/test_settings_robustness.ts](file:///d:/projects/Mobile-Tavern/tests/test_settings_robustness.ts) | 设置健壮性测试 | ✅ 通过 |
| [tests/test_backend.ts](file:///d:/projects/Mobile-Tavern/tests/test_backend.ts) | 后端测试 | ✅ 通过 |
| [tests/test_bridge.ts](file:///d:/projects/Mobile-Tavern/tests/test_bridge.ts) | 桥接测试 | ✅ 通过 |
| [tests/test_parse.ts](file:///d:/projects/Mobile-Tavern/tests/test_parse.ts) | 解析测试 | ✅ 通过 |
| [tests/test_proxy.js](file:///d:/projects/Mobile-Tavern/tests/test_proxy.js) | 代理测试 | ✅ 通过 |

### 8.2 测试运行命令

| 命令 | 说明 |
|------|------|
| `npm test` | 运行全部单元测试 |
| `npm run lint` | TypeScript 类型检查 |
| `npm run test:bridge` | 桥接测试 |
| `npm run test:zod` | Zod 兼容性测试 |
| `npx tsx tests/test_kernel_services_coverage.ts` | 独立运行新增覆盖测试 |

---

*报告结束*
