import { describe, expect, it } from "vitest";
import {
  buildPresetBundleSnapshot,
  isPresetBundleInSync,
  resolveActivePresetBundle,
} from "../../src/application/useCases/presetBundleLifecycle";
import { requirePresetBundle } from "../../src/domain/presets/bundleMigration";
import type { PromptConfig, SamplerPreset } from "../../src/types";

/**
 * 预设快照与脏检查契约。
 *
 * 关键不变量：预设未声明的字段不计入脏状态（否则旧预设一加载就"未保存"），
 * 但"未声明即启用"的开关（`useMainPrompt`／`useJailbreak`）有明确运行期语义，
 * 必须两侧同口径比较——否则用户改了它既看不到未保存标记、也点不动保存，
 * 切换预设时被静默还原。
 */

const sampler = (overrides: Partial<SamplerPreset> = {}): SamplerPreset => ({
  id: "preset_1",
  name: "我的预设",
  temperature: 0.8,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.05,
  maxTokens: 600,
  ...overrides,
});

const promptConfig = (overrides: Partial<PromptConfig> = {}): PromptConfig => ({
  mainPrompt: "MAIN",
  jailbreakPrompt: "JAIL",
  useJailbreak: false,
  instructTemplate: "default",
  systemPrefix: "",
  systemSuffix: "",
  userPrefix: "",
  userSuffix: "",
  assistantPrefix: "",
  assistantSuffix: "",
  ...overrides,
});

const bundle = (overrides: Record<string, unknown> = {}) => requirePresetBundle({
  schemaVersion: 3,
  id: "bundle_1",
  sampler: sampler(),
  promptConfig: promptConfig(),
  regexScripts: [],
  ...overrides,
});

describe("isPresetBundleInSync", () => {
  const selection = {
    preset: sampler(),
    promptConfig: promptConfig(),
    presetRegexScripts: [],
  };

  it("设置与预设一致时判定为已同步", () => {
    expect(isPresetBundleInSync(bundle(), selection)).toBe(true);
  });

  it("提示词内容、采样或正则任一变化都判定为未同步", () => {
    expect(isPresetBundleInSync(bundle(), {
      ...selection,
      promptConfig: promptConfig({ mainPrompt: "CHANGED" }),
    })).toBe(false);
    expect(isPresetBundleInSync(bundle(), {
      ...selection,
      preset: sampler({ temperature: 1.2 }),
    })).toBe(false);
    expect(isPresetBundleInSync(bundle(), {
      ...selection,
      presetRegexScripts: [{
        id: "reg_1",
        scriptName: "s",
        findRegex: "/a/g",
        replaceString: "b",
        disabled: false,
        placement: [2],
      }],
    })).toBe(false);
  });

  it("预设未拥有的字段（运行期专有内容）不产生脏状态", () => {
    expect(isPresetBundleInSync(bundle(), {
      ...selection,
      promptConfig: promptConfig({ tableMemoryPrompt: "运行期默认内容" }),
    })).toBe(true);
  });

  it("未声明即启用的开关：显式关闭必须判定为未同步", () => {
    const undeclared = bundle({ promptConfig: promptConfig({ useJailbreak: undefined }) });

    // 两侧都未声明 → 都按启用解读，属于同步。
    expect(isPresetBundleInSync(undeclared, {
      ...selection,
      promptConfig: promptConfig({ useJailbreak: undefined }),
    })).toBe(true);

    // 用户把它关掉 → 必须能被判脏，否则改动无法保存、切换即静默还原。
    expect(isPresetBundleInSync(undeclared, {
      ...selection,
      promptConfig: promptConfig({ useJailbreak: false }),
    })).toBe(false);
    expect(isPresetBundleInSync(bundle(), {
      ...selection,
      promptConfig: promptConfig({ useMainPrompt: false }),
    })).toBe(false);
  });

  it("显式声明的开关按原值比较", () => {
    const declared = bundle({ promptConfig: promptConfig({ useJailbreak: false }) });
    expect(isPresetBundleInSync(declared, {
      ...selection,
      promptConfig: promptConfig({ useJailbreak: false }),
    })).toBe(true);
    expect(isPresetBundleInSync(declared, {
      ...selection,
      promptConfig: promptConfig({ useJailbreak: true }),
    })).toBe(false);
  });
});

describe("buildPresetBundleSnapshot", () => {
  it("产出当前实体版本，未声明内置时不带 isBuiltin", () => {
    const snapshot = buildPresetBundleSnapshot({
      preset: sampler(),
      promptConfig: promptConfig(),
      presetRegexScripts: [],
    }, { id: "bundle_x" });

    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.id).toBe("bundle_x");
    expect(snapshot).not.toHaveProperty("isBuiltin");
    expect(snapshot.regexScripts).toEqual([]);
  });
});

describe("resolveActivePresetBundle", () => {
  const list = [bundle(), bundle({ id: "bundle_2", sampler: sampler({ id: "preset_2", name: "第二" }) })];

  it("按 sampler.id → bundle.id → 名称 → 首项依次定位", () => {
    expect(resolveActivePresetBundle(list, { id: "preset_2", name: "x" })?.id).toBe("bundle_2");
    expect(resolveActivePresetBundle(list, { id: "bundle_2", name: "x" })?.id).toBe("bundle_2");
    expect(resolveActivePresetBundle(list, { id: "missing", name: "第二" })?.id).toBe("bundle_2");
    expect(resolveActivePresetBundle(list, { id: "missing", name: "missing" })?.id).toBe("bundle_1");
    expect(resolveActivePresetBundle([], { id: "preset_1", name: "我的预设" })).toBeUndefined();
  });
});
