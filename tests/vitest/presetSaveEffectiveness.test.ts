import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_SETTINGS, MOBILE_TAVERN_BASIC_PRESET_BUNDLE } from "../../src/hooks/settings/defaults";
import { usePresetBundles } from "../../src/hooks/settings/usePresetBundles";
import {
  isPresetBundleInSync,
  resolveActivePresetBundle,
  buildPresetBundleSnapshot,
} from "../../src/application/useCases/presetBundleLifecycle";
import { resolveAgentSessionSettings } from "../../src/application/useCases/resolveAgentSessionSettings";
import { requirePresetBundle } from "../../src/domain/presets/bundleMigration";
import type { PresetBundle } from "../../src/domain/presets/contracts";
import type { UserSettings } from "../../src/types";

const mocks = vi.hoisted(() => ({
  saveStoredSavedPresets: vi.fn(async (_bundles: PresetBundle[]): Promise<void> => undefined),
  getStoredSavedPresets: vi.fn(async (): Promise<PresetBundle[]> => []),
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({
    hasService: () => false,
    getService: () => ({
      saveStoredSavedPresets: mocks.saveStoredSavedPresets,
      getStoredSavedPresets: mocks.getStoredSavedPresets,
    }),
  }),
}));

describe("预设修改与生效闭环 (Preset Save Effectiveness)", () => {
  it("滑动调节采样参数后，活跃预设不脱钩，脏检查变为 true，可保存且生效", async () => {
    const customBundle = buildPresetBundleSnapshot(
      {
        preset: {
          ...DEFAULT_SETTINGS.preset,
          id: "preset_my_creative",
          name: "我的创意预设",
          temperature: 0.7,
        },
        promptConfig: DEFAULT_SETTINGS.promptConfig,
        presetRegexScripts: [],
      },
      { id: "bundle_my_creative" },
    );

    let currentSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      preset: { ...DEFAULT_SETTINGS.preset, ...customBundle.sampler },
      savedPresets: [MOBILE_TAVERN_BASIC_PRESET_BUNDLE, customBundle],
    };

    mocks.getStoredSavedPresets.mockResolvedValue(currentSettings.savedPresets || []);

    const updateSettings = vi.fn((updater: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      currentSettings = typeof updater === "function" ? updater(currentSettings) : updater;
    });

    const { result, rerender } = renderHook(
      ({ settings }) =>
        usePresetBundles({
          settings,
          updateSettings,
          showCustomAlert: vi.fn(async () => undefined),
          showCustomPrompt: vi.fn(async () => null),
          showCustomConfirm: vi.fn(async () => true),
        }),
      { initialProps: { settings: currentSettings } },
    );

    // 初始状态：未脏
    expect(result.current.isActivePresetDirty).toBe(false);

    // 模拟用户拖动温度滑块至 1.15（保留预设 ID，不赋 "custom"）
    act(() => {
      updateSettings((prev) => ({
        ...prev,
        preset: {
          ...prev.preset,
          temperature: 1.15,
        },
      }));
    });

    rerender({ settings: currentSettings });

    // 验证：活跃预设依然正确定位，未脱钩成 undefined 或 ""
    const activeBundle = resolveActivePresetBundle(currentSettings.savedPresets, currentSettings.preset);
    expect(activeBundle?.id).toBe("bundle_my_creative");

    // 验证：脏检查变为 true
    expect(result.current.isActivePresetDirty).toBe(true);

    // 模拟用户点击保存修改到当前预设
    await act(async () => {
      await result.current.handleSaveCurrentPresetBundle();
    });

    // 验证：已持久化并写回 savedPresets
    expect(mocks.saveStoredSavedPresets).toHaveBeenCalled();
    const savedInStore = mocks.saveStoredSavedPresets.mock.calls[0][0] as PresetBundle[];
    const updatedCustom = savedInStore.find((b) => b.id === "bundle_my_creative");
    expect(updatedCustom?.sampler.temperature).toBe(1.15);

    // 重新渲染后验证已同步（脏检查变为 false）
    rerender({ settings: currentSettings });
    expect(result.current.isActivePresetDirty).toBe(false);

    // 验证：在绑定了该预设的会话中，resolveAgentSessionSettings 读取到修改后的采样
    const sessionSnapshot = {
      profileId: "profile_test",
      profileVersion: 1,
      pluginVersions: {},
      providerBindings: {},
      contributionOrder: {},
      capabilityDecisions: {
        "agent.profile.settings": {
          toolMounts: [],
          promptPresetId: "bundle_my_creative",
        },
      },
    };

    const resolved = resolveAgentSessionSettings(currentSettings, sessionSnapshot);
    expect(resolved.preset.temperature).toBe(1.15);
  });

  it("历史脏数据 preset.id === 'custom' 能自动恢复匹配并允许正常修改与保存", () => {
    const customBundle = requirePresetBundle({
      id: "bundle_migrated",
      preset: {
        ...DEFAULT_SETTINGS.preset,
        id: "preset_migrated",
        name: "被赋custom的历史预设",
        temperature: 0.8,
      },
      promptConfig: DEFAULT_SETTINGS.promptConfig,
    });

    const savedPresets = [MOBILE_TAVERN_BASIC_PRESET_BUNDLE, customBundle];
    const corruptedPreset = {
      ...DEFAULT_SETTINGS.preset,
      id: "custom",
      name: "被赋custom的历史预设",
      temperature: 0.8,
    };

    // 验证：resolveActivePresetBundle 能够通过名称恢复匹配到原预设
    const matched = resolveActivePresetBundle(savedPresets, corruptedPreset);
    expect(matched?.id).toBe("bundle_migrated");
    expect(matched?.sampler.id).toBe("preset_migrated");
  });
});
