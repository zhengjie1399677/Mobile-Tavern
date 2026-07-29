import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

const mocks = vi.hoisted(() => ({
  saveStoredSavedPresets: vi.fn(async () => undefined),
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({
    getService: () => ({
      saveStoredSavedPresets: mocks.saveStoredSavedPresets,
    }),
  }),
}));

import { usePresetBundles } from "../../src/hooks/settings/usePresetBundles";

describe("usePresetBundles 预设导入", () => {
  beforeEach(() => {
    mocks.saveStoredSavedPresets.mockClear();
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
      expect.stringContaining("解析导入并保存成功")
    );
  });
});
