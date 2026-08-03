import type { PromptBlock, PromptComposition } from "../../domain/prompt-composition";

export type PromptBlockGroupMode = "none" | "role" | "source" | "placement";
export type PromptBlockSortMode = "order" | "tokens";

export interface PromptBlockListItem {
  block: PromptBlock;
  index: number;
  estimatedTokens: number;
}

export interface PromptBlockListGroup {
  key: string;
  items: PromptBlockListItem[];
}

export function buildPromptBlockListGroups(params: {
  blocks: PromptBlock[];
  query: string;
  groupMode: PromptBlockGroupMode;
  sortMode: PromptBlockSortMode;
  tokenByBlockId: ReadonlyMap<string, number>;
}): PromptBlockListGroup[] {
  const normalizedQuery = params.query.trim().toLocaleLowerCase();
  const items = params.blocks.flatMap((block, index): PromptBlockListItem[] => {
    if (normalizedQuery && !getSearchText(block).includes(normalizedQuery)) return [];
    return [{ block, index, estimatedTokens: params.tokenByBlockId.get(block.id) ?? 0 }];
  });
  if (params.sortMode === "tokens") {
    items.sort((left, right) => right.estimatedTokens - left.estimatedTokens || left.index - right.index);
  }
  const groups = new Map<string, PromptBlockListItem[]>();
  for (const item of items) {
    const key = getGroupKey(item.block, params.groupMode);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => groupOrder(left, params.groupMode) - groupOrder(right, params.groupMode) || left.localeCompare(right))
    .map(([key, groupItems]) => ({ key, items: groupItems }));
}

export function patchSelectedBlockStates(
  composition: PromptComposition,
  selectedIds: ReadonlySet<string>,
  enabled: boolean,
): PromptComposition {
  return {
    ...composition,
    blocks: composition.blocks.map((block) => selectedIds.has(block.id) ? { ...block, enabled } : block),
  };
}

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

/** 无实时 trace 时使用与 PromptService 一致的保守字符估算。 */
export function estimatePromptBlockTokens(block: PromptBlock): number {
  if (block.source.type === "chat_history" || !block.template) return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (const character of block.template) {
    if (character.charCodeAt(0) <= 127) ascii++; else nonAscii++;
  }
  return Math.ceil(ascii * 0.25 + nonAscii * 2);
}

function getSearchText(block: PromptBlock): string {
  return [
    block.id,
    block.name,
    block.role,
    block.source.type,
    block.template,
    block.compatibility?.source,
    block.compatibility?.originalIdentifier,
  ].filter(Boolean).join("\n").toLocaleLowerCase();
}

function getGroupKey(block: PromptBlock, mode: PromptBlockGroupMode): string {
  if (mode === "role") return block.source.type === "chat_history" ? "history" : block.role;
  if (mode === "source") return block.compatibility?.source ?? block.source.type;
  if (mode === "placement") return block.placement.type;
  return "all";
}

function groupOrder(key: string, mode: PromptBlockGroupMode): number {
  if (mode === "role") return ["system", "user", "assistant", "history"].indexOf(key) + 1 || 99;
  if (mode === "source") return ["template", "chat_history"].indexOf(key) + 1 || 99;
  if (mode === "placement") return ["ordered", "in_chat"].indexOf(key) + 1 || 99;
  return 1;
}
