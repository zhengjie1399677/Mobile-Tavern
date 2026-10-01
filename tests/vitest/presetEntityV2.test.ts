import { describe, expect, it } from "vitest";
import {
  readPresetBundle,
  readPresetBundleList,
} from "../../src/domain/presets/bundleMigration";
import { PRESET_BUNDLE_SCHEMA_VERSION } from "../../src/domain/presets/contracts";
import { projectPresetActivation } from "../../src/application/useCases/presetProjection";
import { resolvePresetBundleActivation } from "../../src/application/useCases/presetBundleLifecycle";
import { DEFAULT_SETTINGS, MOBILE_TAVERN_BASIC_PRESET_BUNDLE_V1 } from "../../src/hooks/settings/defaults";
import {
  createBasicPromptComposition,
  parsePromptComposition,
} from "../../src/domain/prompt-composition";
import type { PromptConfig, SavedPresetBundle } from "../../src/types";

const BUILTIN_V1 = structuredClone(MOBILE_TAVERN_BASIC_PRESET_BUNDLE_V1);

function makeV1(overrides: Partial<SavedPresetBundle> = {}): SavedPresetBundle {
  return {
    id: "bundle_v1",
    preset: {
      id: "preset_v1",
      name: "v1 预设",
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.05,
      maxTokens: 800,
    },
    promptConfig: {
      ...structuredClone(DEFAULT_SETTINGS.promptConfig),
      mainPrompt: "V1_MAIN",
      customPrompts: [
        { id: "block_a", name: "区块 A", role: "system", content: "AAA", enabled: true },
      ],
    },
    presetRegexScripts: [
      {
        id: "regex_a",
        scriptName: "正则 A",
        findRegex: "/x/g",
        replaceString: "y",
        disabled: false,
        placement: [1],
      },
    ],
    ...overrides,
  };
}

function makeCurrentPromptConfig(): PromptConfig {
  return {
    ...structuredClone(DEFAULT_SETTINGS.promptConfig),
    usePromptComposition: true,
    composition: createBasicPromptComposition(),
    mainPrompt: "CURRENT_MAIN",
  };
}

describe("预设实体 v1 → v2 迁移", () => {
  it("v1 记录迁移为 v2：采样、Prompt 快照、兼容块与正则都保留", () => {
    const v1 = makeV1();
    const read = readPresetBundle(v1);

    expect(read).not.toBeNull();
    expect(read?.migrated).toBe(true);
    expect(read?.bundle.schemaVersion).toBe(PRESET_BUNDLE_SCHEMA_VERSION);
    expect(read?.bundle.sampler).toEqual({
      id: "preset_v1",
      name: "v1 预设",
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.05,
      maxTokens: 800,
    });
    // 没有 promptPlan 的旧预设明确降级为 legacy，并合成传统迁移快照。
    expect(read?.bundle.prompt.mode).toBe("legacy");
    expect(read?.bundle.prompt.version).toBe(PRESET_BUNDLE_SCHEMA_VERSION);
    expect(read?.bundle.prompt.composition?.compatibility?.source).toBe("mobile-tavern-legacy");
    expect(read?.bundle.prompt.composition?.blocks.some((block) => block.template === "AAA")).toBe(true);
    // 传统字段只作为只读兼容块原样保留。
    expect(read?.bundle.legacyPromptConfig).toEqual(v1.promptConfig);
    expect(read?.bundle.regexScripts).toHaveLength(1);
    expect(read?.bundle.regexScripts[0]?.scriptName).toBe("正则 A");
    expect(read?.diagnostics.map((item) => item.code)).toContain("preset.bundle.v1-migrated");
  });

  it("v1 记录缺少 presetRegexScripts 时迁移为合法空数组", () => {
    const read = readPresetBundle(makeV1({ presetRegexScripts: undefined }));

    expect(read?.bundle.regexScripts).toEqual([]);
  });

  it("v1 的 promptPlan（自由编排模式）迁移后 mode 与 source 保持", () => {
    const composition = createBasicPromptComposition();
    const v1 = makeV1({
      promptPlan: { version: 1, mode: "composition", source: "sillytavern", composition },
    });
    const read = readPresetBundle(v1);

    expect(read?.bundle.prompt.mode).toBe("composition");
    expect(read?.bundle.prompt.source).toBe("sillytavern");
    expect(parsePromptComposition(read?.bundle.prompt.composition)).toEqual(composition);
  });

  it("废弃的 composition + usePromptComposition 仍无损升级", () => {
    const composition = createBasicPromptComposition();
    const read = readPresetBundle(makeV1({ composition, usePromptComposition: true }));

    expect(read?.bundle.prompt.mode).toBe("composition");
    expect(parsePromptComposition(read?.bundle.prompt.composition)).toEqual(composition);
  });

  it("未知字段进 extensions 保真保存，不静默丢弃", () => {
    const read = readPresetBundle({ ...makeV1(), hasInjectedFormatPreset: true, customFlag: { a: 1 } });

    expect(read?.bundle.extensions).toEqual({ hasInjectedFormatPreset: true, customFlag: { a: 1 } });
    expect(read?.diagnostics.map((item) => item.code)).toContain("preset.bundle.unknown-keys-preserved");
  });

  it("越界或非法采样值回落到运行期默认，仅保留合法字段", () => {
    const read = readPresetBundle({
      ...makeV1(),
      preset: { id: "preset_x", name: "越界", temperature: 99, topP: 0.5, maxTokens: -3 },
    });

    expect(read?.bundle.sampler).toEqual({ id: "preset_x", name: "越界", topP: 0.5 });
  });
});

describe("预设实体读取的健壮性", () => {
  it("非对象或缺 id 的记录返回 null，列表读取留下诊断", () => {
    expect(readPresetBundle(null)).toBeNull();
    expect(readPresetBundle("x")).toBeNull();
    expect(readPresetBundle({ preset: {} })).toBeNull();

    const list = readPresetBundleList([makeV1(), null, 42, { name: "no-id" }]);
    expect(list.bundles).toHaveLength(1);
    expect(list.migrated).toBe(true);
    expect(list.diagnostics.filter((item) => item.code === "preset.bundle.invalid-record")).toHaveLength(3);
  });

  it("被改坏的 v2 记录可读并留诊断，不抛错", () => {
    const read = readPresetBundle({
      schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
      id: "bundle_broken",
      sampler: { id: "preset_broken", name: "坏记录" },
      prompt: { version: PRESET_BUNDLE_SCHEMA_VERSION, mode: "composition", source: "native" },
      regexScripts: [],
    });

    expect(read?.migrated).toBe(true);
    expect(read?.bundle.prompt.mode).toBe("legacy");
    expect(read?.diagnostics.map((item) => item.code)).toContain("preset.bundle.v2-repaired");
  });

  it("正则数组里的非对象条目被丢弃并留诊断", () => {
    const malformed = [
      { id: "ok", scriptName: "s", findRegex: "f", replaceString: "r", disabled: false, placement: [1] },
      7,
    ] as unknown as SavedPresetBundle["presetRegexScripts"];
    const read = readPresetBundle(makeV1({ presetRegexScripts: malformed }));

    expect(read?.bundle.regexScripts).toHaveLength(1);
    expect(read?.diagnostics.map((item) => item.code)).toContain("preset.bundle.regex-script-dropped");
  });

  it("合法 v2 记录原样读取，不产生迁移标记", () => {
    const migrated = readPresetBundle(makeV1())?.bundle;
    const again = readPresetBundle(migrated);

    expect(again?.migrated).toBe(false);
    expect(again?.diagnostics).toHaveLength(0);
    expect(again?.bundle).toEqual(migrated);
  });
});

describe("唯一投影与 v1 行为对照", () => {
  const current = makeCurrentPromptConfig();
  const defaults = DEFAULT_SETTINGS.preset;

  const cases: Array<[string, SavedPresetBundle]> = [
    ["内置预设（promptPlan legacy + 编排快照）", structuredClone(BUILTIN_V1)],
    ["旧预设（无 promptPlan）", makeV1()],
    ["自由编排预设", makeV1({ promptPlan: { version: 1, mode: "composition", source: "native", composition: createBasicPromptComposition() } })],
    ["废弃字段预设", makeV1({ composition: createBasicPromptComposition(), usePromptComposition: true })],
    ["非内置自定义预设", makeV1({ id: "bundle_custom", isBuiltin: false })],
  ];

  for (const [name, v1] of cases) {
    it(`投影结果与 v1 激活路径逐字一致：${name}`, () => {
      const expected = resolvePresetBundleActivation(current, v1, defaults);
      const read = readPresetBundle(v1);
      expect(read).not.toBeNull();
      const actual = projectPresetActivation(current, read!.bundle, defaults);

      expect(actual.preset).toEqual(expected.preset);
      expect(actual.presetRegexScripts).toEqual(expected.presetRegexScripts);
      expect(actual.promptConfig).toEqual(expected.promptConfig);
      expect(actual.promptConfig.usePromptComposition).toBe(expected.promptConfig.usePromptComposition);
    });
  }

  it("未声明编排的预设不继承当前设置的编排开关", () => {
    const read = readPresetBundle(makeV1());
    const actual = projectPresetActivation(current, read!.bundle, defaults);

    expect(actual.promptConfig.usePromptComposition).toBe(false);
    expect(actual.promptConfig.mainPrompt).toBe("V1_MAIN");
  });
});
