import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompatibilityCodecDefinition } from "../../src/application/compatibility/contracts";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SavedPresetBundle, UserSettings } from "../../src/types";
import { testSillyTavernCompatibilityCodec } from "../fixtures/sillyTavernCompatibilityCodec";

const mocks = vi.hoisted(() => ({
  saveStoredSavedPresets: vi.fn(async (_bundles: SavedPresetBundle[]): Promise<void> => undefined),
  getStoredSavedPresets: vi.fn(async (): Promise<SavedPresetBundle[]> => []),
  compatibilityCodec: undefined as CompatibilityCodecDefinition | undefined,
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({
    hasService: (serviceId: string) => serviceId === "compatibilityRuntime"
      && mocks.compatibilityCodec !== undefined,
    getService: (serviceId: string) => serviceId === "compatibilityRuntime"
      ? { getCodec: () => mocks.compatibilityCodec ?? null }
      : {
          saveStoredSavedPresets: mocks.saveStoredSavedPresets,
          getStoredSavedPresets: mocks.getStoredSavedPresets,
        },
  }),
}));

import { usePresetBundles } from "../../src/hooks/settings/usePresetBundles";
import { MOBILE_TAVERN_BASIC_PRESET_BUNDLE } from "../../src/hooks/settings/defaults";

describe("usePresetBundles 预设导入", () => {
  afterEach(() => {
    delete (window as unknown as { AndroidThemeBridge?: unknown }).AndroidThemeBridge;
  });

  it("出厂内置预设携带 isBuiltin 标记（用于界面区分内置/导入）", () => {
    expect(MOBILE_TAVERN_BASIC_PRESET_BUNDLE.isBuiltin).toBe(true);
    const bundled = (DEFAULT_SETTINGS.savedPresets || []).find(
      (bundle) => bundle.id === "bundle_mobile_tavern_basic",
    );
    expect(bundled?.isBuiltin).toBe(true);
  });
  beforeEach(() => {
    mocks.compatibilityCodec = testSillyTavernCompatibilityCodec;
    mocks.saveStoredSavedPresets.mockClear();
    mocks.getStoredSavedPresets.mockClear();
    mocks.getStoredSavedPresets.mockResolvedValue(
      structuredClone(DEFAULT_SETTINGS.savedPresets || []),
    );
  });

  it("导入后立即加入 savedPresets、持久化并激活", async () => {
    const initial = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.assistantPrefix = "当前预设的私有前缀";
    let latestSettings: UserSettings | undefined;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(initial) : next;
    });
    const showCustomAlert = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert,
        showCustomPrompt: vi.fn(async () => null),
        showCustomConfirm: vi.fn(async () => true),
      })
    );
    const input = {
      files: [new File([
        JSON.stringify({ name: "导入测试预设", temperature: 0.63, top_p: 0.91 }),
      ], "preset.json", { type: "application/json" })],
      value: "preset.json",
    };

    act(() => {
      result.current.handleImportPresetJSON({
        target: input,
      } as unknown as ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1));
    expect(latestSettings?.savedPresets).toHaveLength((DEFAULT_SETTINGS.savedPresets || []).length + 1);
    const imported = latestSettings?.savedPresets?.find(
      (bundle) => bundle.preset.name === "导入测试预设"
    );
    expect(imported).toBeDefined();
    expect(imported?.promptConfig.assistantPrefix).toBe(DEFAULT_SETTINGS.promptConfig.assistantPrefix);
    // 导入的预设不标记为内置（来源标识：内置仅限出厂 bundle）
    expect(imported?.isBuiltin).toBeFalsy();
    expect(latestSettings?.preset.id).toBe(imported?.preset.id);
    expect(latestSettings?.preset.temperature).toBe(0.63);
    expect(input.value).toBe("");
    expect(showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("预设已导入")
    );
  });

  it("取消启用时保持传统模式，但预设仍拥有自己的 SillyTavern 编排快照", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = false;
    initial.promptConfig.composition = {
      id: "user-composition",
      name: "用户自己的编排",
      version: 1,
      blocks: [],
    };
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert: vi.fn(async () => undefined),
        showCustomPrompt: vi.fn(async () => null),
        showCustomConfirm: vi.fn(async () => false),
      })
    );
    const input = {
      files: [new File([
        JSON.stringify({
          name: "带 Prompt 的预设",
          system_prompt: "来自预设的主 Prompt",
          prompts: [{ identifier: "main", name: "主 Prompt", content: "内容" }],
          prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
        }),
      ], "preset.json", { type: "application/json" })],
      value: "preset.json",
    };

    act(() => {
      result.current.handleImportPresetJSON({
        target: input,
      } as unknown as ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1));
    expect(latestSettings.promptConfig.usePromptComposition).toBe(false);
    expect(latestSettings.promptConfig.composition?.id).toContain("composition_st_");
    expect(latestSettings.promptCompositionTemplates).toEqual(initial.promptCompositionTemplates);
    const storedBundles = mocks.saveStoredSavedPresets.mock.calls[0][0];
    const storedBundle = storedBundles[storedBundles.length - 1];
    expect(storedBundle.promptConfig).not.toHaveProperty("usePromptComposition");
    expect(storedBundle.promptConfig).not.toHaveProperty("composition");
    expect(storedBundle.promptPlan).toMatchObject({
      version: 1,
      mode: "legacy",
      source: "sillytavern",
    });
    expect(storedBundle.promptPlan?.composition).toBeDefined();
    expect(storedBundle.composition).toBeUndefined();
    expect(storedBundle.usePromptComposition).toBeUndefined();
  });

  it("base Profile 未装载兼容 Codec 时只导入通用字段并给出降级报告", async () => {
    mocks.compatibilityCodec = undefined;
    let latestSettings = structuredClone(DEFAULT_SETTINGS);
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const showCustomAlert = vi.fn(async () => undefined);
    const { result } = renderHook(() => usePresetBundles({
      settings: latestSettings,
      updateSettings,
      showCustomAlert,
      showCustomPrompt: vi.fn(async () => null),
      showCustomConfirm: vi.fn(async () => true),
    }));
    const input = {
      files: [new File([JSON.stringify({
        name: "base Profile 导入",
        temperature: 0.42,
        prompts: [{ identifier: "main", name: "主 Prompt", content: "内容" }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
      })], "preset.json", { type: "application/json" })],
      value: "preset.json",
    };

    act(() => result.current.handleImportPresetJSON({
      target: input,
    } as unknown as ChangeEvent<HTMLInputElement>));

    await waitFor(() => expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1));
    const storedBundles = mocks.saveStoredSavedPresets.mock.calls[0][0];
    const storedBundle = storedBundles[storedBundles.length - 1];
    expect(storedBundle.preset.temperature).toBe(0.42);
    expect(storedBundle.composition).toBeUndefined();
    expect(showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("当前 Profile 未启用 SillyTavern 兼容 Codec"),
    );
  });

  it("确认启用自由编排时，预设包携带编排快照并整体激活", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert: vi.fn(async () => undefined),
        showCustomPrompt: vi.fn(async () => null),
        showCustomConfirm: vi.fn(async () => true),
      })
    );
    const input = {
      files: [new File([
        JSON.stringify({
          name: "启用编排的预设",
          prompts: [{ identifier: "main", name: "主 Prompt", role: "system", content: "内容" }],
          prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
        }),
      ], "preset.json", { type: "application/json" })],
      value: "preset.json",
    };

    act(() => {
      result.current.handleImportPresetJSON({
        target: input,
      } as unknown as ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1));
    const storedBundles = mocks.saveStoredSavedPresets.mock.calls[0][0];
    const storedBundle = storedBundles[storedBundles.length - 1];
    expect(storedBundle.promptPlan).toMatchObject({
      version: 1,
      mode: "composition",
      source: "sillytavern",
    });
    expect(storedBundle.promptPlan?.composition).toBeDefined();
    expect(latestSettings.promptConfig.usePromptComposition).toBe(true);
    expect(latestSettings.promptConfig.composition?.id).toBe(storedBundle.promptPlan?.composition?.id);
  });

  it("加载无版本旧预设时明确回到传统模式并生成独立迁移快照", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = true;
    initial.promptConfig.composition = {
      id: "active-composition",
      name: "当前编排",
      version: 1,
      blocks: [],
    };
    const legacyPromptConfig = {
      ...initial.promptConfig,
      mainPrompt: "旧预设主 Prompt",
      usePromptComposition: false,
      composition: {
        id: "legacy-composition",
        name: "不应恢复的旧编排",
        version: 1 as const,
        blocks: [],
      },
    };
    initial.savedPresets = [{
      id: "legacy-bundle",
      preset: { ...initial.preset, id: "legacy-preset", name: "旧预设" },
      // 模拟历史版本已写入自由编排字段的持久化数据。
      promptConfig: legacyPromptConfig as SavedPresetBundle["promptConfig"],
    }];
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert: vi.fn(async () => undefined),
        showCustomPrompt: vi.fn(async () => null),
        showCustomConfirm: vi.fn(async () => true),
      })
    );

    await act(async () => {
      await result.current.handleLoadPresetBundle("legacy-bundle");
    });

    expect(latestSettings.promptConfig.mainPrompt).toBe("旧预设主 Prompt");
    expect(latestSettings.promptConfig.usePromptComposition).toBe(false);
    expect(latestSettings.promptConfig.composition?.id).not.toBe("active-composition");
    expect(latestSettings.promptConfig.composition?.compatibility?.source).toBe("mobile-tavern-legacy");
  });

  it("加载携带编排的预设时整体切换自由编排与编排快照", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = false;
    initial.promptConfig.composition = {
      id: "before-load",
      name: "加载前编排",
      version: 1,
      blocks: [],
    };
    initial.savedPresets = [{
      id: "bundle-with-composition",
      preset: { ...initial.preset, id: "preset-with-composition", name: "带编排预设" },
      promptConfig: initial.promptConfig as SavedPresetBundle["promptConfig"],
      composition: {
        id: "preset-composition",
        name: "预设自己的编排",
        version: 1 as const,
        blocks: [
          {
            id: "block-a",
            name: "区块 A",
            enabled: true,
            role: "system" as const,
            source: { type: "template" },
            template: "A",
            order: 10,
            placement: { type: "ordered" },
          },
        ],
      },
      usePromptComposition: true,
    }];
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert: vi.fn(async () => undefined),
        showCustomPrompt: vi.fn(async () => null),
        showCustomConfirm: vi.fn(async () => true),
      })
    );

    await act(async () => {
      await result.current.handleLoadPresetBundle("bundle-with-composition");
    });

    expect(latestSettings.preset.id).toBe("preset-with-composition");
    expect(latestSettings.promptConfig.usePromptComposition).toBe(true);
    expect(latestSettings.promptConfig.composition?.id).toBe("preset-composition");
    expect(latestSettings.promptConfig.composition?.blocks[0]?.name).toBe("区块 A");
  });

  it("状态 updater 延后执行时，切换前仍先持久化当前自定义预设", async () => {
    const initial = structuredClone(DEFAULT_SETTINGS);
    const currentBundle: SavedPresetBundle = {
      id: "current-bundle",
      preset: { ...initial.preset, id: "current-preset", name: "当前自定义预设" },
      promptConfig: structuredClone(initial.promptConfig),
    };
    const targetBundle: SavedPresetBundle = {
      id: "target-bundle",
      preset: { ...initial.preset, id: "target-preset", name: "目标预设" },
      promptConfig: structuredClone(initial.promptConfig),
      isBuiltin: true,
    };
    initial.preset = currentBundle.preset;
    initial.promptConfig.mainPrompt = "切换前尚未写入 bundle 的修改";
    initial.savedPresets = [currentBundle, targetBundle];

    const queuedUpdaters: Array<(prev: UserSettings) => UserSettings> = [];
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      if (typeof next === "function") queuedUpdaters.push(next);
    });
    const { result } = renderHook(() => usePresetBundles({
      settings: initial,
      updateSettings,
      showCustomAlert: vi.fn(async () => undefined),
      showCustomPrompt: vi.fn(async () => null),
      showCustomConfirm: vi.fn(async () => true),
    }));

    await act(async () => {
      await result.current.handleLoadPresetBundle(targetBundle.id);
    });

    expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1);
    const persisted = mocks.saveStoredSavedPresets.mock.calls[0][0];
    expect(persisted.find((bundle) => bundle.id === currentBundle.id)?.promptConfig.mainPrompt)
      .toBe("切换前尚未写入 bundle 的修改");
    expect(queuedUpdaters).toHaveLength(1);
    expect(queuedUpdaters[0](initial).preset.id).toBe(targetBundle.preset.id);
  });

  it("保存新预设时携带当前自由编排状态与编排快照", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = true;
    initial.promptConfig.composition = {
      id: "save-composition",
      name: "待保存编排",
      version: 1,
      blocks: [],
    };
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: initial,
        updateSettings,
        showCustomAlert: vi.fn(async () => undefined),
        showCustomPrompt: vi.fn(async () => "新预设副本"),
        showCustomConfirm: vi.fn(async () => true),
      })
    );

    await act(async () => {
      await result.current.handleSaveNewPresetBundle();
    });

    const storedBundles = mocks.saveStoredSavedPresets.mock.calls[0][0];
    const saved = storedBundles.find(
      (bundle: SavedPresetBundle) => bundle.preset.name === "新预设副本",
    );
    expect(saved).toBeDefined();
    expect(saved?.promptPlan).toMatchObject({ version: 1, mode: "composition", source: "native" });
    expect(saved?.promptPlan?.composition?.id).toBe("save-composition");
    expect(latestSettings.promptConfig.usePromptComposition).toBe(true);
    expect(latestSettings.promptConfig.composition?.id).toBe("save-composition");
  });

  it("新增预设以 Preset Store 为准，不覆盖设置页尚未同步的预设", async () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.savedPresets = [];
    const storedExisting: SavedPresetBundle = {
      id: "stored-existing",
      preset: { ...DEFAULT_SETTINGS.preset, id: "stored-preset", name: "已保存预设" },
      promptConfig: structuredClone(DEFAULT_SETTINGS.promptConfig),
    };
    mocks.getStoredSavedPresets.mockResolvedValueOnce([storedExisting]);
    let latestSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() => usePresetBundles({
      settings: initial,
      updateSettings,
      showCustomAlert: vi.fn(async () => undefined),
      showCustomPrompt: vi.fn(async () => "新预设"),
      showCustomConfirm: vi.fn(async () => true),
    }));

    await act(async () => {
      await result.current.handleSaveNewPresetBundle();
    });

    const persisted = mocks.saveStoredSavedPresets.mock.calls[0][0] as SavedPresetBundle[];
    expect(persisted.map((bundle) => bundle.id)).toContain("stored-existing");
    expect(persisted.some((bundle) => bundle.preset.name === "新预设")).toBe(true);
    expect(latestSettings.savedPresets).toEqual(persisted);
  });
  it("imports ST order 100001, identifiers, and extended fields", async () => {
    let latestSettings = structuredClone(DEFAULT_SETTINGS);
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() => usePresetBundles({
      settings: latestSettings,
      updateSettings,
      showCustomAlert: vi.fn(async () => undefined),
      showCustomPrompt: vi.fn(async () => null),
      showCustomConfirm: vi.fn(async () => true),
    }));
    const input = {
      files: [new File([JSON.stringify({
        temperature: 1,
        openai_max_tokens: 32000,
        assistant_prefill: "思考已结束。",
        squash_system_messages: true,
        custom_stop_strings: ["User:", "<END>"],
        prompts: [
          { identifier: "main", name: "Main", role: "system", content: "MAIN", injection_order: 100 },
          { identifier: "chatHistory", name: "History", role: "user", marker: true },
          { identifier: "optional", name: "Optional", role: "user", content: "OFF", enabled: false },
        ],
        prompt_order: [
          { character_id: 100000, order: [{ identifier: "main", enabled: false }] },
          { character_id: 100001, order: [
            { identifier: "chatHistory", enabled: true },
            { identifier: "main", enabled: true },
          ] },
        ],
        extensions: { regex_scripts: [{
          id: "regex-1",
          scriptName: "Depth regex",
          findRegex: "/x/g",
          replaceString: "y",
          placement: [2],
          minDepth: 1,
          maxDepth: 9,
          substituteRegex: 0,
          trimStrings: ["trim-me"],
        }] },
      })], "st-preset.json", { type: "application/json" })],
      value: "st-preset.json",
    };

    act(() => result.current.handleImportPresetJSON({ target: input } as unknown as ChangeEvent<HTMLInputElement>));
    await waitFor(() => expect(mocks.saveStoredSavedPresets).toHaveBeenCalledTimes(1));

    expect(latestSettings.preset.maxTokens).toBe(32000);
    expect(latestSettings.promptConfig.customPrompts?.map((prompt) => prompt.identifier)).toEqual([
      "chatHistory", "main",
    ]);
    expect(latestSettings.promptConfig.customPrompts?.map((prompt) => prompt.enabled)).toEqual([
      true, true,
    ]);
    expect(latestSettings.promptConfig.customPrompts?.[0].marker).toBe(true);
    expect(latestSettings.promptConfig.customPrompts?.[1].injection_order).toBe(100);
    expect(latestSettings.presetRegexScripts?.[0]).toMatchObject({
      id: "regex-1",
      minDepth: 1,
      maxDepth: 9,
      substituteRegex: 0,
      trimStrings: ["trim-me"],
    });
    expect(latestSettings.promptConfig.usePromptComposition).toBe(true);
    expect(latestSettings.promptConfig.requestShaping).toEqual({
      enabled: true,
      mergeAdjacentMessages: false,
      squashSystemMessages: true,
      assistantPrefill: "思考已结束。",
      stopSequences: ["User:", "<END>"],
    });
    expect(latestSettings.promptConfig.composition?.blocks.map(
      (block) => block.compatibility?.originalIdentifier,
    )).toEqual(["chatHistory", "main"]);
  });

  it("正式导出入口使用自由编排顺序并剥离外部脚本", () => {
    const initial: UserSettings = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = true;
    initial.promptConfig.composition = {
      id: "export-composition",
      name: "导出编排",
      version: 1,
      blocks: [
        {
          id: "main",
          name: "Main",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "MAIN",
          order: 10,
          placement: { type: "ordered" },
          compatibility: { source: "sillytavern", originalIdentifier: "main" },
        },
        {
          id: "tail",
          name: "Tail",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "TAIL",
          order: 20,
          placement: { type: "in_chat", depth: 1, order: 5 },
          compatibility: { source: "sillytavern", originalIdentifier: "tail" },
        },
      ],
      compatibility: {
        source: "sillytavern",
        preservedRootFields: {
          extensions: {
            tavern_helper: { scripts: [{ content: "REMOTE_SCRIPT" }] },
          },
        },
      },
    };
    const saveFile = vi.fn<(fileName: string, content: string) => string>(
      () => "C:\\Download\\preset.json",
    );
    (window as unknown as {
      AndroidThemeBridge?: { saveFile: (fileName: string, content: string) => string };
    }).AndroidThemeBridge = { saveFile };
    const { result } = renderHook(() => usePresetBundles({
      settings: initial,
      updateSettings: vi.fn(),
      showCustomAlert: vi.fn(async () => undefined),
      showCustomPrompt: vi.fn(async () => null),
      showCustomConfirm: vi.fn(async () => true),
    }));

    act(() => result.current.handleExportPresetJSON());

    expect(saveFile).toHaveBeenCalledTimes(1);
    const exported = JSON.parse(saveFile.mock.calls[0][1]) as {
      prompt_order: Array<{ order: Array<{ identifier: string }> }>;
      prompts: Array<Record<string, unknown>>;
      extensions: Record<string, unknown>;
    };
    expect(exported.prompt_order[0].order.map((entry) => entry.identifier)).toEqual(["main", "tail"]);
    expect(exported.prompts[1]).toMatchObject({ injection_position: 1, injection_depth: 1 });
    expect(JSON.stringify(exported.extensions)).not.toContain("REMOTE_SCRIPT");
    expect(JSON.stringify(exported.extensions)).not.toContain("tavern_helper");
  });
});
