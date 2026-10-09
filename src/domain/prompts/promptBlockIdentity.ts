import type { CustomPromptBlock } from "../../types";

/**
 * 提示词区块身份归一：保证每个条目都有唯一的 `id`。
 *
 * 列表与编排的同步键是「列表侧 `identifier || id`、区块侧
 * `compatibility.originalIdentifier`」，而按 key 的改名/开关/删除会命中**所有**同键条目。
 * SillyTavern 预设里复制条目会带出重复 identifier，导入时原样保留，于是出现
 * "改一条名字、另一条跟着变"的联动 bug。这里在边界处给缺失或冲突的条目补上
 * **确定性** id（同一输入稳定，重复归一结果不变，避免脏检查抖动），
 * 同时完整保留 `identifier` 作为兼容别名（导出/往返仍按 ST 原值走）。
 */
export function ensureUniquePromptBlockIds<T extends CustomPromptBlock>(
  blocks: readonly T[],
): T[] {
  const used = new Set<string>();
  let changed = false;
  const next = blocks.map((block, index) => {
    const existingId = typeof block.id === "string" ? block.id.trim() : "";
    const identifier = typeof block.identifier === "string" ? block.identifier.trim() : "";
    const preferred = existingId || identifier || `comp_${index + 1}`;
    const unique = claimUniqueId(preferred, used);
    // 已有唯一 id 的条目必须原对象返回：调用方用它判断"这次归一是否产生写入"。
    if (existingId === unique) return block;
    changed = true;
    return { ...block, id: unique };
  });
  return changed ? next : [...blocks];
}

/**
 * 列表侧身份判定：有 `id` 就只按 `id` 命中，没有 `id` 的历史条目回落到 `identifier`。
 *
 * 混用两者会让"同 identifier 的兄弟条目"被一并改写（SillyTavern 复制条目会带出重复 identifier）。
 */
export function matchesPromptBlockId(block: CustomPromptBlock, id: string): boolean {
  return block.id ? block.id === id : Boolean(block.identifier) && block.identifier === id;
}

/** 列表侧开关：只命中目标条目；未命中或状态未变化时返回原数组。 */
export function setPromptBlockEnabledById(
  blocks: readonly CustomPromptBlock[],
  id: string,
  enabled: boolean,
): CustomPromptBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (!matchesPromptBlockId(block, id) || block.enabled === enabled) return block;
    changed = true;
    // 老条目第一次被操作时补上唯一 id，后续操作即可稳定按 id 命中。
    return { ...block, id: block.id || id, enabled };
  });
  return changed ? next : (blocks as CustomPromptBlock[]);
}

/** 列表侧删除：按同一身份口径移除；未命中时返回原数组。 */
export function removePromptBlocksByIds(
  blocks: readonly CustomPromptBlock[],
  ids: readonly string[],
): CustomPromptBlock[] {
  const next = blocks.filter((block) => !ids.some((id) => matchesPromptBlockId(block, id)));
  return next.length === blocks.length ? (blocks as CustomPromptBlock[]) : next;
}

function claimUniqueId(preferred: string, used: Set<string>): string {
  let candidate = preferred;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
