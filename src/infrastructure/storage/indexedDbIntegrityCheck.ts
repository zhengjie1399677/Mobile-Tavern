import { getDB } from "../../utils/localDB";
import { reportImmediate } from "../../utils/telemetry";

// ─── 启动时 IndexedDB 完整性扫描 ───────────────────────────────────────────────
// 此前仅有 v1→v9 迁移与写队列并发安全网（串行化、15s 超时、队列深度告警），
// 但单副本存储无冗余，缺少启动时的 schema 完整性扫描与损坏检测。
// 本模块在 DB 打开后校验所有期望的 objectStore 与关键索引是否存在，
// 发现缺失时上报遥测但不自动修复（自动修复对单副本存储风险过高，需用户介入）。

interface ExpectedStoreSchema {
  indexes: string[];
}

const EXPECTED_DB_SCHEMA: Record<string, ExpectedStoreSchema> = {
  characters: { indexes: [] },
  sessions: { indexes: ["characterId", "createdAt"] },
  settings: { indexes: [] },
  lorebooks: { indexes: [] },
  worldbooks: { indexes: [] },
  messages: { indexes: ["sessionId", "createdAt", "tags", "sessionId_createdAt"] },
  memory_dict: { indexes: ["sessionId", "entity"] },
  memory_fragments: { indexes: ["sessionId", "tags", "status", "sessionId_sourceTurnEnd"] },
};

export interface DatabaseIntegrityReport {
  healthy: boolean;
  issues: string[];
  dbVersion: number;
}

/**
 * 扫描 IndexedDB schema 完整性：校验所有期望的 objectStore 与关键索引是否存在。
 *
 * 行为边界：
 *   - 仅扫描不修复：单副本存储自动修复风险过高（可能触发数据迁移误删），缺失项仅上报遥测与日志
 *   - 不阻断启动：返回 issues 供调用方决策，本函数自身不抛错
 *   - 幂等：可重复调用，每次返回当前 DB 的扫描快照
 */
export async function verifyDatabaseIntegrity(): Promise<DatabaseIntegrityReport> {
  const issues: string[] = [];
  let dbVersion = 0;
  try {
    const db = await getDB();
    dbVersion = db.version;

    const expectedStoreNames = Object.keys(EXPECTED_DB_SCHEMA);
    for (const storeName of expectedStoreNames) {
      if (!db.objectStoreNames.contains(storeName)) {
        issues.push(`missing_object_store:${storeName}`);
        continue;
      }
      // 打开只读事务校验索引存在性
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const expectedIndexes = EXPECTED_DB_SCHEMA[storeName].indexes;
        for (const idxName of expectedIndexes) {
          if (!store.indexNames.contains(idxName)) {
            issues.push(`missing_index:${storeName}.${idxName}`);
          }
        }
      } catch (e) {
        issues.push(`store_access_error:${storeName}:${(e as Error).message ?? "unknown"}`);
      }
    }
  } catch (e) {
    issues.push(`db_open_error:${(e as Error).message ?? "unknown"}`);
  }

  const healthy = issues.length === 0;
  if (!healthy) {
    console.warn(`[localDB] Integrity scan found ${issues.length} issue(s):`, issues);
    // 上报遥测：缺失项供 SLS 侧定位损坏设备与版本分布
    // 失败兜底：遥测管道异常不得演化为 unhandled rejection
    try {
      reportImmediate("db_integrity_issue", {
        healthy,
        dbVersion,
        issues: issues.join(";").slice(0, 2000),
        issueCount: issues.length,
      }).catch(() => {
        // 静默：遥测不可用时不影响 DB 主流程
      });
    } catch {
      // 同步异常兜底
    }
  }

  return { healthy, issues, dbVersion };
}
