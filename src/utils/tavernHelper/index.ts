/**
 * index.ts — SillyTavern Compatibility Runtime 模块 barrel 导出
 *
 * ⚠️ 状态说明（2026-09-14 核查，请勿按旧注释理解）：
 *
 * 本目录是 SillyTavern 兼容层的**实际主实现**，约 4,241 行，不是"旧导入兼容壳"。
 * `src/compatibility/sillytavern/`（约 820 行）只是**对外门面**，其中 mvuParser 等
 * 仍以 `export * from "../../utils/tavernHelper/..."` 转发回本目录。
 *
 * 当前仍有 12 个活跃调用方（含 application/services/ScriptService、聊天主链路
 * hooks/useChat/streamHelpers 与 pipelineHelpers），因此这块代码跑在每次对话的
 * 关键路径上，**不是死代码，重构时不可直接删除**。
 *
 * 迁移状态：**已暂缓**。降级为 plugin 的入口层已完成
 * （src/application/runtimePlugins/sillyTavernCompatibilityRuntimePlugin.ts），
 * 但内核仍直连本目录。暂缓原因：这 ~3,900 行的「脚本宿主 / 沙箱执行」能力
 * 归属未定（属于 ST 兼容？还是应升为底座通用能力？），归属未定则无法安全迁移。
 * 计划待产品功能收敛后一并重做，而非原地搬运。
 *
 * 新代码约定：**ST 相关新代码请从 `src/compatibility/sillytavern/` 导入**，
 * 不要再新增对本目录的依赖；本目录仅做存量维护。
 *
 * 该目录是 SillyTavern 角色卡、MVU 与脚本生态的长期防腐层，不是通用 Kernel 服务、
 * 第三方全屏插件 RPC 或 Tauri 原生能力桥；外部动态数据必须在此完成解析与降级。
 *
 * 模块依赖拓扑（经 grep 验证，单向无静态循环）：
 *
 *   tavernHelperMocks ──→ bridgeCore ──→ mvuParser
 *        │                   │
 *        ├──→ zodMock        └──→ kernel/Kernel（事件总线 + registerBridge）
 *        └──→ mvuParser
 *
 *   scriptIframe ──→ esmReplacer + scriptPreprocessor（独立，?raw 导入）
 *
 * 注意：tavernHelperMocks 的全局 Mock 注册已改为显式调用 initTavernHelperMocks()，
 * 由 initTavernHelperBridge() 在初始化时触发，不再通过副作用导入隐式执行。
 */

// ── 状态与生命周期 ──────────────────────────────────────────────────────────
export type { TavernHelperBridgeParams } from "./bridgeCore";
export {
  initTavernHelperBridge,
  cleanTavernHelperBridge,
  getBridgeInterface,
  notifyVariablesUpdated,
  initializeMvuFromCharacter,
  hasCardScripts,
  cardNeedsMathRuntime,
  ensureLibrariesLoaded,
  ensureCoreLibsLoaded,
  ensureUiLibsLoaded,
  ensureMathLibLoaded,
  initializeVariablesForSession,
  getSwipeVariables,
  resolveMessageId,
  getBridgeParams,
} from "./bridgeCore";

// ── 全局 Mock 初始化 ────────────────────────────────────────────────────────
export { initTavernHelperMocks } from "./tavernHelperMocks";

// ── Iframe 工厂与脚本预处理 ─────────────────────────────────────────────────
export { preprocessScriptContent } from "./scriptPreprocessor";
export {
  createScriptIframeSrcDoc,
  createMessageIframeSrcDoc,
} from "./scriptIframe";

// ── MVU 命令解析引擎 ────────────────────────────────────────────────────────
export {
  extractMvuCommands,
  extractXmlMvuCommands,
  detectJsonPatch,
  parseMvuMessage,
  parseNestedYaml,
  deepMerge,
} from "./mvuParser";

// ── 卡片运行时适配器接口契约 ────────────────────────────────────────────────
export type { ICardRuntimeAdapter, CardRuntimeBridgeParams } from "./CardRuntimeAdapter";
