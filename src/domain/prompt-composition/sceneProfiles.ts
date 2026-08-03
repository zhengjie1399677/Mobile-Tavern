import type { PromptComposition, PromptCompositionDiagnostic, PromptSceneProfile } from "./types";

export interface PromptSceneProfileResolution {
  composition: PromptComposition;
  profile?: PromptSceneProfile;
  diagnostics: PromptCompositionDiagnostic[];
}

/** 将会话选择的场景方案作为基础编排之上的开关覆盖层。 */
export function applyPromptSceneProfile(
  composition: PromptComposition,
  profileId: string | undefined,
): PromptSceneProfileResolution {
  if (!profileId) return { composition, diagnostics: [] };
  const profile = composition.sceneProfiles?.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return {
      composition,
      diagnostics: [{
        level: "warning",
        code: "MISSING_SCENE_PROFILE",
        message: `当前会话选择的场景方案不存在，已使用基础编排：${profileId}`,
        detail: profileId,
      }],
    };
  }
  const knownIds = new Set(composition.blocks.map((block) => block.id));
  const unknownIds = Object.keys(profile.blockStates).filter((blockId) => !knownIds.has(blockId));
  const diagnostics: PromptCompositionDiagnostic[] = unknownIds.length > 0
    ? [{
        level: "warning",
        code: "SCENE_PROFILE_UNKNOWN_BLOCK",
        message: `场景方案“${profile.name}”引用了 ${unknownIds.length} 个已不存在的区块。`,
        detail: unknownIds.join(","),
      }]
    : [];
  return {
    composition: {
      ...composition,
      blocks: composition.blocks.map((block) => Object.prototype.hasOwnProperty.call(profile.blockStates, block.id)
        ? { ...block, enabled: profile.blockStates[block.id] }
        : block),
    },
    profile,
    diagnostics,
  };
}

export function createPromptSceneProfile(
  name: string,
  composition: PromptComposition,
  id = `scene-${Date.now().toString(36)}`,
): PromptSceneProfile {
  return {
    id,
    name: name.trim().slice(0, 120),
    blockStates: Object.fromEntries(composition.blocks.map((block) => [block.id, block.enabled])),
  };
}
