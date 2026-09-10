import type { CustomPromptBlock } from "../../types";

/**
 * 预设出厂内容迁移的边界收口。
 *
 * 启动迁移只能作用于内置预设：自定义预设（尤其是导入的第三方预设）必须原样保留，
 * 否则系统代码会把本应用的行为引导区块注入用户预设，违反 `COMPAT-DATA` 的纯底层原则。
 * 本文件同时作为该契约的可测试入口。
 */

export interface PresetPromptMigrationInput {
  /** 当前生效设置里的提示词区块。 */
  prompts: readonly CustomPromptBlock[];
  /** 内置预设的出厂提示词区块。 */
  defaultPrompts: readonly CustomPromptBlock[];
  /** 当前生效预设 id；缺失时按内置处理，保留默认内容自愈能力。 */
  activePresetId: string | undefined;
  builtinPresetId: string;
}

export interface PresetPromptMigrationResult {
  prompts: CustomPromptBlock[];
  /** 是否产生了需要落库的变更。 */
  updated: boolean;
  /** 是否命中内置迁移；非内置预设必须为 false 且提示词区块原样返回。 */
  migrated: boolean;
}

/** 当前生效预设是否为内置预设（缺失 id 视为内置，保证默认内容仍可自愈）。 */
export function isBuiltinPresetActive(
  activePresetId: string | undefined,
  builtinPresetId: string,
): boolean {
  return !activePresetId || activePresetId === builtinPresetId;
}

/** 按生效预设收口出厂内容迁移：非内置预设原样返回，不追加区块、不改写角色。 */
export function resolvePresetPromptMigration(
  input: PresetPromptMigrationInput,
): PresetPromptMigrationResult {
  if (!isBuiltinPresetActive(input.activePresetId, input.builtinPresetId)) {
    return { prompts: [...input.prompts], updated: false, migrated: false };
  }
  const migrated = migrateBuiltinPromptBlocks(input.prompts, input.defaultPrompts);
  return { ...migrated, migrated: true };
}

/**
 * 内置预设的出厂内容迁移：补齐缺失区块、修复空内容与旧版推理纪律，并统一为 system 角色。
 * 调用方必须先确认目标是内置预设。
 */
export function migrateBuiltinPromptBlocks(
  prompts: readonly CustomPromptBlock[],
  defaultPrompts: readonly CustomPromptBlock[],
): { prompts: CustomPromptBlock[]; updated: boolean } {
  let updated = false;
  const migrated = prompts.map((prompt) => {
    const next: CustomPromptBlock = { ...prompt };
    const content = typeof next.content === "string" ? next.content : "";
    if (next.role !== "system") {
      next.role = "system";
      updated = true;
    }
    const isOutdatedReasoningDiscipline =
      next.id === "prompt_reasoning_discipline" &&
      (content.includes("思考用于分析") ||
        content.includes("【思考阶段允许】") ||
        content.includes("若模型存在内部分析"));
    if (!content.trim() || isOutdatedReasoningDiscipline) {
      const match = defaultPrompts.find((candidate) => candidate.id === next.id);
      if (match?.content) {
        next.content = match.content;
        updated = true;
      }
    }
    return next;
  });
  for (const defaultPrompt of defaultPrompts) {
    if (!migrated.some((prompt) => prompt.id === defaultPrompt.id)) {
      migrated.push({ ...defaultPrompt });
      updated = true;
    }
  }
  return { prompts: migrated, updated };
}
