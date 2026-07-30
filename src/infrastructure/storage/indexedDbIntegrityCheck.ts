import { getDB } from "./idbConnection";
import { reportImmediate } from "../../utils/telemetry";
import { DB_SCHEMA } from "./dbSchema";

// ─── 启动时 IndexedDB 完整性扫描 ───────────────────────────────────────────────
// 此前仅有版本迁移与写队列并发安全网（串行化、15s 超时、队列深度告警），
// 但单副本存储无冗余，缺少启动时的 schema 完整性扫描与损坏检测。
// 本模块在 DB 打开后校验所有期望的 objectStore 与关键索引是否存在，
// 发现缺失时上报遥测但不自动修复（自动修复对单副本存储风险过高，需用户介入）。
//
// schema 期望清单统一引用 dbSchema.ts 的 DB_SCHEMA 单一来源，
// 与 idbConnection.ts 的 onupgradeneeded 共享同一份定义，消除双源同步风险。

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

    for (const storeDef of DB_SCHEMA) {
      if (!db.objectStoreNames.contains(storeDef.name)) {
        issues.push(`missing_object_store:${storeDef.name}`);
        continue;
      }
      // 打开只读事务校验索引存在性
      try {
        const tx = db.transaction(storeDef.name, "readonly");
        const store = tx.objectStore(storeDef.name);
        for (const idxDef of storeDef.indexes) {
          if (!store.indexNames.contains(idxDef.name)) {
            issues.push(`missing_index:${storeDef.name}.${idxDef.name}`);
          }
        }
      } catch (e) {
        issues.push(`store_access_error:${storeDef.name}:${(e as Error).message ?? "unknown"}`);
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
