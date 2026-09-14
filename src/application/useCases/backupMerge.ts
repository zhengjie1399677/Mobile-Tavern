/**
 * 覆盖式同步之外的第二种同步语义：**合并**。
 *
 * 覆盖式（`replaceFromBackup`）的语义是"接收端的世界从此等于备份的世界"，
 * 两台设备各自新增的内容会互相抹掉。本模块实现"两侧内容求并集"：
 * 每一侧独有的数据都保留下来，同一标识的分歧按确定性规则裁决。
 *
 * 三条不可动摇的性质：
 *  1. **收敛**：裁决规则不依赖"谁是本地/谁是远端"，A 合并 B 与 B 合并 A 得到同一结果，
 *     否则每次同步都会产生新的差异，数据永远合不上。
 *  2. **删除可传播**：墓碑命中的实体一律移除；被"复活"的实体（记录时间晚于删除时间）
 *     同时剔除墓碑，避免下次同步重新删掉它。
 *  3. **纯函数**：不读写存储、不发网络请求，因此可被界面用于"先预览再落库"。
 *
 * 设置（`settings`）不参与合并：备份导出整体脱敏，拿对端设置覆盖会清空接收端凭据，
 * 因此合并结果一律保留接收端（即 `local`）的设置。
 */
import type { ChatSession, Message } from "../../types";
import {
  dedupeSyncTombstones,
  isTombstoneEffective,
  syncTombstoneKey,
  type SyncTombstone,
} from "../../domain/sync/tombstones";
import { summarizeBackupPayload, type BackupPayloadSummary } from "./backupPayloadRestore";
import {
  buildUnifiedBackupPayload,
  type UnifiedBackupPayload,
} from "./dataMigrationUseCases";
import { calculateSessionMessageStats } from "../../infrastructure/storage/sessionRecord";

/** 单个集合的合并变更计数。 */
export interface MergeCollectionStats {
  /** 仅对端存在、被并入本地的条目。 */
  added: number;
  /** 两侧都有且结果取自对端的条目。 */
  updated: number;
  /** 被删除墓碑移除的条目。 */
  removed: number;
  /** 两侧一致或结果取自本地的条目。 */
  unchanged: number;
}

export interface SessionMergeConflict {
  sessionId: string;
  title: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  /** 元数据裁决结果；`identical` 表示两侧元数据完全一致。 */
  resolution: "local" | "remote" | "identical";
}

export interface BackupMergeStats {
  characters: MergeCollectionStats;
  sessions: MergeCollectionStats;
  messages: MergeCollectionStats;
  memoryDictEntries: MergeCollectionStats;
  memoryFragments: MergeCollectionStats;
  memoryFacts: MergeCollectionStats;
  globalLorebook: MergeCollectionStats;
  customWorldbooks: MergeCollectionStats;
  savedPresets: MergeCollectionStats;
  attachments: MergeCollectionStats;
  agentJournal: MergeCollectionStats;
  tombstones: MergeCollectionStats;
}

export interface BackupMergePlan {
  /** 合并后的完整信封。调用方确认后再交给 replaceLocalDataFromBackup 落库。 */
  merged: UnifiedBackupPayload;
  stats: BackupMergeStats;
  /** 两侧元数据不一致的会话明细，供预览界面解释裁决结果。 */
  conflicts: SessionMergeConflict[];
  /** 合并前后双方规模，供预览界面展示"谁带来了什么"。 */
  localSummary: BackupPayloadSummary;
  remoteSummary: BackupPayloadSummary;
  /** 合并结果的总规模。 */
  mergedSummary: BackupPayloadSummary;
}

export interface BackupMergeInput {
  /** 接收端当前数据；其设置会被原样保留。 */
  local: UnifiedBackupPayload;
  /** 对端快照。 */
  remote: UnifiedBackupPayload;
}

function emptyStats(): MergeCollectionStats {
  return { added: 0, updated: 0, removed: 0, unchanged: 0 };
}

function addStats(target: MergeCollectionStats, source: MergeCollectionStats): void {
  target.added += source.added;
  target.updated += source.updated;
  target.removed += source.removed;
  target.unchanged += source.unchanged;
}

/**
 * 稳定序列化：对对象键排序后展开，保证"内容相同"必然得到"字符串相同"。
 *
 * 仅用于同标识冲突的兜底裁决，不参与正常路径。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

interface Winner<T> {
  value: T;
  winner: "local" | "remote" | "identical";
}

/**
 * 同标识冲突的确定性裁决。
 *
 * 先比修订号（调用方给出的时间戳或内容修订号），不同则大者胜；
 * 修订号缺失或相等时退回内容字典序，使裁决结果与参数顺序无关。
 */
function chooseWinner<T>(
  local: T,
  remote: T,
  revisionOf?: (item: T) => number | undefined,
): Winner<T> {
  const localRevision = revisionOf?.(local);
  const remoteRevision = revisionOf?.(remote);
  if (
    localRevision !== undefined
    && remoteRevision !== undefined
    && Number.isFinite(localRevision)
    && Number.isFinite(remoteRevision)
    && localRevision !== remoteRevision
  ) {
    return localRevision > remoteRevision
      ? { value: local, winner: "local" }
      : { value: remote, winner: "remote" };
  }
  const localText = stableStringify(local);
  const remoteText = stableStringify(remote);
  if (localText === remoteText) return { value: local, winner: "identical" };
  return localText > remoteText
    ? { value: local, winner: "local" }
    : { value: remote, winner: "remote" };
}

/** 按稳定标识对两个集合求并集，同标识冲突交给 chooseWinner 裁决。 */
function mergeCollection<T>(
  local: readonly T[],
  remote: readonly T[],
  keyOf: (item: T) => string,
  revisionOf?: (item: T) => number | undefined,
): { items: T[]; stats: MergeCollectionStats } {
  const localByKey = new Map<string, T>();
  for (const item of local) localByKey.set(keyOf(item), item);
  const remoteByKey = new Map<string, T>();
  for (const item of remote) remoteByKey.set(keyOf(item), item);

  const items: T[] = [];
  const stats = emptyStats();
  for (const [key, localItem] of localByKey) {
    const remoteItem = remoteByKey.get(key);
    if (remoteItem === undefined) {
      items.push(localItem);
      stats.unchanged += 1;
      continue;
    }
    const { value, winner } = chooseWinner(localItem, remoteItem, revisionOf);
    items.push(value);
    if (winner === "remote") stats.updated += 1;
    else stats.unchanged += 1;
  }
  for (const [key, remoteItem] of remoteByKey) {
    if (localByKey.has(key)) continue;
    items.push(remoteItem);
    stats.added += 1;
  }
  return { items, stats };
}

/**
 * 合并同一会话内的消息集合。
 *
 * 消息是追加型数据，两侧独有的消息都要保留，因此按 id 求并集；
 * 同一 id 被编辑过时按 `timestamp` 后写者生效。
 */
function mergeSessionMessages(
  local: readonly Message[],
  remote: readonly Message[],
): { messages: Message[]; stats: MergeCollectionStats } {
  const { items, stats } = mergeCollection(
    local,
    remote,
    (message) => message.id,
    (message) => message.timestamp,
  );
  // 两台设备各自追加消息时会分配相同的 turnIndex，直接沿用会破坏"绝对顺序"语义。
  // 合并后按 (timestamp, id) 重排并重新编号，保证结果与输入顺序无关。
  const ordered = [...items].sort((left, right) => {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return {
    messages: ordered.map((message, index) => ({ ...message, turnIndex: index })),
    stats,
  };
}

/**
 * 计算合并后的会话元数据。
 *
 * 目录字段（updatedAt / contentRevision）取两侧较大值：合并只会让内容变多，
 * 不应把活动时间或修订号回退，这是双向同步能收敛的前提。
 * 统计字段按合并后的消息集合重算，避免沿用单侧遗留的过期计数。
 *
 * 不写 sessions Store 的内部计数基线（messageCount / userMessageCount）：
 * 它们不属于会话领域模型，缺少时存储层会自行按权威消息重算。
 */
function mergeSessionMetadata(
  local: ChatSession,
  remote: ChatSession,
  messages: Message[],
  mergedSummaries: ChatSession["summaries"],
): { session: ChatSession; resolution: "local" | "remote" | "identical" } {
  const { value: base, winner } = chooseWinner(
    local,
    remote,
    (session) => session.updatedAt ?? session.createdAt,
  );
  const stats = calculateSessionMessageStats(messages);
  const preview = messages.at(-1)?.content?.replace(/\s+/g, " ").trim();
  return {
    session: {
      ...base,
      messages,
      summaries: mergedSummaries,
      turnCount: stats.turnCount,
      charCount: stats.charCount,
      updatedAt: Math.max(
        local.updatedAt ?? local.createdAt,
        remote.updatedAt ?? remote.createdAt,
      ),
      contentRevision: Math.max(local.contentRevision ?? 1, remote.contentRevision ?? 1),
      ...(preview === undefined ? {} : { lastMessagePreview: preview.slice(0, 160) }),
    },
    resolution: winner,
  };
}

/** 会话内的摘要卡片按 id 求并集；摘要没有独立时间戳，冲突交给稳定序列化裁决。 */
function mergeSummaries(
  local: ChatSession["summaries"],
  remote: ChatSession["summaries"],
): ChatSession["summaries"] {
  return mergeCollection(
    local ?? [],
    remote ?? [],
    (summary) => summary.id,
  ).items;
}

/**
 * 合并两份统一备份信封。
 *
 * 输出为纯数据计划，不产生任何副作用；调用方在用户确认后再落库。
 */
export function mergeBackupPayloads(input: BackupMergeInput): BackupMergePlan {
  const { local, remote } = input;

  // 1. 墓碑：两侧删除事实求并集。同一实体的多条墓碑保留较晚的一条。
  const tombstoneByKey = new Map<string, SyncTombstone>();
  for (const tombstone of dedupeSyncTombstones([
    ...(local.tombstones ?? []),
    ...(remote.tombstones ?? []),
  ])) {
    tombstoneByKey.set(syncTombstoneKey(tombstone.entity, tombstone.targetId), tombstone);
  }

  // 复活剔除：墓碑之后又被重新写入的实体，其墓碑不再生效。
  // 若不剔除，本地刚恢复的记录会在下次同步时被对端重新删掉。
  const revive = (entity: SyncTombstone["entity"], targetId: string, recordUpdatedAt: number | undefined) => {
    const key = syncTombstoneKey(entity, targetId);
    const tombstone = tombstoneByKey.get(key);
    if (!tombstone) return;
    if (isTombstoneEffective(tombstone, recordUpdatedAt)) return;
    tombstoneByKey.delete(key);
  };

  const localSessions = new Map((local.sessions ?? []).map((session) => [session.id, session]));
  const remoteSessions = new Map((remote.sessions ?? []).map((session) => [session.id, session]));

  const sessionStats = emptyStats();
  const messageStats = emptyStats();
  const conflicts: SessionMergeConflict[] = [];
  const mergedSessions: ChatSession[] = [];

  /**
   * 单侧独有的会话整体并入。
   *
   * 与"两侧都有"的会话走同一套处理：消息照样接受墓碑过滤并重排轮次。
   * 否则"本地有、对端没有"与"对端有、本地没有"两种情形会因为重排与否产生差异，
   * 直接破坏"交换参数后结果相同"的收敛性。
   */
  const adoptSingleSideSession = (session: ChatSession): ChatSession => {
    const keptMessages: Message[] = [];
    for (const message of session.messages ?? []) {
      revive("message", message.id, message.timestamp);
      const messageTombstone = tombstoneByKey.get(syncTombstoneKey("message", message.id));
      if (messageTombstone && isTombstoneEffective(messageTombstone, message.timestamp)) {
        messageStats.removed += 1;
        continue;
      }
      keptMessages.push(message);
    }
    return {
      ...session,
      messages: keptMessages.map((message, index) => ({ ...message, turnIndex: index })),
    };
  };

  // 2. 会话：先按 id 求并集，再对每个存活会话合并消息与元数据。
  for (const [sessionId, localSession] of localSessions) {
    const remoteSession = remoteSessions.get(sessionId);

    if (!remoteSession) {
      const tombstone = tombstoneByKey.get(syncTombstoneKey("session", sessionId));
      // 会话在另一端已被删除且本地记录不晚于删除时间：接受删除，不再保留。
      if (tombstone && isTombstoneEffective(tombstone, localSession.updatedAt ?? localSession.createdAt)) {
        sessionStats.removed += 1;
        continue;
      }
      revive("session", sessionId, localSession.updatedAt ?? localSession.createdAt);
      mergedSessions.push(adoptSingleSideSession(localSession));
      sessionStats.unchanged += 1;
      continue;
    }

    const summaryMerged = mergeSummaries(localSession.summaries, remoteSession.summaries);
    const { messages, stats } = mergeSessionMessages(
      localSession.messages ?? [],
      remoteSession.messages ?? [],
    );

    // 消息级墓碑：消息被删除后不应因为对端还留着而复活。
    const survivingMessages: Message[] = [];
    for (const message of messages) {
      revive("message", message.id, message.timestamp);
      const tombstone = tombstoneByKey.get(syncTombstoneKey("message", message.id));
      if (tombstone && isTombstoneEffective(tombstone, message.timestamp)) {
        messageStats.removed += 1;
        continue;
      }
      survivingMessages.push(message);
    }
    // 删除会改变绝对顺序，重排一次保证 turnIndex 连续。
    const renumbered = survivingMessages.map((message, index) => ({ ...message, turnIndex: index }));

    const { session, resolution } = mergeSessionMetadata(
      localSession,
      remoteSession,
      renumbered,
      summaryMerged,
    );
    mergedSessions.push(session);
    addStats(messageStats, stats);
    if (resolution === "remote") sessionStats.updated += 1;
    else sessionStats.unchanged += 1;
    if (resolution !== "identical") {
      conflicts.push({
        sessionId,
        title: session.title,
        localUpdatedAt: localSession.updatedAt ?? localSession.createdAt,
        remoteUpdatedAt: remoteSession.updatedAt ?? remoteSession.createdAt,
        resolution,
      });
    }
  }

  for (const [sessionId, remoteSession] of remoteSessions) {
    if (localSessions.has(sessionId)) continue;
    const tombstone = tombstoneByKey.get(syncTombstoneKey("session", sessionId));
    if (tombstone && isTombstoneEffective(tombstone, remoteSession.updatedAt ?? remoteSession.createdAt)) {
      sessionStats.removed += 1;
      continue;
    }
    revive("session", sessionId, remoteSession.updatedAt ?? remoteSession.createdAt);
    const adopted = adoptSingleSideSession(remoteSession);
    mergedSessions.push(adopted);
    sessionStats.added += 1;
    // added 语义统一为"本地从对端新获得的消息数"，与双侧都有时的统计口径一致。
    messageStats.added += adopted.messages.length;
  }

  // 3. 其余集合：按稳定标识求并集，有修订号的按修订号裁决。
  const characters = mergeCollection(
    local.characters ?? [],
    remote.characters ?? [],
    (character) => character.id,
  );
  const memoryDictEntries = mergeCollection(
    local.memoryDictEntries ?? [],
    remote.memoryDictEntries ?? [],
    (entry) => entry.id,
  );
  const memoryFragments = mergeCollection(
    local.memoryFragments ?? [],
    remote.memoryFragments ?? [],
    (fragment) => fragment.id,
    (fragment) => fragment.updatedAt ?? fragment.createdAt,
  );
  const memoryFacts = mergeCollection(
    local.memoryFacts ?? [],
    remote.memoryFacts ?? [],
    (fact) => fact.id,
    (fact) => fact.updatedAt ?? fact.createdAt,
  );
  const globalLorebook = mergeCollection(
    local.globalLorebook ?? [],
    remote.globalLorebook ?? [],
    (entry) => entry.id,
  );
  const savedPresets = mergeCollection(
    local.savedPresets ?? [],
    remote.savedPresets ?? [],
    (preset) => preset.id,
  );
  const attachments = mergeCollection(
    local.attachments ?? [],
    remote.attachments ?? [],
    (record) => record.id,
    (record) => record.updatedAt,
  );
  const agentJournal = mergeCollection(
    local.agentJournal ?? [],
    remote.agentJournal ?? [],
    (event) => event.id,
    (event) => event.createdAt,
  );
  const customWorldbooks = mergeCollection(
    Object.values(local.customWorldbooks ?? {}),
    Object.values(remote.customWorldbooks ?? {}),
    (worldbook) => worldbook.id,
  );

  // 4. 清理孤儿派生数据。会话被墓碑删除后，其记忆分轨与 Agent Journal 事件不能继续留在信封里：
  //    宿主导入会校验"事件必须指向存在的会话"，残留孤儿会让整次同步被直接拒绝。
  //    同时会话已整体删除时，其消息墓碑也不再承载额外信息。
  const liveSessionIds = new Set(mergedSessions.map((session) => session.id));
  const belongsToLiveSession = <T extends { sessionId: string }>(item: T) =>
    liveSessionIds.has(item.sessionId);
  const finalTombstones = Array.from(tombstoneByKey.values()).filter(
    (tombstone) => tombstone.entity === "session" || liveSessionIds.has(tombstone.sessionId),
  );

  const merged = buildUnifiedBackupPayload({
    characters: characters.items,
    sessions: mergedSessions,
    memoryDictEntries: memoryDictEntries.items.filter(belongsToLiveSession),
    memoryFragments: memoryFragments.items.filter(belongsToLiveSession),
    memoryFacts: memoryFacts.items.filter(belongsToLiveSession),
    settings: local.settings,
    savedPresets: savedPresets.items,
    globalLorebook: globalLorebook.items,
    customWorldbooks: Object.fromEntries(
      customWorldbooks.items.map((worldbook) => [worldbook.id, worldbook]),
    ),
    attachments: attachments.items,
    agentJournal: agentJournal.items.filter(belongsToLiveSession),
    tombstones: finalTombstones,
    backupDate: [local.backupDate, remote.backupDate].filter(Boolean).sort().at(-1)
      ?? new Date().toISOString(),
    isEncrypted: false,
  });

  return {
    merged,
    stats: {
      characters: characters.stats,
      sessions: sessionStats,
      messages: messageStats,
      memoryDictEntries: memoryDictEntries.stats,
      memoryFragments: memoryFragments.stats,
      memoryFacts: memoryFacts.stats,
      globalLorebook: globalLorebook.stats,
      customWorldbooks: customWorldbooks.stats,
      savedPresets: savedPresets.stats,
      attachments: attachments.stats,
      agentJournal: agentJournal.stats,
      tombstones: {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: finalTombstones.length,
      },
    },
    conflicts,
    localSummary: summarizeBackupPayload(local),
    remoteSummary: summarizeBackupPayload(remote),
    mergedSummary: summarizeBackupPayload(merged),
  };
}
