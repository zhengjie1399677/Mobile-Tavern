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
