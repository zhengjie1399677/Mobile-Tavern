/**
 * index.ts — TavernHelper Bridge 模块 barrel 导出
 *
 * 此文件为唯一的公共入口，将各子模块的公共 API 统一 re-export。
 * 外部消费者通过 `from "../utils/tavernHelper"` 或 `from "../../src/utils/tavernHelper"` 导入。
 *
 * 模块依赖拓扑（单向，无循环）：
 *
 *   bridgeCore ──→ tavernHelperMocks ──→ zodMock
 *        │               │
 *        │               └──→ mvuParser
 *        │
 *        └──→ scriptIframe（独立，?raw 导入）
 *
 * 注意：tavernHelperMocks 的顶层 IIFE 在模块加载时立即注册 window.* 全局 Mock，
 * 此副作用通过下方的 import 语句自动触发。
 */

// 触发 window 全局 Mock 注册（副作用导入）
import "./tavernHelperMocks";

// ── 状态与生命周期 ──────────────────────────────────────────────────────────
export type { TavernHelperBridgeParams } from "./bridgeCore";
export {
  initTavernHelperBridge,
  cleanTavernHelperBridge,
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

// ── Iframe 工厂与脚本预处理 ─────────────────────────────────────────────────
export {
  preprocessScriptContent,
  createScriptIframeSrcDoc,
  createMessageIframeSrcDoc,
} from "./scriptIframe";

// ── MVU 命令解析引擎 ────────────────────────────────────────────────────────
export {
  extractMvuCommands,
  extractXmlMvuCommands,
  detectJsonPatch,
  parseMvuMessage,
} from "./mvuParser";

// ── 卡片运行时适配器接口契约 ────────────────────────────────────────────────
export type { ICardRuntimeAdapter, CardRuntimeBridgeParams } from "./CardRuntimeAdapter";
