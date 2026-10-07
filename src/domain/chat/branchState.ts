/**
 * 会话分支（平行宇宙）的状态回退与长期记忆携带语义。
 *
 * 用户钦定的语义（2026-10-07）：
 *   - **完全回退到分叉节点**：消息前缀、摘要、MVU 变量、状态表、词典等卡内状态
 *     都必须回到该节点当时的形态；
 *   - **不回退外部长期记忆**：事件片段 / 时态事实等长期记忆属于会话外部的用户资产，
 *     分叉时原样带入新分支（此后两条分支各自独立演进）。
 *
 * 本模块只负责纯数据变换（ID 重映射），I/O 与快照选择留在 DatabaseService。
 */
import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../../application/services/memory/types";

export interface BranchMemorySnapshot {
  readonly dictEntries: MemoryDictEntry[];
  readonly fragments: MemoryFragment[];
  readonly facts: TemporalFact[];
}

export interface BranchMemoryCarryOverInput {
  readonly sourceSessionId: string;
  readonly branchSessionId: string;
  /** 源会话消息 ID → 分支内新消息 ID（仅包含被复制的前缀消息）。 */
  readonly messageIdMap: ReadonlyMap<string, string>;
  /** 稳定 ID 生成器，便于测试注入；默认使用 crypto.randomUUID。 */
  readonly createId?: () => string;
}

/** 记忆 ID 默认生成器。 */
function defaultCreateId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 重映射会话内消息 ID。
 *
 * 只映射分支前缀里真实存在的消息；指向分叉点之后（当前时间线之外）的来源保持原样，
 * 因为长期记忆本来就不回退——这些引用属于"外部记忆"的原始出处，指向另一条时间线。
 */
export function remapBranchMessageIds(
  ids: readonly string[] | undefined,
  messageIdMap: ReadonlyMap<string, string>,
): string[] | undefined {
  if (!ids || ids.length === 0) return ids ? [...ids] : undefined;
  return ids.map((id) => messageIdMap.get(id) ?? id);
}

/** 把源会话当前的长期记忆整体带入新分支，生成新的主键与来源映射。 */
export function carryOverBranchMemory(
  memory: BranchMemorySnapshot,
  input: BranchMemoryCarryOverInput,
): BranchMemorySnapshot {
  const createId = input.createId ?? defaultCreateId;
  const fragmentIdMap = new Map(
    memory.fragments.map((fragment) => [
      fragment.id,
      `${input.branchSessionId}_fragment_${createId()}`,
    ]),
  );
  const factIdMap = new Map(
    memory.facts.map((fact) => [
      fact.id,
      `${input.branchSessionId}_fact_${createId()}`,
    ]),
  );

  return {
    dictEntries: memory.dictEntries.map((entry) => ({
      ...structuredClone(entry),
      // 词典主键是 `${sessionId}:${entity}` 复合键，必须跟着会话走。
      id: `${input.branchSessionId}:${entry.entity}`,
      sessionId: input.branchSessionId,
      firstSeenMsgId: input.messageIdMap.get(entry.firstSeenMsgId) ?? entry.firstSeenMsgId,
    })),
    fragments: memory.fragments.map((fragment) => ({
      ...structuredClone(fragment),
      id: fragmentIdMap.get(fragment.id) as string,
      sessionId: input.branchSessionId,
      sourceMessageIds: remapBranchMessageIds(fragment.sourceMessageIds, input.messageIdMap) ?? [],
      supersedesId: fragment.supersedesId ? fragmentIdMap.get(fragment.supersedesId) : undefined,
      supersededById: fragment.supersededById
        ? fragmentIdMap.get(fragment.supersededById)
        : undefined,
    })),
    facts: memory.facts.map((fact) => ({
      ...structuredClone(fact),
      id: factIdMap.get(fact.id) as string,
      sessionId: input.branchSessionId,
      sourceMessageId: input.messageIdMap.get(fact.sourceMessageId) ?? fact.sourceMessageId,
      supersedesId: fact.supersedesId ? factIdMap.get(fact.supersedesId) : undefined,
      supersededById: fact.supersededById ? factIdMap.get(fact.supersededById) : undefined,
    })),
  };
}
