/**
 * 跨设备同步的删除墓碑。
 *
 * 合并两台设备的快照时，"对端没有这条记录"有两种截然不同的含义：该记录尚未同步过去，
 * 或者该记录已被对端删除。没有墓碑就无法区分二者，合并只能把记录留下，
 * 结果就是对端删掉的数据被另一台设备推回来（删除被复活）。
 *
 * 墓碑保存的正是"此处发生过删除"这一事实。本模块只描述领域事实与判定规则，
 * 不涉及存储事务、传输协议与界面，因此可被 WebView 与 Node 宿主两侧共用。
 */

/** 墓碑覆盖的实体类型。会话墓碑连带覆盖该会话下的全部消息，无需逐条记录。 */
export type SyncTombstoneEntity = "session" | "message";

export interface SyncTombstone {
  entity: SyncTombstoneEntity;
  /** 被删除实体的唯一标识；`entity === "session"` 时与 `sessionId` 相同。 */
  targetId: string;
  /** 归属会话：会话墓碑记自身 id，消息墓碑记所属会话 id，便于按会话整体清理。 */
  sessionId: string;
  /** 删除发生时间（毫秒时间戳）。冲突裁决与"复活判定"的唯一依据。 */
  deletedAt: number;
  /** 删除来源设备，仅用于诊断，不参与裁决。 */
  deviceId?: string;
}

/** 墓碑 Store 的复合主键，必须与 dbSchema 中 `sync_tombstones` 的 keyPath 一致。 */
export const SYNC_TOMBSTONE_KEY_PATH = ["entity", "targetId"] as const;

export function isSyncTombstoneEntity(value: unknown): value is SyncTombstoneEntity {
  return value === "session" || value === "message";
}

/** 墓碑在内存索引中的去重键；使用不会出现在 id 中的分隔符，避免拼接歧义。 */
export function syncTombstoneKey(entity: SyncTombstoneEntity, targetId: string): string {
  return `${entity}\u0000${targetId}`;
}

/**
 * 判定墓碑是否仍然压过一条现存记录。
 *
 * - 记录不存在（`recordUpdatedAt` 为 undefined）：墓碑生效，表示该删除尚未被对端接受。
 * - 记录最后修改时间不晚于删除时间：墓碑生效，记录应当被删除。
 * - 记录最后修改时间晚于删除时间：记录在删除之后被重新写入（会话恢复等），
 *   属于复活，墓碑失效，调用方应保留记录并丢弃该墓碑。
 */
export function isTombstoneEffective(
  tombstone: SyncTombstone,
  recordUpdatedAt: number | undefined,
): boolean {
  if (recordUpdatedAt === undefined) return true;
  if (!Number.isFinite(recordUpdatedAt)) return true;
  return recordUpdatedAt <= tombstone.deletedAt;
}

/**
 * 按实体去重，同一实体保留删除时间较晚的一条。
 *
 * 两台设备各自删除过同一实体时会产生两条墓碑，合并结果必须收敛为一条，
 * 否则每次同步都会重复计算同一处删除。
 */
export function dedupeSyncTombstones(
  tombstones: Iterable<SyncTombstone>,
): SyncTombstone[] {
  const byKey = new Map<string, SyncTombstone>();
  for (const tombstone of tombstones) {
    const key = syncTombstoneKey(tombstone.entity, tombstone.targetId);
    const existing = byKey.get(key);
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      byKey.set(key, tombstone);
    }
  }
  return Array.from(byKey.values());
}
