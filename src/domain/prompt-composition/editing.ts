import type { PromptComposition } from "./types";

/**
 * 编排编辑操作（纯函数，无 IO）。
 *
 * 这些操作同时出现在两处调用方：编排编辑器自身，以及"提示词列表删除条目"时对同源区块的连带删除。
 * 放在领域层是为了让两种删除方向共用同一套清理规则——尤其是场景方案的 `blockStates`，
 * 留下已不存在区块的键会让 `applyPromptSceneProfile` 报出 `SCENE_PROFILE_UNKNOWN_BLOCK` 警告。
 */

/** 删除区块，并清理场景方案里对它们的开关覆盖。 */
export function removePromptBlocks(
  composition: PromptComposition,
  removedIds: ReadonlySet<string>,
): PromptComposition {
  return {
    ...composition,
    blocks: composition.blocks.filter((block) => !removedIds.has(block.id)),
    sceneProfiles: composition.sceneProfiles?.map((profile) => ({
      ...profile,
      blockStates: Object.fromEntries(
        Object.entries(profile.blockStates).filter(([blockId]) => !removedIds.has(blockId)),
      ),
    })),
  };
}
