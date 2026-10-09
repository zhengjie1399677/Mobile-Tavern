import { describe, expect, it } from "vitest";
import {
  CURRENT_PRESET_FACTORY_REVISION,
  LEGACY_FORMAT_PRESET_ID,
  readExternalPresetDefaults,
  resolveBuiltinPreset,
  resolvePresetBootstrap,
  type PresetBootstrapFactoryDefaults,
  type PresetBootstrapInput,
  type PresetBootstrapResult,
} from "../../src/application/useCases/presetBootstrap";
import type { PromptConfig, SamplerPreset } from "../../src/types";
import type { PresetBundle } from "../../src/domain/presets/contracts";
import { requirePresetBundle } from "../../src/domain/presets/bundleMigration";

function makePromptConfig(overrides: Partial<PromptConfig> = {}): PromptConfig {
  return {
    mainPrompt: "MAIN",
    jailbreakPrompt: "JAIL",
    useJailbreak: true,
    instructTemplate: "default",
    systemPrefix: "sp",
    systemSuffix: "ss",
    userPrefix: "up",
    userSuffix: "us",
    assistantPrefix: "ap",
    assistantSuffix: "as",
    customPrompts: [],
    sectionHeaders: { greeting: "=== HI ===" },
    ...overrides,
  };
}

const FACTORY: PresetBootstrapFactoryDefaults = {
  promptConfig: makePromptConfig({ mainPrompt: "FACTORY_PROMPT" }),
  settingsPromptConfig: makePromptConfig({ mainPrompt: "SETTINGS_BASE" }),
  tableMemoryPrompt: "FACTORY_TABLE_MEMORY",
};

function makeSampler(id: string, name: string): SamplerPreset {
  return {
    id,
    name,
    temperature: 0.8,
    topP: 1,
    topK: 0,
    repetitionPenalty: 1,
    maxTokens: 100,
  };
}

/**
 * 测试用内置预设（v2）。
 *
 * 出厂内容以 v1 字面量书写（刻意不声明 `presetRegexScripts`，与真实内置预设一致），
 * 再经领域迁移入口转成 v2——与 `defaults.ts` 的做法保持一致。
 */
function makeBuiltin(overrides: Partial<PromptConfig> = {}): PresetBundle {
  return requirePresetBundle({
    id: "bundle_test_builtin",
    isBuiltin: true,
    preset: makeSampler("preset_test_builtin", "测试内置"),
    promptConfig: makePromptConfig({
      mainPrompt: "BUILTIN_MAIN",
      jailbreakPrompt: "BUILTIN_JAIL",
      storyString: "BUILTIN_STORY",
      postHistoryPrompt: "BUILTIN_PH",
      reasoningGuidancePrompt: "BUILTIN_RG",
      customPrompts: [{ id: "prompt_a", name: "区块 A", role: "system", content: "AAA", enabled: true }],
      ...overrides,
    }),
  });
}

const COMPILED_BUILTIN = makeBuiltin();

function makeCustomPreset(id = "custom_1"): PresetBundle {
  return requirePresetBundle({
    id,
    preset: makeSampler(`preset_${id}`, "自定义预设"),
    promptConfig: makePromptConfig({ mainPrompt: "CUSTOM_MAIN" }),
  });
}

/** 内置预设生效、且已包含出厂回填内容的设置主记录。 */
function makeStoredSettings(overrides: Partial<PresetBootstrapInput["storedSettings"]> = {}) {
  return {
    preset: { id: COMPILED_BUILTIN.sampler.id },
    promptConfig: makePromptConfig({
      mainPrompt: "BUILTIN_MAIN",
      jailbreakPrompt: "BUILTIN_JAIL",
      storyString: "BUILTIN_STORY",
      postHistoryPrompt: "BUILTIN_PH",
      reasoningGuidancePrompt: "BUILTIN_RG",
      tableMemoryPrompt: "【状态与结构化记忆引擎】内容",
      customPrompts: [{ id: "prompt_a", name: "区块 A", role: "system", content: "AAA", enabled: true }],
    }),
    ...overrides,
  };
}

function boot(overrides: Partial<PresetBootstrapInput> = {}): PresetBootstrapResult {
  return resolvePresetBootstrap({
    storedSettings: null,
    storedPresets: null,
    externalDefaults: null,
    compiledBuiltin: COMPILED_BUILTIN,
    factory: FACTORY,
    ...overrides,
  });
}

function codes(result: PresetBootstrapResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("readExternalPresetDefaults", () => {
  it("非对象输入一律视为无效，不阻塞启动", () => {
    expect(readExternalPresetDefaults(null)).toBeNull();
    expect(readExternalPresetDefaults("not-json-object")).toBeNull();
    expect(readExternalPresetDefaults([1, 2])).toBeNull();
  });

  it("按字段收口；缺失字段保持 undefined", () => {
    const parsed = readExternalPresetDefaults({
      promptConfig: { mainPrompt: "EXT_MAIN" },
      memory: { recentTurns: 3 },
      basicPresetBundle: { promptConfig: { mainPrompt: "EXT_BUNDLE_MAIN" } },
    });

    expect(parsed?.promptConfig).toEqual({ mainPrompt: "EXT_MAIN" });
    expect(parsed?.memory).toEqual({ recentTurns: 3 });
    expect(parsed?.basicPresetBundlePromptConfig).toEqual({ mainPrompt: "EXT_BUNDLE_MAIN" });
  });

  it("字段类型不符时不参与合并", () => {
    const parsed = readExternalPresetDefaults({
      promptConfig: "bad",
      memory: 42,
      basicPresetBundle: { promptConfig: [] },
    });

    expect(parsed).toEqual({
      promptConfig: undefined,
      memory: undefined,
      basicPresetBundlePromptConfig: undefined,
    });
  });
});

describe("resolveBuiltinPreset", () => {
  it("没有外部文件时直接复用编译期内置预设", () => {
    const resolved = resolveBuiltinPreset(COMPILED_BUILTIN, null);

    expect(resolved.bundle).toBe(COMPILED_BUILTIN);
    expect(resolved.externalPromptConfigApplied).toBe(false);
  });

  it("外部文件只覆盖内置预设的 Prompt 字段，且不修改入参", () => {
    const resolved = resolveBuiltinPreset(COMPILED_BUILTIN, {
      basicPresetBundlePromptConfig: { mainPrompt: "EXTERNAL_MAIN" },
    });

    expect(resolved.bundle.promptConfig?.mainPrompt).toBe("EXTERNAL_MAIN");
    expect(resolved.bundle.promptConfig?.jailbreakPrompt).toBe("BUILTIN_JAIL");
    expect(resolved.bundle.sampler).toBe(COMPILED_BUILTIN.sampler);
    expect(resolved.bundle.promptConfig).not.toHaveProperty("composition");
    expect(COMPILED_BUILTIN.promptConfig?.mainPrompt).toBe("BUILTIN_MAIN");
  });
});

describe("resolvePresetBootstrap 全新安装", () => {
  it("无外部文件时建立出厂预设列表与出厂 Prompt 基底", () => {
    const result = boot();

    expect(result.savedPresets.map((preset) => preset.id)).toEqual([COMPILED_BUILTIN.id]);
    expect(result.savedPresets[0].regexScripts).toEqual([]);
    expect(result.promptConfig).toEqual(FACTORY.settingsPromptConfig);
    expect(result.presetsDirty).toBe(true);
    expect(result.settingsDirty).toBe(true);
  });

  it("只有外部 promptConfig 时，以它为活跃 Prompt 覆盖", () => {
    const result = boot({ externalDefaults: { promptConfig: { mainPrompt: "EXT_MAIN" } } });

    expect(result.promptConfig.mainPrompt).toBe("EXT_MAIN");
    expect(codes(result)).toContain("external-defaults-applied");
  });

  it("外部 basicPresetBundle 的 Prompt 字段叠加在外部 promptConfig 之后", () => {
    const result = boot({
      externalDefaults: {
        promptConfig: { mainPrompt: "EXT_MAIN" },
        basicPresetBundlePromptConfig: { jailbreakPrompt: "EXT_JAIL" },
      },
    });

    // 内置预设自身声明的字段最后覆盖，与旧实现一致（外部文件只修补未声明字段）。
    expect(result.promptConfig.mainPrompt).toBe("BUILTIN_MAIN");
    expect(result.promptConfig.jailbreakPrompt).toBe("EXT_JAIL");
    expect(result.savedPresets[0].promptConfig?.jailbreakPrompt).toBe("EXT_JAIL");
  });
});

describe("resolvePresetBootstrap 预设列表", () => {
  it("旧键迁移：saved_presets_bundle 缺失时继承设置主记录并要求落库", () => {
    const result = boot({
      storedSettings: { ...makeStoredSettings(), savedPresets: [COMPILED_BUILTIN] },
      storedPresets: null,
    });

    expect(result.savedPresets.map((preset) => preset.id)).toEqual([COMPILED_BUILTIN.id]);
    expect(result.presetsDirty).toBe(true);
    expect(codes(result)).toContain("legacy-saved-presets-key-migrated");
  });

  it("自带预设已降级为普通预设，存储中的修改得到保留，不被出厂模板强制覆盖", () => {
    const modifiedBuiltin = {
      ...COMPILED_BUILTIN,
      promptConfig: makePromptConfig({ mainPrompt: "USER_MODIFIED_MAIN" }),
    };
    const customPreset = makeCustomPreset();

    const result = boot({
      storedSettings: makeStoredSettings(),
      storedPresets: [customPreset, modifiedBuiltin],
    });

    expect(result.savedPresets.map((preset) => preset.id)).toEqual([customPreset.id, COMPILED_BUILTIN.id]);
    expect(result.savedPresets[1].promptConfig?.mainPrompt).toBe("USER_MODIFIED_MAIN");
    expect(result.presetsDirty).toBe(false);
  });

  it("旧版本注入的遗留预设被清理", () => {
    const result = boot({
      storedSettings: makeStoredSettings(),
      storedPresets: [
        COMPILED_BUILTIN,
        makeCustomPreset(LEGACY_FORMAT_PRESET_ID),
      ],
    });

    expect(result.savedPresets.map((preset) => preset.id)).not.toContain(LEGACY_FORMAT_PRESET_ID);
    expect(codes(result)).toContain("legacy-format-preset-removed");
  });

  it("v2 实体的正则列表由领域迁移保证，引导不再重复归一化", () => {
    const result = boot({
      storedSettings: makeStoredSettings(),
      storedPresets: [makeCustomPreset()],
    });

    // 迁移入口负责补齐 `regexScripts`（见 presetBundleMigration.test.ts），
    // 因此引导阶段不应再产生"正则被归一化"这类诊断噪音。
    expect(result.savedPresets.find((preset) => preset.id === "custom_1")?.regexScripts).toEqual([]);
    expect(codes(result)).not.toContain("preset-regex-scripts-normalized");
  });

  it("幂等：用第一次引导的结果再跑一次不产生任何写入", () => {
    const first = boot({ storedSettings: makeStoredSettings(), storedPresets: null });
    expect(first.settingsDirty).toBe(true);

    const second = boot({
      storedSettings: {
        preset: { id: COMPILED_BUILTIN.sampler.id },
        promptConfig: first.promptConfig,
        savedPresets: first.savedPresets,
        // 引导会把出厂修订标记写回设置；第二次启动必须带着它，否则会再判定为需要识别旧内容。
        presetFactoryRevision: first.presetFactoryRevision,
      },
      storedPresets: first.savedPresets,
    });

    expect(second.presetsDirty).toBe(false);
    expect(second.settingsDirty).toBe(false);
    expect(second.promptConfig).toEqual(first.promptConfig);
  });
});

describe("resolvePresetBootstrap 出厂内容迁移边界", () => {
  it("默认预设降级为普通预设，生效时不强行升级覆盖用户已有主提示词", () => {
    const result = boot({
      storedSettings: {
        preset: { id: COMPILED_BUILTIN.sampler.id },
        promptConfig: makePromptConfig({
          mainPrompt: "用户已有内容",
          postHistoryPrompt: "OLD_PH",
          tableMemoryPrompt: "OLD_TABLE",
        }),
      },
    });

    expect(result.promptConfig.mainPrompt).toBe("用户已有内容");
    expect(result.promptConfig.postHistoryPrompt).toBe("OLD_PH");
    expect(result.promptConfig.tableMemoryPrompt).toBe("OLD_TABLE");
    expect(codes(result)).not.toContain("legacy-default-prompt-upgraded");
  });

  it("已盖上当前出厂修订标记时不再按文本特征识别旧出厂提示词", () => {
    const result = boot({
      storedSettings: {
        preset: { id: COMPILED_BUILTIN.sampler.id },
        promptConfig: makePromptConfig({ mainPrompt: "用户自己粘贴的 [NARRATIVE ENGINE: 旧内容" }),
        presetFactoryRevision: CURRENT_PRESET_FACTORY_REVISION,
      },
    });

    // 标记为当前值时，即使正文命中历史特征串也不得改写用户内容（`COMPAT-DATA`）。
    expect(result.promptConfig.mainPrompt).toBe("用户自己粘贴的 [NARRATIVE ENGINE: 旧内容");
    expect(codes(result)).not.toContain("legacy-default-prompt-upgraded");
    expect(result.presetFactoryRevision).toBe(CURRENT_PRESET_FACTORY_REVISION);
  });

  it("缺少出厂修订标记时盖上新标记，不改写提示词", () => {
    const result = boot({
      storedSettings: {
        preset: { id: COMPILED_BUILTIN.sampler.id },
        promptConfig: makePromptConfig({ mainPrompt: "我的提示词" }),
      },
    });

    expect(result.presetFactoryRevision).toBe(CURRENT_PRESET_FACTORY_REVISION);
    expect(result.promptConfig.mainPrompt).toBe("我的提示词");
    expect(result.settingsDirty).toBe(true);
  });

  it("导入预设生效时，命中同样文案也不被改写，且不注入出厂区块", () => {
    const result = boot({
      storedSettings: {
        preset: { id: "import_preset_x" },
        promptConfig: makePromptConfig({
          mainPrompt: "[NARRATIVE ENGINE: 第三方内容",
          tableMemoryPrompt: "THIRD_TABLE",
        }),
      },
    });

    expect(result.promptConfig.mainPrompt).toBe("[NARRATIVE ENGINE: 第三方内容");
    expect(result.promptConfig.tableMemoryPrompt).toBe("THIRD_TABLE");
    expect(codes(result)).not.toContain("legacy-default-prompt-upgraded");
    expect(codes(result)).not.toContain("factory-prompt-migration-applied");
    expect(codes(result)).not.toContain("table-memory-prompt-repaired");
  });

  it("非内置预设主提示词为空时不被出厂默认值覆盖", () => {
    const result = boot({
      storedSettings: {
        preset: { id: "import_preset_empty_main" },
        promptConfig: makePromptConfig({
          mainPrompt: "",
          customPrompts: [{ id: "custom_1", name: "模块", content: "规则", role: "system", enabled: true }],
        }),
      },
    });

    expect(result.promptConfig.mainPrompt).toBe("");
    expect(result.promptConfig.useMainPrompt).toBe(false);
  });

  it("自带预设缺失出厂区块时不强行补齐注入，保持用户设定纯粹", () => {
    const result = boot({
      storedSettings: {
        preset: { id: COMPILED_BUILTIN.sampler.id },
        promptConfig: makePromptConfig({ mainPrompt: "BUILTIN_MAIN", customPrompts: [] }),
      },
    });

    expect(result.promptConfig.customPrompts).toEqual([]);
    expect(codes(result)).not.toContain("factory-prompt-migration-applied");
  });

  it("外部静态文件一旦生效就要求归一化一次", () => {
    const result = boot({
      storedSettings: makeStoredSettings(),
      storedPresets: [COMPILED_BUILTIN],
      externalDefaults: { promptConfig: { mainPrompt: "BUILTIN_MAIN" } },
    });

    expect(result.settingsDirty).toBe(true);
    expect(codes(result)).toContain("external-defaults-applied");
  });
});
