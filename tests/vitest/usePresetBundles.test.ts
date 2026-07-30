import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SavedPresetBundle, UserSettings } from "../../src/types";

const mocks = vi.hoisted(() => ({
  saveStoredSavedPresets: vi.fn(async (_bundles: SavedPresetBundle[]): Promise<void> => undefined),
  getStoredSavedPresets: vi.fn(async (): Promise<SavedPresetBundle[]> => []),
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({
    getService: () => ({
      saveStoredSavedPresets: mocks.saveStoredSavedPresets,
      getStoredSavedPresets: mocks.getStoredSavedPresets,
    }),
  }),
}));

import { usePresetBundles } from "../../src/hooks/settings/usePresetBundles";

describe("usePresetBundles 预设导入", () => {
  beforeEach(() => {
    mocks.saveStoredSavedPresets.mockClear();
    mocks.getStoredSavedPresets.mockClear();
    mocks.getStoredSavedPresets.mockResolvedValue(
      structuredClone(DEFAULT_SETTINGS.savedPresets || []),
    );
  });

  it("导入后立即加入 savedPresets、持久化并激活", async () => {
    let latestSettings: UserSettings | undefined;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(DEFAULT_SETTINGS) : next;
    });
    const showCustomAlert = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      usePresetBundles({
        settings: DEFAULT_SETTINGS,
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
    expect(latestSettings?.preset.id).toBe(imported?.preset.id);
    expect(latestSettings?.preset.temperature).toBe(0.63);
    expect(input.value).toBe("");
    expect(showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("预设已导入")
    );
  });

  it("导入预设不覆盖或启用自由编排", async () => {
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
        showCustomConfirm: vi.fn(async () => true),
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
    expect(latestSettings.promptConfig.composition?.id).toBe("user-composition");
    expect(latestSettings.promptCompositionTemplates).toEqual(initial.promptCompositionTemplates);
    const storedBundles = mocks.saveStoredSavedPresets.mock.calls[0][0];
    const storedBundle = storedBundles[storedBundles.length - 1];
    expect(storedBundle.promptConfig).not.toHaveProperty("usePromptComposition");
    expect(storedBundle.promptConfig).not.toHaveProperty("composition");
  });

  it("加载旧预设包时忽略其中遗留的自由编排字段", () => {
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
      promptConfig: legacyPromptConfig,
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

    act(() => result.current.handleLoadPresetBundle("legacy-bundle"));

    expect(latestSettings.promptConfig.mainPrompt).toBe("旧预设主 Prompt");
    expect(latestSettings.promptConfig.usePromptComposition).toBe(true);
    expect(latestSettings.promptConfig.composition?.id).toBe("active-composition");
  });
});
