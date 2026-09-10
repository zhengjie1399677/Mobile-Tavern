import { describe, expect, it } from "vitest";
import {
  isBuiltinPresetActive,
  migrateBuiltinPromptBlocks,
  resolvePresetPromptMigration,
} from "../../src/application/useCases/presetRuntimeMigration";
import { MOBILE_TAVERN_BASIC_PRESET_BUNDLE } from "../../src/hooks/settings/defaults";
import type { CustomPromptBlock } from "../../src/types";

const BUILTIN_PRESET_ID = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset.id;
const BUILTIN_PROMPTS = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.customPrompts ?? [];

describe("presetRuntimeMigration", () => {
  it("缺失预设 id 时按内置处理，其余自定义预设一律判定为非内置", () => {
    expect(isBuiltinPresetActive(undefined, BUILTIN_PRESET_ID)).toBe(true);
    expect(isBuiltinPresetActive(BUILTIN_PRESET_ID, BUILTIN_PRESET_ID)).toBe(true);
    expect(isBuiltinPresetActive("import_preset_abc", BUILTIN_PRESET_ID)).toBe(false);
  });

  it("第三方预设的提示词区块保持原样，不被注入内置内容", () => {
    const thirdPartyPrompts: CustomPromptBlock[] = [
      { id: "main", identifier: "main", name: "Main", role: "system", content: "MAIN", enabled: true },
      { id: "chatHistory", identifier: "chatHistory", name: "History", role: "user", content: "", enabled: true },
    ];

    const result = resolvePresetPromptMigration({
      prompts: thirdPartyPrompts,
      defaultPrompts: BUILTIN_PROMPTS,
      activePresetId: "import_preset_abc",
      builtinPresetId: BUILTIN_PRESET_ID,
    });

    expect(result.migrated).toBe(false);
    expect(result.updated).toBe(false);
    expect(result.prompts).toEqual(thirdPartyPrompts);
    expect(result.prompts).toHaveLength(2);
  });

  it("内置预设仍执行出厂迁移：补齐缺失区块并统一 system 角色", () => {
    const storedPrompts: CustomPromptBlock[] = [
      { id: "prompt_pov_second", name: "视角", role: "user", content: "", enabled: true },
    ];

    const result = resolvePresetPromptMigration({
      prompts: storedPrompts,
      defaultPrompts: BUILTIN_PROMPTS,
      activePresetId: BUILTIN_PRESET_ID,
      builtinPresetId: BUILTIN_PRESET_ID,
    });

    expect(result.migrated).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.prompts).toHaveLength(BUILTIN_PROMPTS.length);
    const pov = result.prompts.find((prompt) => prompt.id === "prompt_pov_second");
    // 已存在的区块统一为 system；新增的内置区块按出厂定义追加，不改写其声明角色。
    expect(pov?.role).toBe("system");
    expect(pov?.content).toBe(
      BUILTIN_PROMPTS.find((prompt) => prompt.id === "prompt_pov_second")?.content,
    );
    const appended = result.prompts.find((prompt) => prompt.id === "prompt_history_trace");
    expect(appended?.role).toBe(
      BUILTIN_PROMPTS.find((prompt) => prompt.id === "prompt_history_trace")?.role,
    );
  });

  it("迁移不修改调用方传入的数组", () => {
    const storedPrompts: CustomPromptBlock[] = [
      { id: "prompt_pov_second", name: "视角", role: "user", content: "自定义内容", enabled: true },
    ];

    migrateBuiltinPromptBlocks(storedPrompts, BUILTIN_PROMPTS);

    expect(storedPrompts[0].role).toBe("user");
    expect(storedPrompts[0].content).toBe("自定义内容");
    expect(storedPrompts).toHaveLength(1);
  });
});
