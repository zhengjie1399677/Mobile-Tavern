/**
 * IndexedDB Schema 单一来源。
 *
 * 此前 schema 定义分散在两处：
 *   - `localDB.ts` 的 `getDB().onupgradeneeded`：过程式 createObjectStore/createIndex
 *   - `indexedDbIntegrityCheck.ts` 的 `EXPECTED_DB_SCHEMA`：表结构清单
 *
 * 两份独立来源存在同步风险：未来新增 store/index 容易遗漏一处。本文件抽出
 * 单一 schema 描述，`applyDbSchema` 用于升级路径，`DB_SCHEMA` 用于完整性扫描。
 *
 * 升级路径中 v6 数据迁移（global_lorebook / custom_worldbooks 从 settings 拆出）
 * 仍保留在 applyDbSchema 内，因依赖 upgrade 事务且仅在 oldVersion < 6 触发。
 */

export const DB_NAME = "MobileTavernLiteDB";

// v7: 新增 sessions.createdAt 索引，支持按时间倒序分页加载（P0-1）
// v8: 新增 messages 和 memory_dict Store，承载记忆系统物理分轨存储（AGENTS.md 准则一）
// v9: 新增 memory_fragments Store，承载可纠错的事件型长期记忆
// v10: 新增 memory_facts Store，承载实体关系图与时态事实演化
// v11: 新增 character_catalog Store，首屏只读取轻量角色目录
// v12: 新增 messages.sessionId_turnIndex_createdAt 索引，并按创建时间修复旧消息序号
// v13: 为 character_catalog 补回首页展示所需头像，仍排除其余角色卡重数据
export const DB_VERSION = 13;

export interface IndexSchema {
  name: string;
  keyPath: string | string[];
  multiEntry?: boolean;
}

export interface StoreSchema {
  name: string;
  /** undefined 表示 out-of-line keys（put 时显式传入 key） */
  keyPath?: string;
  indexes: IndexSchema[];
}

/**
 * 完整 schema 清单：所有期望存在的 objectStore 与 index。
 *
 * 顺序与 onupgradeneeded 历史创建顺序保持一致，便于跨版本升级排查。
 */
export const DB_SCHEMA: StoreSchema[] = [
  { name: "characters", keyPath: "id", indexes: [] },
  { name: "character_catalog", keyPath: "id", indexes: [] },
  {
    name: "sessions",
    keyPath: "id",
    indexes: [
      { name: "characterId", keyPath: "characterId" },
      { name: "createdAt", keyPath: "createdAt" },
    ],
  },
  // settings / lorebooks / worldbooks 使用 out-of-line keys
  { name: "settings", indexes: [] },
  { name: "lorebooks", indexes: [] },
  { name: "worldbooks", indexes: [] },
  {
    name: "messages",
    keyPath: "id",
    indexes: [
      { name: "sessionId", keyPath: "sessionId" },
      { name: "createdAt", keyPath: "createdAt" },
      { name: "tags", keyPath: "tags", multiEntry: true },
      { name: "sessionId_createdAt", keyPath: ["sessionId", "createdAt"] },
      {
        name: "sessionId_turnIndex_createdAt",
        keyPath: ["sessionId", "turnIndex", "createdAt"],
      },
    ],
  },
  {
    name: "memory_dict",
    keyPath: "id",
    indexes: [
      { name: "sessionId", keyPath: "sessionId" },
      { name: "entity", keyPath: "entity" },
    ],
  },
  {
    name: "memory_fragments",
    keyPath: "id",
    indexes: [
      { name: "sessionId", keyPath: "sessionId" },
      { name: "tags", keyPath: "tags", multiEntry: true },
      { name: "status", keyPath: "status" },
      { name: "sessionId_sourceTurnEnd", keyPath: ["sessionId", "sourceTurnEnd"] },
    ],
  },
  {
    name: "memory_facts",
    keyPath: "id",
    indexes: [
      { name: "sessionId", keyPath: "sessionId" },
      { name: "subject", keyPath: "subject" },
      { name: "object", keyPath: "object" },
      { name: "tags", keyPath: "tags", multiEntry: true },
      { name: "status", keyPath: "status" },
      { name: "sessionId_subject_predicate", keyPath: ["sessionId", "subject", "predicate"] },
    ],
  },
];

/**
 * 在 upgrade 事务中应用 schema：创建缺失的 objectStore 与 index。
 *
 * 幂等：已存在的 store/index 跳过，可重复调用。
 *
 * v6 数据迁移（global_lorebook / custom_worldbooks 从 settings 拆出）保留在此处：
 *   - 依赖 upgrade 事务，无法独立运行
 *   - 仅在 oldVersion < 6 时触发，向前兼容老用户
 *
 * @param db 新打开的 IDBDatabase
 * @param oldVersion 旧版本号（event.oldVersion）
 * @param transaction upgrade 事务（request.transaction）
 */
export function applyDbSchema(
  db: IDBDatabase,
  oldVersion: number,
  transaction: IDBTransaction
): void {
  for (const storeDef of DB_SCHEMA) {
    let store: IDBObjectStore;
    if (!db.objectStoreNames.contains(storeDef.name)) {
      // 严格遵循 IDB 规范：out-of-line keys 的 store 不传 options 参数。
      // 部分 IDB 实现（含 fake-indexeddb）对 undefined 第二参数处理不一致，
      // 显式分支避免任何解析差异。
      store = storeDef.keyPath
        ? db.createObjectStore(storeDef.name, { keyPath: storeDef.keyPath })
        : db.createObjectStore(storeDef.name);
    } else {
      store = transaction.objectStore(storeDef.name);
    }

    for (const indexDef of storeDef.indexes) {
      if (!store.indexNames.contains(indexDef.name)) {
        store.createIndex(indexDef.name, indexDef.keyPath, {
          unique: false,
          multiEntry: indexDef.multiEntry === true,
        });
      }
    }
  }

  // v6 数据迁移：将 global_lorebook / custom_worldbooks 从 settings 拆出到独立 store
  // 物理分轨存储大对象，防止 settings 膨胀导致白屏
  if (oldVersion < 6) {
    const settingsStore = transaction.objectStore("settings");
    const lorebooksStore = transaction.objectStore("lorebooks");
    const worldbooksStore = transaction.objectStore("worldbooks");

    const reqLore = settingsStore.get("global_lorebook");
    reqLore.onsuccess = () => {
      if (reqLore.result) {
        lorebooksStore.put(reqLore.result, "global_lorebook");
        settingsStore.delete("global_lorebook");
      }
    };

    const reqWorld = settingsStore.get("custom_worldbooks");
    reqWorld.onsuccess = () => {
      if (reqWorld.result) {
        worldbooksStore.put(reqWorld.result, "custom_worldbooks");
        settingsStore.delete("custom_worldbooks");
      }
    };
  }

  if (oldVersion < 11) {
    const characters = transaction.objectStore("characters");
    const catalog = transaction.objectStore("character_catalog");
    if (typeof characters.openCursor === "function") {
      characters.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        catalog.put(toCharacterCatalogRecord(cursor.value));
        cursor.continue();
      };
    }
  }

  if (oldVersion < 12) {
    // v12 迁移幂等修复：迁移中途异常重启时，部分消息已分配 turnIndex。
    // 若重新遍历并覆盖，会破坏已落盘的顺序，导致 turnIndex 错乱。
    // 修复策略：对每条记录先检查 turnIndex 是否已存在，
    //   - 已存在：更新 nextTurnBySession 为 max(current, existing+1)，不重新 put
    //   - 不存在：按 nextTurnBySession 分配并 put
    // 这样可保证重启后未迁移的消息从已有最大值 +1 开始分配，不产生重复或覆盖。
    const messages = transaction.objectStore("messages");
    const nextTurnBySession = new Map<string, number>();
    const source = messages.indexNames.contains("sessionId_createdAt")
      ? messages.index("sessionId_createdAt")
      : messages;
    const messageCursorRequest = source.openCursor();
    messageCursorRequest.onsuccess = () => {
      const cursor = messageCursorRequest.result;
      if (!cursor) return;
      const record = cursor.value;
      if (typeof record?.sessionId === "string") {
        const existingTurn = record.turnIndex;
        if (typeof existingTurn === "number" && Number.isFinite(existingTurn)) {
          // 已迁移过的记录：保留原值，仅推进计数器防止后续分配冲突
          const current = nextTurnBySession.get(record.sessionId) || 0;
          nextTurnBySession.set(record.sessionId, Math.max(current, existingTurn + 1));
        } else {
          const nextTurn = nextTurnBySession.get(record.sessionId) || 0;
          messages.put({ ...record, turnIndex: nextTurn });
          nextTurnBySession.set(record.sessionId, nextTurn + 1);
        }
      }
      cursor.continue();
    };
  }

  if (oldVersion >= 11 && oldVersion < 13) {
    const characters = transaction.objectStore("characters");
    const catalog = transaction.objectStore("character_catalog");
    if (typeof characters.openCursor === "function") {
      characters.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        catalog.put(toCharacterCatalogRecord(cursor.value));
        cursor.continue();
      };
    }
  }
}

export function toCharacterCatalogRecord(character: Record<string, any>): Record<string, any> {
  return {
    id: character.id,
    name: character.name || "",
    description: character.description || "",
    avatar: character.avatar || "",
    creator: character.creator,
    tags: Array.isArray(character.tags) ? character.tags : [],
  };
}
