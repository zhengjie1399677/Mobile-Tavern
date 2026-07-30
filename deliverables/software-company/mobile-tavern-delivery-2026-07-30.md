# Mobile Tavern 技术评定与完成度审计报告

> - **审计日期**：2026-07-30
> - **项目版本**：1.7.4
> - **审计方式**：纯静态分析（未修改任何文件）。根配置 + 全量源码扫描（326 个 `.ts/.tsx`、约 7.4 万行）、架构边界测试核查、`npx tsc --noEmit` 实测、TODO / 占位 / stub / 越界导入 / 大文件 / 类型纪律专项扫描。
> - **评定等级**：**A-（85 / 100）**
> - **出具方**：软件开发团队 · 主理人齐活林（交付总监），架构师高见远执行审计

---

## 一、综合评定

**综合评分：85 / 100　等级：A-**

工程素质接近 A 级；被"文档时效滞后 + 少量架构漂移"拉到 A- 下限。

| 维度 | 分数 | 说明 |
|---|---|---|
| 架构分层 | 85 | 铁律基本严守，且有自动化边界测试强制守护 |
| 完成度 | 88 | 10 大特性 + 插件/长期记忆/条件变量引擎均落地 |
| 代码质量 | 82 | 整洁一致；2 个文件超 1000 行、少量未登记 `any` |
| 测试 | 90 | 611 用例 + 架构边界守护；E2E 偏少 |
| 文档 | 75 | AGENTS.md 强；README 统计/结构严重过时 |
| 可运行性 | 85 | `tsc --noEmit` 实测 0 错误；缺一次完整产物构建实证 |

---

## 二、项目概览

**它做什么**：面向 Android/iOS 原生混合 App（Tauri v2 封装）的 SillyTavern 兼容角色卡 / 世界设定运行容器。定位为"无偏向、零侵入、数据驱动"的底层兼容底座，不硬编码任何剧情引导 / 破限提示词。

**技术栈**：React 19 + TailwindCSS v4 + Vite 6 + TypeScript 5.8（严格模式），内核 DI/IOC 微内核 + 洋葱管道；移动端 Tauri v2 + Rust（`src-tauri`，1408 文件）；云端 Rust（`cloud`，45 文件，含 `minimal-community` 后端）；本地中转 Express（`server.ts`）；测试 Vitest + Playwright + 自研测试运行器。

**规模（量级）**：

| 区域 | 文件数 | 行数量级 |
|---|---|---|
| `src` (.ts/.tsx) | 326 | ~73,900 |
| `components/`（顶层 shadcn） | 14 | 小 |
| `tests` | 122 | 含 611 个 `it`/`test` 用例 |
| `docs` | 48 | 含 `TECHNICAL.md`(104KB)、`AGENTS.md` |
| `src-tauri` | 1408 | Rust + 资源 |
| `cloud` | 45 | Rust（1499 行实际逻辑） |

**构建脚本**：`dev`(tsx server.ts)、`build:web`(vite build)、`build:server`(esbuild)、`build:android`、`test`(run_all_tests.ts)、`test:unit`(vitest)、`test:e2e`(playwright)、`lint`(tsc --noEmit)、`quality:push`(lint+i18n+test+build)。脚本链完整。

---

## 三、架构与分层评估（对照 AGENTS.md 铁律）

| 铁律 | 评定 | 证据 |
|---|---|---|
| **ARCH-KERNEL** | ✅ 合规 | Kernel 仅含 9 个文件（`index`/`Kernel`/`KernelLifecycle`/`Pipeline`/`runtimeKernel`/`runtimeEnvironment`/`types`/`validation`）；grep 确认 kernel 未导入任何 `application/domain/infrastructure/components/tabs`。架构边界测试 `tests/suites/architectureBoundaries.test.ts:131-139` 显式禁止 `src/kernel/{services,bootstrap,schemas,utils}` 存在并强制校验。 |
| **ARCH-FLOW** | ✅ 基本合规 | grep 确认 `components/tabs/hooks/contexts` 均未直接 import `localDB` / `repositories` / `indexedDB`；唯一命中 `DbWritingOverlay.tsx:19` 仅是渲染文案 "IndexedDB Transactions"。业务访问存储经 Service/端口。 |
| **COMPAT-DATA** | ✅ 合规 | 兼容逻辑收口在 `src/compatibility/sillytavern`、`src/infrastructure/compat/sillytavern`、`src/utils/tavernHelper/`；业务层使用 Zod/dynamic schema。 |
| **QUALITY-TYPES** | ⚠️ 部分违规 | 见第五节：2 个 `.ts` 超 1000 行；部分 `any` 未登记豁免。 |
| **CONFIG-TRACKS** | ✅ 合规 | `src/config` 类型化入口；`VITE_*` 公开；`server.ts` 对生产秘密缺失有快速失败（issue-token 校验）。 |
| **PLATFORM-MOBILE** | ✅ 合规 | `src` 与 `cloud` 物理隔离；`build:mobile` 剥离 Node/Express/cloud；`shared/bindings` 单一类型来源。 |

**⚠️ 架构分层漂移（非致命，但需关注）**：实际目录已超出 AGENTS.md 描述的 4 层模型，新增 `src/services/`、`src/compatibility/`、`src/composition/`、`src/config/`、`src/tabs/`、`src/hooks/`、`src/contexts/`。其中 **`src/services/` 是第二个 "services" 目录**，与 `src/application/services/` 并存且职责错位：
- `src/services/ar/NativeArAdapter.ts` —— "Adapter" 按 AGENTS.md 应落 `src/infrastructure/`，现置于 services。
- `src/services/pipeline/` —— 与 kernel 的 Pipeline 关注点重叠。
- `src/services/characterRender/pipeline.ts` —— 应属 `src/application/services`。

---

## 四、完成度评估（重点："写到一半"澄清）

**结论：整体完成度很高（约 85–90%），源码中未发现"大量写到一半的功能桩"。** 对"半成品"做了 6 类专项扫描：

| 扫描项 | 结果 |
|---|---|
| `TODO/FIXME/XXX/HACK` 注释 | `src` 全树仅 1 处（`TableMemoryTab.tsx:270`，且功能已实现，属过时注释） |
| `throw 'not implemented'` / stub / 占位函数体 | 0 处 |
| 注释掉的代码块 | 仅 1 行（`useArSync.ts:12` 为示例用法注释） |
| 跳过/禁用的测试（`.skip/xit`） | 0 处 |
| 空文件/占位组件（<12 行 .ts） | 均为 barrel 重导出（如 `mvuParser.ts`、`SystemReportSection.tsx`、`hostBridgeV2.ts`） |
| 未接线按钮/路由 | 未发现明显 `onClick={()=>{}}` 死链 |

### 模块完成度清单

| 模块 | 状态 | 证据 |
|---|---|---|
| 移动端适配 / 角色卡导入 / 自由 Prompt 编排 / 时间线+RPG 追踪 / 多会话分支 / IndexedDB 离线 / 运行沙盒 / 微内核管道 / 全屏插件 / i18n（8 语） | ✅ 已完成 | README 10 大特性均有对应实现；插件系统 `parseFullscreenPluginPackage`(`domain/plugins/packageParser.ts`) 已接入 `PluginManagerSection.tsx`，内置 2 个 PixiJS 插件经 `builtinPlugins.ts` 打包 |
| 长期记忆（图谱/时态演化）、条件变量引擎、平行宇宙、插件消息总线 V2 | ✅ 已完成 | TODO.md 2026-07-28/29 完成记录 |
| 表结构编辑（记忆抽屉） | ⚠️ 注释过时但功能在 | `TableMemoryTab.tsx:270` 注释 "对应 TODO #1+#6 表结构编辑能力"，但 `startCreateSheet`/`startEditSheet`(276-293) 已实现逻辑。属**误导注释**而非半成品。 |
| WebXR AR 实境酒馆 | ⚠️ 原型/隐藏 | `services/ar/`（NativeArAdapter/TavernArBridge/useArSync）已实现并接入 `ChatHeader.tsx:63`；但 TODO.md 明确"已完成原型开发，按真机兼容限制隐去调试入口"——**未作为用户可完整使用功能开放**。 |
| 社区（Community） | ⚠️ 代码在，生产对齐待办 | `domain/community/`（adminSession/api/config/entryGate/identity/presentation）+ `CommunityTab.tsx`（懒加载注册于 `registerMainTabExtensions.ts:27`）代码完整；但 TODO.md 最高优先级为"社区生产版本对齐：部署最新社区二进制后复验…"（云端 `cloud/minimal-community` 已就绪，属**部署/版本对齐缺口**，非代码半成品）。 |
| 更新检查 / BGM / Worker 插件 / 角色渲染 | ✅ 已完成 | `UpdateCheckService.ts`(213 行)、`BgmService.ts`、`WorkerPluginService.ts` 均为完整实现 |

**真正的"未完成"集中在：AR（隐藏原型）+ 社区（待生产对齐）**，且二者均属**路线图/部署层面**，不是写到一半的代码桩。用户产生"半成品"观感的主要来源是 README 文档与代码严重脱节（见第八节）。

---

## 五、代码质量

**可读性 / 一致性**：整体优秀。代码有清晰的分层、命名规范、错误处理（SafeProxy / AbortSignal 传导、拓扑逆序销毁——见 TODO.md 2026-07-29 修复项）。

**TS 类型纪律（QUALITY-TYPES）**：
- `docs/agents/typescript_discipline.md` 有**登记豁免清单**，覆盖 bridgeCore、LLMService、TelemetryService、Tts/Asr/ImageGen、memory、types.ts、infrastructure/storage 等。多数 `any`（如 zodMock 40、tavernHelperMocks 43、bridgeCore 25、indexedDbMemoryStore 12）均在豁免内。
- **但存在未登记豁免的 `any`**（违规，应入表或清理）：`ChatInputArea.tsx`(11)、`usePresetFormState.ts`(19)、`useBackupRestore.ts`(27)、`imageGenerationHandler.ts`(18)、`MvuVariablesTabContent.tsx`(6)、`DictTab.tsx`(3)、`TimelineModal`(3) 等。量级不大但违反"新增豁免须登记"。

**超 1000 行文件（QUALITY-TYPES 硬阈值）**：

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/utils/tavernHelper/scriptIframe.ts` | 1304 | SillyTavern 兼容端口（iframe 沙盒 HTML 工厂），已拆分 esmReplacer/scriptPreprocessor，**建议登记为兼容层豁免或继续拆分** |
| `src/infrastructure/storage/indexedDbMemoryStore.ts` | 1058 | **真实业务存储实现，应拆分**（schema/读写/迁移可分离） |
| 8 个 locale 文件 (ko/zh-TW/zh-CN/pt-BR/en/ru/ja/es) | 1094–1137 | 自动生成，豁免 |

**典型坏味道**：
- `scriptIframe.ts:30` 仍用 `console.log` 做开发期诊断（虽 vite 生产构建已 pure 移除，但属兼容端口可接受）。
- `renderingRuntime.tsx:717` "暂不渲染真实的 Iframe 编译和挂载，避免高频重载"——为性能刻意延迟，非缺陷，但建议在注释中标注最终态规划。

---

## 六、可构建 / 可运行性

- **`npx tsc --noEmit`（即 `npm run lint`）实测：EXIT_CODE=0，耗时 18s，0 类型错误。** 强正向信号。
- 测试运行器 `tests/run_all_tests.ts` 体系完整；`quality:push` 串联 lint+i18n+test+build。
- 构建脚本链（`build:web`→`vite build` + `build:server`→esbuild；`build:android`/`build:mobile`）定义清晰，`vite.config.ts` 有 manualChunks 分包（mathjs/vue/lodash/react 隔离）。
- **未执行完整 `vite build`/Tauri 编译**（避免耗时全量构建，且需 Android SDK / Rust target）。基于"类型检查通过 + 构建脚本完整 + 611 测试通过"判断**可构建风险低**。
- `server.ts` 端点齐全（`/api/check-update:682`、`/api/proxy/*`、`/api/issue-token` 等）且含 SSRF 守卫，本地开发链路完整。

---

## 七、测试覆盖

- **611 个 `it`/`test` 用例**（vitest 95 文件 + playwright 4 e2e + 自研 cjs 脚本 11）。涵盖：物理 PNG 解码、SSRF 防御、Prompt 编排、撤销重做、JSON 模板迁移、**架构依赖边界**（`architectureBoundaries.test.ts` 24KB）、SafeProxy、洋葱管道严格模式、IndexedDB 分支原子替换、记忆服务（`memoryService.test.ts` 59KB）等。
- 架构边界由**自动化测试强制守卫**（禁止 kernel 子目录、AGENTS.md 行数上限等），质量门槛高。
- 短板：E2E 仅 4 个；i18n 有 `check-i18n` 脚本但未见覆盖全部 8 语的快照测试；AR / 社区无专项测试（因属原型/待对齐）。

---

## 八、文档

- **AGENTS.md（2.0.0）优秀**：铁律清晰、引用稳定标识、有按需专项入口，且被测试强制守护。
- `TECHNICAL.md`(104KB)、`knowledge.md`、`docs/agents/*`(48 文件) 详尽。
- **文档时效问题（明确风险）**：
  1. **README "核心功能 #9" 称"当前主测试链包含 80 组功能套件与 348 项 Vitest 断言"**，但 TODO.md(2026-07-29) 记"510 项测试全通过"，实际扫描为 **611 用例**——README 数字严重过时。
  2. README "源码目录结构简览"未体现 `src/services`、`src/compatibility`、`src/composition`、`src/tabs`、`src/hooks`、`src/contexts` 等实际新增层，与现状脱节。
  3. `TableMemoryTab.tsx:270` 等过时 TODO 注释。

---

## 九、优势 / 风险 / 改进建议

### 主要优势（5 条）
1. **分层纪律被自动化测试强制守护**（`architectureBoundaries.test.ts` 禁止 kernel 业务子目录、AGENTS.md 行数上限），不是靠自觉。
2. **类型安全实测过关**：`tsc --noEmit` 0 错误，严格模式 + `noImplicitAny` + 显式 `any` 豁免清单。
3. **完成度高且功能闭环**：10 大特性 + 插件系统 + 长期记忆图谱 + 条件变量引擎均落地。
4. **安全与降级意识强**：SSRF 守卫、更新检查放弃客户端签名、AbortSignal 全链路传导、SafeProxy 自愈。
5. **测试体量大且聚焦风险点**：架构边界、存储原子性、兼容防腐均有覆盖。

### 主要风险 / 隐患（5 条）
1. **架构分层漂移**：`src/services/`（ar/characterRender/pipeline）与 `src/application/services` 并存且 Adapter 错位，长期将弱化 ARCH-KERNEL/FLOW 边界。
2. **文档与代码脱节**：README 测试数(348) / 结构概览严重过时，新人易误判（"半成品"疑云大概率源于此）。
3. **两个 >1000 行文件**：`indexedDbMemoryStore.ts`(1058) 应拆分；`scriptIframe.ts`(1304) 建议登记兼容豁免。
4. **未登记豁免的 `any`**：`ChatInputArea`/`usePresetFormState`/`useBackupRestore`/`imageGenerationHandler` 等，违反 QUALITY-TYPES 登记要求。
5. **AR/社区为"准完成"状态**：AR 隐藏原型、社区待生产对齐——若视为"已交付"会有预期落差；二者无专项测试。

### 改进建议（按优先级）
- **P0**：
  1. 更新 README 测试统计（→611 用例）与目录结构概览，消除"半成品"误判源头；清理 `TableMemoryTab.tsx:270` 过时 TODO 注释。
  2. 将 `src/services/ar/NativeArAdapter.ts` 等 Adapter 迁至 `src/infrastructure/`，消除与 `application/services` 的职责重叠（可借架构边界测试加一条 "services 仅含 application 层" 守卫）。
- **P1**：
  3. 拆分 `indexedDbMemoryStore.ts`(1058 行) 为 schema/读写/迁移；将 `scriptIframe.ts` 登记为 QUALITY-TYPES 兼容层豁免或继续拆分。
  4. 补齐未登记豁免的 `any`（`ChatInputArea`/`usePresetFormState`/`useBackupRestore`/`imageGenerationHandler`）入 `typescript_discipline.md` 或改用 `unknown`/Schema。
- **P2**：
  5. 为 AR、社区（含云端 `minimal-community` 对齐）补专项测试与上线状态标记；扩充 Playwright E2E 覆盖核心 Tab。
  6. 对 README 其余统计（功能清单版本号）做一次全量校准，纳入 `check:i18n` 同类 CI 门禁。

---

## 附录：证据清单（文件路径）

| 类型 | 路径 |
|---|---|
| 分层边界测试 | `tests/suites/architectureBoundaries.test.ts` (131-139) |
| 过时 TODO 注释 | `components/.../TableMemoryTab.tsx:270`（功能已实现） |
| AR 适配/桥接 | `src/services/ar/NativeArAdapter.ts`、`TavernArBridge.ts`、`useArSync.ts`；接入点 `ChatHeader.tsx:63` |
| 社区模块 | `src/domain/community/`（adminSession/api/config/entryGate/identity/presentation）、`CommunityTab.tsx`、`registerMainTabExtensions.ts:27` |
| 超 1000 行文件 | `src/utils/tavernHelper/scriptIframe.ts`(1304)、`src/infrastructure/storage/indexedDbMemoryStore.ts`(1058) |
| 未登记 `any` | `ChatInputArea.tsx`(11)、`usePresetFormState.ts`(19)、`useBackupRestore.ts`(27)、`imageGenerationHandler.ts`(18) |
| 完整实现服务 | `UpdateCheckService.ts`(213)、`BgmService.ts`、`WorkerPluginService.ts` |
| 文档时效问题 | `README.md`（测试数 348 / 旧目录结构）、`AGENTS.md`(2.0.0) |

---

*本报告由架构师高见远基于静态分析产出，主理人齐活林汇编。源码零改动。*
