/**
 * localDB 聚合层（re-export facade）。
 *
 * 历史上本文件是 IndexedDB 的全量实现（连接管理 + 写队列 + CRUD + 加密），
 * 随功能演进已突破 700 行，单文件职责过重。2026-07 重构将物理实现按职责拆分到
 * src/infrastructure/storage/ 下的独立模块：
 *
 *   - idbConnection.ts         连接管理 + generation 测试隔离
 *   - idbQueue.ts              写队列 + AbortSignal 协作式中断 + 事务 abort 工具
 *   - settingsCrypto.ts        AES-GCM 加密
 *   - dbSchema.ts              schema 单一来源
 *   - sessionRecord.ts         会话持久化记录映射
 *   - indexedDbSessionQueries.ts 会话查询（分页/计数/直查）
 *   - repositories/            按 Store 分文件的 CRUD 仓库
 *
 * 本文件保留为公共 API 入口，统一 re-export 上述模块的导出符号，避免现有调用方
 * 大规模修改导入路径。新增功能请直接在对应子模块实现，不要回到本文件堆砌。
 *
 * 唯一保留在本文件的逻辑是 __resetDBInstanceForTesting：作为测试重置的统一协调入口，
 * 依次调用各子模块的 reset 函数，确保跨模块状态完整清理。
 */

import { __resetCryptoKeyForTesting } from "../infrastructure/storage/settingsCrypto";
import { __resetWriteQueueForTesting } from "../infrastructure/storage/idbQueue";
import { __resetConnectionForTesting } from "../infrastructure/storage/idbConnection";

// === 连接管理 ===
export { getDB } from "../infrastructure/storage/idbConnection";

// === 写队列与事务工具 ===
export {
  enqueueWrite,
  bindTransactionAbort,
  bindReadonlyTransactionAbort,
  type WriteContext,
} from "../infrastructure/storage/idbQueue";

// === 加密工具（保持历史导入路径兼容）===
export { decryptValue, encryptValue } from "../infrastructure/storage/settingsCrypto";

// === Characters Store ===
export {
  getAllCharacters,
  getCharacterById,
  saveCharacter,
  deleteCharacter,
  bulkSaveCharacters,
} from "../infrastructure/storage/repositories/charactersRepository";

// === Sessions Store（查询走 indexedDbSessionQueries，写入走 sessionsWriteRepository）===
export {
  getAllSessions,
  getSessionById,
  getSessionsCount,
  getSessionsPaginated,
} from "../infrastructure/storage/indexedDbSessionQueries";
export {
  saveSession,
  deleteSession,
  bulkSaveSessions,
} from "../infrastructure/storage/repositories/sessionsWriteRepository";

// === Settings Store ===
export {
  getStoredSettings,
  saveStoredSettings,
  getStoredSavedPresets,
  saveStoredSavedPresets,
  getStoredDefaultCharactersInitializedFlag,
  saveStoredDefaultCharactersInitializedFlag,
  getStoredUsageMetrics,
  saveStoredUsageMetrics,
} from "../infrastructure/storage/repositories/settingsRepository";

// === Lorebooks Store ===
export {
  getGlobalLorebook,
  saveGlobalLorebook,
} from "../infrastructure/storage/repositories/lorebooksRepository";

// === Worldbooks Store ===
export {
  getCustomWorldbooks,
  saveCustomWorldbooks,
} from "../infrastructure/storage/repositories/worldbooksRepository";

/**
 * 测试专用：重置模块级 DB 实例缓存、写队列与 crypto key。
 * 仅供 tests/ 下的测试套件在 mock IDB 前调用，严禁在生产代码中使用。
 *
 * 作为统一协调入口，依次调用各子模块的 reset 函数：
 *  - __resetConnectionForTesting：关闭 DB 连接、清理 dbOpenPromise、递增 generation
 *  - __resetWriteQueueForTesting：清空写队列与 key 合并槽位
 *  - __resetCryptoKeyForTesting：清空 crypto key 缓存
 */
export function __resetDBInstanceForTesting(): void {
  __resetConnectionForTesting();
  __resetWriteQueueForTesting();
  __resetCryptoKeyForTesting();
}
