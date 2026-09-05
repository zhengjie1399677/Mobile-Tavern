import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SavedPresetBundle, UserSettings } from "../../src/types";

const mocks = vi.hoisted(() => ({ save: vi.fn(async (_bundles: SavedPresetBundle[]) => undefined) }));
vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({ hasService: () => false, getService: () => ({ saveStoredSavedPresets: mocks.save }) }),
}));
import { usePresetBundles } from "../../src/hooks/settings/usePresetBundles";
beforeEach(() => mocks.save.mockReset().mockResolvedValue(undefined));

function setup() {
  const initial = structuredClone(DEFAULT_SETTINGS);
  initial.preset = { ...initial.preset, id: "current-custom" };
  initial.savedPresets = [
    { id: "current-bundle", preset: initial.preset, promptConfig: structuredClone(initial.promptConfig) },
    { id: "target-bundle", preset: { ...initial.preset, id: "target" }, promptConfig: structuredClone(initial.promptConfig) },
  ];
  let releaseSave!: () => void;
  mocks.save.mockImplementationOnce(() => new Promise<undefined>(resolve => { releaseSave = () => resolve(undefined); }));
  const hook = renderHook(() => {
    const [settings, updateSettings] = useState<UserSettings>(initial);
    const actions = usePresetBundles({ settings, updateSettings, showCustomAlert: vi.fn(),
      showCustomPrompt: vi.fn(async () => null), showCustomConfirm: vi.fn(async () => true) });
    return { settings, updateSettings, ...actions };
  });
  return { ...hook, release: () => releaseSave() };
}

it("等待保存期间修改 API 地址不会被旧设置快照覆盖", async () => {
  const { result, release } = setup();
  const pending = result.current.handleLoadPresetBundle("target-bundle");
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  act(() => result.current.updateSettings(prev => ({ ...prev, api: { ...prev.api, baseUrl: "https://updated.invalid/v1" } })));
  await act(async () => { release(); await pending; });
  expect(result.current.settings.api.baseUrl).toBe("https://updated.invalid/v1");
  expect(result.current.settings.preset.id).toBe("target");
});

it("保存期间新增提示词编辑时保留当前预设与最新正文", async () => {
  const { result, release } = setup();
  const pending = result.current.handleLoadPresetBundle("target-bundle");
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  act(() => result.current.updateSettings(prev => ({ ...prev, promptConfig: { ...prev.promptConfig, mainPrompt: "保存中的新编辑" } })));
  await act(async () => { release(); await pending; });
  expect(result.current.settings.preset.id).toBe("current-custom");
  expect(result.current.settings.promptConfig.mainPrompt).toBe("保存中的新编辑");
});

it("连续切换串行执行，最后一次选择生效且不回退已保存内容", async () => {
  const { result, release } = setup();
  const first = result.current.handleLoadPresetBundle("target-bundle");
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const second = result.current.handleLoadPresetBundle("current-bundle");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => { release(); await first; await second; });
  expect(result.current.settings.preset.id).toBe("current-custom");
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
