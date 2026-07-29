/**
 * IndexedDB 连接管理与测试隔离。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 DB 连接的复用、版本变更处理、
 * 与测试隔离 generation 计数器，不涉及写队列、CRUD 与 schema 管理。
 *
 * 设计要点：
 *  - 模块级 dbInstance 缓存避免重复 open 开销
 *  - dbOpenPromise 复用防止并发 open 触发 versionchange 互踢
 *  - generation 计数器解决前序测试遗留 pending open 请求覆盖 dbInstance 的竞态
 *  - onversionchange 主动 close 响应版本升级，避免幽灵连接阻塞
 */

import {
  DB_NAME,
  DB_VERSION,
  applyDbSchema,
} from "./dbSchema";

let dbInstance: IDBDatabase | null = null;

// 测试隔离 generation 计数器：每次 __resetConnectionForTesting 时递增。
// 解决前序测试遗留的 pending indexedDB.open() 请求在后续测试期间触发 onsuccess、
// 覆盖 dbInstance 为错误 db 实例的竞态问题。
// getDB 的 onsuccess 回调会检查 generation 是否匹配，不匹配则丢弃过期的 db 实例。
let dbInstanceGeneration = 0;

// pending 的 DB 打开 Promise：并发场景下复用同一 Promise，避免两次 indexedDB.open
// 触发 versionchange 互踢竞争（首个连接被第二个 open 的 versionchange 强制 close，
// 导致 dbInstance 反复置 null）。
let dbOpenPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpenPromise) return dbOpenPromise;

  // 捕获当前 generation：onsuccess 触发时若 generation 不匹配，说明
  // __resetConnectionForTesting 已被调用（前序测试的 open 请求过期），需丢弃结果。
  const currentGeneration = dbInstanceGeneration;
  dbOpenPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      // 仅当 generation 匹配时才清理 dbOpenPromise，避免清理新 generation 的 promise
      if (currentGeneration === dbInstanceGeneration) {
        dbOpenPromise = null;
      }
      reject(request.error);
    };
    request.onsuccess = () => {
      // generation 不匹配：前序测试遗留的 open 请求在 __resetConnectionForTesting 后才触发，
      // 丢弃结果，避免覆盖当前测试的 dbInstance（测试隔离关键修复）。
      // 必须显式 close 泄漏的连接：否则幽灵连接会阻塞后续 open 的 versionchange 升级。
      if (currentGeneration !== dbInstanceGeneration) {
        try { request.result.close(); } catch { /* 忽略二次关闭 */ }
        return;
      }
      dbInstance = request.result;

      dbInstance.onclose = () => {
        dbInstance = null;
        dbOpenPromise = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbOpenPromise = null;
      };

      dbOpenPromise = null;
      resolve(request.result);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      // schema 创建与 v6 数据迁移统一委托给 dbSchema.ts 单一来源，
      // 避免与 indexedDbIntegrityCheck.ts 的 EXPECTED_DB_SCHEMA 出现同步漂移。
      applyDbSchema(request.result, event.oldVersion, request.transaction!);
    };
  });

  return dbOpenPromise;
}

/**
 * 测试专用：重置 DB 连接缓存与 generation 计数器。
 *
 * 仅重置连接相关状态；写队列与 crypto key 的重置由 localDB.__resetDBInstanceForTesting
 * 协调调用各自模块的重置函数。严禁生产代码使用。
 *
 * 显式关闭旧连接：仅置 dbInstance=null 会让连接保持打开状态，其 onversionchange
 * 回调中 dbInstance 已为 null 无法执行 close，导致后续需要版本升级的 open 调用
 * 被幽灵连接阻塞（versionchange 无人响应），表现为测试超时。
 */
export function __resetConnectionForTesting(): void {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* 忽略二次关闭 */ }
  }
  dbInstance = null;
  dbOpenPromise = null;
  dbInstanceGeneration++;
}
