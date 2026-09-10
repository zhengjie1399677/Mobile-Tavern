import { describe, expect, it } from "vitest";
import {
  buildPresetBundleSnapshot,
  collectPresetBundleReferences,
  isPresetBundleInSync,
  resolvePresetBundleActivation,
} from "../../src/application/useCases/presetBundleLifecycle";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { createBasicPromptComposition } from "../../src/domain/prompt-composition";
import type {
  PresetPromptConfig,
  RegexScript,
  UserSettings,
} from "../../src/types";
import type { RuntimeProfileRecord } from "../../src/application/runtimeProfiles/contracts";

const SAMPLE_REGEX: RegexScript = {
  id: "regex_probe",
  scriptName: "探针正则",
  findRegex: "/a/g",
  replaceString: "b",
  disabled: false,
  placement: [2],
  runOnEdit: true,
  markdownOnly: false,
  promptOnly: false,
};

type Selection = Pick<UserSettings, "preset" | "promptConfig" | "presetRegexScripts">;

function createSelection(overrides: Partial<Selection> = {}): Selection {
  return {
    preset: { ...DEFAULT_SETTINGS.preset },
    promptConfig: { ...DEFAULT_PROMPT_CONFIG },
    presetRegexScripts: [{ ...SAMPLE_REGEX }],
    ...overrides,
  };
}

describe("presetBundleLifecycle", () => {
  it("激活预设时必须整体带出采样、Prompt 快照与预设正则", () => {
    const selection = createSelection();
    const bundle = buildPresetBundleSnapshot(selection, {
      id: "bundle_probe",
      planSource: "native",
    });
    bundle.preset = { ...bundle.preset, temperature: 0.42 };
    bundle.presetRegexScripts = [{ ...SAMPLE_REGEX }];

    const activation = resolvePresetBundleActivation(
      { ...DEFAULT_PROMPT_CONFIG, mainPrompt: "旧的主提示词" },
      bundle,
      DEFAULT_SETTINGS.preset,
    );

    expect(activation.preset.temperature).toBe(0.42);
    expect(activation.promptConfig.mainPrompt).toBe(bundle.promptConfig.mainPrompt);
    expect(activation.promptConfig.usePromptComposition).toBe(false);
    expect(activation.presetRegexScripts).toHaveLength(1);
    expect(activation.presetRegexScripts?.[0].scriptName).toBe("探针正则");
  });

  it("激活 legacy 预设不得继承当前预设的自由编排模式", () => {
    const composition = { ...createBasicPromptComposition(), id: "composition_old", name: "旧编排" };
    const bundle = buildPresetBundleSnapshot(
      createSelection(),
      { id: "bundle_legacy", planSource: "mobile-tavern" },
    );

    const activation = resolvePresetBundleActivation(
      {
        ...DEFAULT_PROMPT_CONFIG,
        usePromptComposition: true,
        composition,
      },
      bundle,
      DEFAULT_SETTINGS.preset,
    );

    expect(activation.promptConfig.usePromptComposition).toBe(false);
  });

  it("激活 composition 预设时恢复编排快照", () => {
    const composition = { ...createBasicPromptComposition(), id: "composition_probe", name: "探针编排" };
    const bundle = buildPresetBundleSnapshot(
      createSelection({
        promptConfig: { ...DEFAULT_PROMPT_CONFIG, usePromptComposition: true, composition },
      }),
      { id: "bundle_composition", planSource: "native" },
    );

    const activation = resolvePresetBundleActivation(
      DEFAULT_PROMPT_CONFIG,
      bundle,
      DEFAULT_SETTINGS.preset,
    );

    expect(activation.promptConfig.usePromptComposition).toBe(true);
    expect(activation.promptConfig.composition?.id).toBe("composition_probe");
  });

  it("刚保存/刚切换完成的预设视为已同步", () => {
    const selection = createSelection();
    const bundle = buildPresetBundleSnapshot(selection, { id: "bundle_sync", planSource: "native" });

    expect(isPresetBundleInSync(bundle, selection, DEFAULT_SETTINGS.preset)).toBe(true);
  });

  it("激活预设后立即判定为已同步，不误报未保存", () => {
    const legacyBundle = buildPresetBundleSnapshot(createSelection(), {
      id: "bundle_sync_legacy",
      planSource: "native",
    });
    const compositionBundle = buildPresetBundleSnapshot(
      createSelection({
        promptConfig: {
          ...DEFAULT_PROMPT_CONFIG,
          usePromptComposition: true,
          composition: { ...createBasicPromptComposition(), id: "composition_sync" },
        },
      }),
      { id: "bundle_sync_composition", planSource: "native" },
    );

    for (const bundle of [legacyBundle, compositionBundle]) {
      const activation = resolvePresetBundleActivation(
        { ...DEFAULT_PROMPT_CONFIG, mainPrompt: "上一个预设的主提示词" },
        bundle,
        DEFAULT_SETTINGS.preset,
      );
      expect(isPresetBundleInSync(
        bundle,
        {
          preset: activation.preset,
          promptConfig: activation.promptConfig,
          presetRegexScripts: activation.presetRegexScripts,
        },
        DEFAULT_SETTINGS.preset,
      )).toBe(true);
    }
  });

  it("采样、提示词、正则与运行模式分别变更时都要判定为未保存", () => {
    const selection = createSelection();
    const bundle = buildPresetBundleSnapshot(selection, { id: "bundle_dirty", planSource: "native" });

    expect(isPresetBundleInSync(
      bundle,
      createSelection({ preset: { ...selection.preset, temperature: 1.31 } }),
      DEFAULT_SETTINGS.preset,
    )).toBe(false);
    expect(isPresetBundleInSync(
      bundle,
      createSelection({
        promptConfig: { ...selection.promptConfig, mainPrompt: "改写后的主提示词" },
      }),
      DEFAULT_SETTINGS.preset,
    )).toBe(false);
    expect(isPresetBundleInSync(
      bundle,
      createSelection({ presetRegexScripts: [] }),
      DEFAULT_SETTINGS.preset,
    )).toBe(false);
    expect(isPresetBundleInSync(
      bundle,
      createSelection({
        promptConfig: {
          ...selection.promptConfig,
          usePromptComposition: true,
          composition: createBasicPromptComposition(),
        },
      }),
      DEFAULT_SETTINGS.preset,
    )).toBe(false);
  });

  it("切换预设时不得残留上一个预设的专有字段（尤其切回内置预设）", () => {
    const builtinBundle = buildPresetBundleSnapshot(
      createSelection({ presetRegexScripts: [] }),
      { id: "bundle_builtin", isBuiltin: true, planSource: "native" },
    );
    const customBundle = buildPresetBundleSnapshot(
      {
        preset: { ...DEFAULT_SETTINGS.preset, id: "preset_custom", name: "自定义预设" },
        promptConfig: {
          ...DEFAULT_PROMPT_CONFIG,
          postHistoryPrompt: "自定义尾置指令",
          usePostHistory: true,
          enableReasoningGuidance: false,
          reasoningGuidancePrompt: "自定义推理指引",
          renderingFormat: "xml",
        },
        presetRegexScripts: [{ ...SAMPLE_REGEX }],
      },
      { id: "bundle_custom", planSource: "native" },
    );

    const afterCustom = resolvePresetBundleActivation(
      DEFAULT_PROMPT_CONFIG,
      customBundle,
      DEFAULT_SETTINGS.preset,
    );
    expect(afterCustom.promptConfig.usePostHistory).toBe(true);

    const backToBuiltin = resolvePresetBundleActivation(
      afterCustom.promptConfig,
      builtinBundle,
      DEFAULT_SETTINGS.preset,
    );

    expect(backToBuiltin.promptConfig.usePostHistory).toBeUndefined();
    expect(backToBuiltin.promptConfig.postHistoryPrompt).toBeUndefined();
    expect(backToBuiltin.promptConfig.enableReasoningGuidance).toBeUndefined();
    expect(backToBuiltin.promptConfig.reasoningGuidancePrompt).toBeUndefined();
    expect(backToBuiltin.promptConfig.renderingFormat).toBeUndefined();
    expect(backToBuiltin.presetRegexScripts).toHaveLength(0);
  });

  it("预设未声明的字段按继承语义处理，不计入未保存状态", () => {
    const sparsePromptConfig: PresetPromptConfig = {
      mainPrompt: "外部预设主提示词",
      jailbreakPrompt: DEFAULT_PROMPT_CONFIG.jailbreakPrompt,
      useJailbreak: DEFAULT_PROMPT_CONFIG.useJailbreak,
      instructTemplate: "default",
      systemPrefix: "",
      systemSuffix: "",
      userPrefix: "",
      userSuffix: "",
      assistantPrefix: "",
      assistantSuffix: "",
    };
    const bundle = buildPresetBundleSnapshot(
      createSelection({ promptConfig: { ...DEFAULT_PROMPT_CONFIG, mainPrompt: "外部预设主提示词" } }),
      { id: "bundle_sparse", planSource: "sillytavern" },
    );
    bundle.promptConfig = sparsePromptConfig;

    expect(isPresetBundleInSync(
      bundle,
      createSelection({
        promptConfig: { ...DEFAULT_PROMPT_CONFIG, mainPrompt: "外部预设主提示词" },
      }),
      DEFAULT_SETTINGS.preset,
    )).toBe(true);
  });

  it("删除前引用汇总只统计绑定了该预设的 Agent Profile", () => {
    const profiles = [
      createProfile("profile_a", "剧本助手 A", "bundle_a"),
      createProfile("profile_b", "剧本助手 B", "bundle_b"),
      createProfile("profile_c", "剧本助手 C", "bundle_a"),
    ];

    expect(collectPresetBundleReferences("bundle_a", profiles)).toEqual({
      count: 2,
      profileNames: ["剧本助手 A", "剧本助手 C"],
    });
    expect(collectPresetBundleReferences("bundle_missing", profiles)).toEqual({
      count: 0,
      profileNames: [],
    });
  });
});

function createProfile(id: string, name: string, promptPresetId: string): RuntimeProfileRecord {
  return {
    id,
    name,
    schemaVersion: 1,
    version: 1,
    builtin: false,
    capabilities: {
      sillyTavernCompatibility: true,
      audioAsrFallback: false,
      videoKeyframeFallback: false,
    },
    agent: { toolMounts: [], promptPresetId },
    createdAt: 0,
    updatedAt: 0,
  };
}
