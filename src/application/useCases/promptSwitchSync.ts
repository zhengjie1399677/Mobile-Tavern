import type { CustomPromptBlock, PromptConfig } from "../../types";
import type { PromptBlock, PromptComposition } from "../../domain/prompt-composition";
import { removePromptBlocks } from "../../domain/prompt-composition";

/**
 * 提示词列表（`customPrompts`）与自由编排区块（`composition.blocks`）的子条目同步。
 *
 * 两套模型是同一批条目的两种视图：列表是传统模式下的扁平列表，编排是带顺序与注入位置的区块。
 * 用户在任一视图里增删条目或开关子条目，另一侧都必须同时一致，并且对运行时真正生效，
 * 否则会出现"列表已关闭但请求仍带着它""列表删了但编排还在发""编排关了列表还显示开启"的困惑。
 *
 * 对应键：列表侧 `identifier || id`，编排侧 `compatibility.originalIdentifier`。
 * 开关只同步 `enabled`；删除是双向连带的（见 `removeCompositionBlocks` / `applyLegacyPromptRemoval`）。
 */

/**
 * 编排编辑器撤销栈记录的快照。
 *
 * 删除会同时改动编排与列表，因此撤销栈必须一起记住列表——只记编排的话，
 * 撤销后区块回来了、列表条目却回不来，两侧又变成不一致。
 */
export interface PromptSwitchSnapshot {
  composition: PromptComposition;
  customPrompts: CustomPromptBlock[];
}

/** 列表侧条目的同步键。 */
export function legacyPromptSwitchKey(prompt: CustomPromptBlock): string {
  return prompt.identifier || prompt.id;
}

function blockSwitchKey(block: PromptBlock): string | undefined {
  return block.compatibility?.originalIdentifier;
}

function matchesKey(blockKey: string | undefined, legacyKey: string): boolean {
  return Boolean(blockKey) && blockKey === legacyKey;
}

/**
 * 把目标状态写到列表里所有命中 `keys` 的条目上。
 * 没有任何条目命中时返回原数组（便于调用方判定"这次同步不产生写入"）。
 */
function applyEnabledToLegacyPrompts(
  list: CustomPromptBlock[],
  keys: readonly string[],
  enabled: boolean,
): CustomPromptBlock[] {
  let changed = false;
  const next = list.map((prompt) => {
    if (!keys.includes(legacyPromptSwitchKey(prompt)) || prompt.enabled === enabled) return prompt;
    changed = true;
    return { ...prompt, enabled };
  });
  return changed ? next : list;
}

/** 取出指定区块里可用于回写列表的同步键。 */
function collectSwitchKeys(composition: PromptComposition, blockIds: readonly string[]): string[] {
  const targets = new Set(blockIds);
  const keys: string[] = [];
  for (const block of composition.blocks) {
    if (!targets.has(block.id)) continue;
    const key = blockSwitchKey(block);
    if (key !== undefined && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * 列表侧开关：改 `customPrompts`，并同步同源编排区块（无对应区块时为无操作）。
 * 同步不依赖"编排是否已启用"：这样先改列表再启用编排也能保持一致。
 */
export function applyLegacyPromptSwitch(
  promptConfig: PromptConfig,
  promptId: string,
  enabled: boolean,
): PromptConfig {
  const list = promptConfig.customPrompts ?? [];
  const target = list.find((prompt) => prompt.id === promptId);
  if (!target) return promptConfig;

  const composition = promptConfig.composition;
  const key = legacyPromptSwitchKey(target);
  if (!composition || !composition.blocks.some((block) => matchesKey(blockSwitchKey(block), key))) {
    return {
      ...promptConfig,
      customPrompts: list.map((prompt) => (prompt.id === promptId ? { ...prompt, enabled } : prompt)),
    };
  }

  let blockChanged = false;
  const blocks = composition.blocks.map((block) => {
    if (!matchesKey(blockSwitchKey(block), key) || block.enabled === enabled) return block;
    blockChanged = true;
    return { ...block, enabled };
  });

  return {
    ...promptConfig,
    customPrompts: list.map((prompt) => (prompt.id === promptId ? { ...prompt, enabled } : prompt)),
    ...(blockChanged ? { composition: { ...composition, blocks } } : {}),
  };
}

/**
 * 编排写入时的列表开关同步（供编排编辑器的撤销栈调用）。
 *
 * 只处理"前后两次编排之间**仅有开关状态**发生变化"的情况：这类变化回写列表是安全且必要的，
 * 而且撤销/重做也能自然带回列表状态。新增、复制、排序、改模板、导入模板等结构变更一律不走这里
 * ——复制区块会带出重复的 `originalIdentifier`，用当时那版状态去覆盖列表会误改无关条目；
 * 删除则走 `removeCompositionBlocks` 的显式连带删除。
 */
export function syncCustomPromptSwitches(
  customPrompts: CustomPromptBlock[],
  previous: PromptComposition | undefined,
  next: PromptComposition,
): CustomPromptBlock[] {
  if (previous === undefined || previous === next) return customPrompts;
  const toggled = collectPureSwitchChanges(previous, next);
  if (!toggled) return customPrompts;
  const keys = collectSwitchKeys(next, toggled.ids);
  if (keys.length === 0) return customPrompts;
  return applyEnabledToLegacyPrompts(customPrompts, keys, toggled.enabled);
}

/**
 * 删除编排区块：同源的列表条目一并删除。
 *
 * 与"开关同步"不同，删除是**连带**的：只把列表条目留着，它在编排模式下既不生效、
 * 又和已被删掉的区块对不上。区块删除与场景方案清理复用领域层的 `removePromptBlocks`，
 * 保证两个删除方向（编排删区块 / 列表删条目）用同一套清理规则。
 */
export function removeCompositionBlocks(
  snapshot: PromptSwitchSnapshot,
  blockIds: readonly string[],
): PromptSwitchSnapshot {
  if (blockIds.length === 0) return snapshot;
  const targets = new Set(blockIds);
  const missing = !snapshot.composition.blocks.some((block) => targets.has(block.id));
  const keys = collectSwitchKeys(snapshot.composition, blockIds);
  const nextCustomPrompts = applyRemovalToLegacyPrompts(snapshot.customPrompts, keys);
  if (missing && nextCustomPrompts === snapshot.customPrompts) return snapshot;
  return {
    composition: removePromptBlocks(snapshot.composition, targets),
    customPrompts: nextCustomPrompts,
  };
}

/**
 * 删除列表条目：同源的编排区块一并删除。
 *
 * 列表侧没有撤销栈，删除即最终结果；编排侧的可撤销性由编辑器自己的快照栈提供，不受此处影响。
 * 名称不是 customPrompts 条目的选中项（例如界面上的内置主指令伪条目）不参与删除，保持原样。
 */
export function applyLegacyPromptRemoval(
  promptConfig: PromptConfig,
  promptIds: readonly string[],
): PromptConfig {
  const list = promptConfig.customPrompts ?? [];
  const targets = new Set(promptIds);
  const removed = list.filter((prompt) => targets.has(prompt.id));
  if (removed.length === 0) return promptConfig;

  const keys = new Set(removed.map(legacyPromptSwitchKey));
  const composition = promptConfig.composition;
  const removableBlockIds = new Set(
    (composition?.blocks ?? [])
      .filter((block) => {
        const key = blockSwitchKey(block);
        return key !== undefined && keys.has(key);
      })
      .map((block) => block.id),
  );

  return {
    ...promptConfig,
    customPrompts: list.filter((prompt) => !targets.has(prompt.id)),
    ...(composition && removableBlockIds.size > 0
      ? { composition: removePromptBlocks(composition, removableBlockIds) }
      : {}),
  };
}

/** 按同步键从列表里剔除条目；没有命中时返回原数组。 */
function applyRemovalToLegacyPrompts(
  list: CustomPromptBlock[],
  keys: readonly string[],
): CustomPromptBlock[] {
  if (keys.length === 0) return list;
  const next = list.filter((prompt) => !keys.includes(legacyPromptSwitchKey(prompt)));
  return next.length === list.length ? list : next;
}

/**
 * 识别"仅开关变化"。返回同一方向上有变化的区块 id 与目标状态；
 * 任何一处非开关字段变化、区块增删、或方向不一致（同时开又关）都返回 null，交由调用方原样写入。
 */
function collectPureSwitchChanges(
  previous: PromptComposition,
  next: PromptComposition,
): { ids: string[]; enabled: boolean } | null {
  if (previous.blocks.length !== next.blocks.length) return null;
  const previousById = new Map(previous.blocks.map((block) => [block.id, block]));
  const ids: string[] = [];
  let enabled: boolean | undefined;
  for (const block of next.blocks) {
    const before = previousById.get(block.id);
    if (!before) return null;
    if (compareWithoutEnabled(before) !== compareWithoutEnabled(block)) return null;
    if (before.enabled === block.enabled) continue;
    if (enabled === undefined) enabled = block.enabled;
    else if (enabled !== block.enabled) return null;
    ids.push(block.id);
  }
  return enabled === undefined ? null : { ids, enabled };
}

/** 除 `enabled` 之外完全相同的区块才允许参与开关同步，避免把内容修改当成开关变化。 */
function compareWithoutEnabled(block: PromptBlock): string {
  return JSON.stringify({ ...block, enabled: null });
}

/**
 * 整体镜像，用于切换编排模式时把"旧视图"的开关状态带进即将生效的视图。
 *
 * - `to-composition`：以列表为准，把 `customPrompts` 的开关写进同源区块（即将启用编排）；
 * - `to-legacy`：以编排为准，把区块开关写回同源列表条目（即将回到传统模式）。
 *
 * 无变化时返回原对象，避免触发无谓的设置写入。
 */
export function mirrorPromptSwitches(
  promptConfig: PromptConfig,
  direction: "to-composition" | "to-legacy",
): PromptConfig {
  const composition = promptConfig.composition;
  const list = promptConfig.customPrompts ?? [];
  if (!composition || list.length === 0) return promptConfig;

  if (direction === "to-composition") {
    const enabledByKey = new Map(list.map((prompt) => [legacyPromptSwitchKey(prompt), prompt.enabled]));
    let changed = false;
    const blocks = composition.blocks.map((block) => {
      const key = blockSwitchKey(block);
      if (key === undefined || !enabledByKey.has(key)) return block;
      const enabled = enabledByKey.get(key) as boolean;
      if (enabled === block.enabled) return block;
      changed = true;
      return { ...block, enabled };
    });
    return changed ? { ...promptConfig, composition: { ...composition, blocks } } : promptConfig;
  }

  const enabledByKey = new Map<string, boolean>();
  for (const block of composition.blocks) {
    const key = blockSwitchKey(block);
    if (key !== undefined) enabledByKey.set(key, block.enabled);
  }
  if (!list.some((prompt) => enabledByKey.has(legacyPromptSwitchKey(prompt)))) return promptConfig;
  let changed = false;
  const nextList = list.map((prompt) => {
    const key = legacyPromptSwitchKey(prompt);
    if (!enabledByKey.has(key)) return prompt;
    const enabled = enabledByKey.get(key) as boolean;
    if (enabled === prompt.enabled) return prompt;
    changed = true;
    return { ...prompt, enabled };
  });
  return changed ? { ...promptConfig, customPrompts: nextList } : promptConfig;
}
