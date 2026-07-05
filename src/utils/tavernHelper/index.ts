/**
 * index.ts — TavernHelper Bridge 模块 barrel 导出
 *
 * 此文件为唯一的公共入口，将各子模块的公共 API 统一 re-export。
 * 外部消费者通过 `from "../utils/tavernHelper"` 或 `from "../../src/utils/tavernHelper"` 导入。
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
  ensureLibrariesLoaded,
  ensureCoreLibsLoaded,
  ensureUiLibsLoaded,
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
