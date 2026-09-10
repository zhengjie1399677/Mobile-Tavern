import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PresetSelectorSection from "../../src/components/presetForm/PresetSelectorSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { toPresetPromptConfig } from "../../src/application/useCases/presetPromptConfig";
import type { SavedPresetBundle, UserSettings } from "../../src/types";

const SAVE_LABEL = "保存修改到当前预设";
const DELETE_LABEL = "删除当前自定义预设";

function renderSection(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

function createHandlers() {
  return {
    handleImportPresetJSON: vi.fn(),
    handleExportPresetJSON: vi.fn(),
    handleSaveNewPresetBundle: vi.fn(async () => undefined),
    handleSaveCurrentPresetBundle: vi.fn(async () => undefined),
    handleLoadPresetBundle: vi.fn(async () => undefined),
    handleDeletePresetBundle: vi.fn(async () => undefined),
  };
}

describe("PresetSelectorSection", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
  });

  afterEach(() => {
    localStorage.removeItem("mobile_tavern_language");
  });

  it("内置预设不可覆盖，但保存入口会说明改用另存副本，删除保持禁用", async () => {
    const user = userEvent.setup();
    const handlers = createHandlers();
    renderSection(
      <PresetSelectorSection
        settings={DEFAULT_SETTINGS}
        activeBundleId="bundle_mobile_tavern_basic"
        isActivePresetDirty
        {...handlers}
      />,
    );

    const saveButton = screen.getByRole("button", { name: SAVE_LABEL });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveAttribute("title", expect.stringContaining("另存为"));
    await user.click(saveButton);
    expect(handlers.handleSaveCurrentPresetBundle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: DELETE_LABEL })).toBeDisabled();
  });

  it("自定义预设存在未保存修改时展示标记并可写回当前预设", async () => {
    const user = userEvent.setup();
    const handlers = createHandlers();
    const customBundle: SavedPresetBundle = {
      id: "bundle_custom",
      preset: { ...DEFAULT_SETTINGS.preset, id: "preset_custom", name: "自定义预设" },
      promptConfig: toPresetPromptConfig(DEFAULT_SETTINGS.promptConfig),
      presetRegexScripts: [],
    };
    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      preset: customBundle.preset,
      savedPresets: [...(DEFAULT_SETTINGS.savedPresets ?? []), customBundle],
    };

    renderSection(
      <PresetSelectorSection
        settings={settings}
        activeBundleId="bundle_custom"
        isActivePresetDirty
        {...handlers}
      />,
    );

    expect(screen.getByText("未保存")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: SAVE_LABEL });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(handlers.handleSaveCurrentPresetBundle).toHaveBeenCalledTimes(1);
  });

  it("没有未保存修改时不提供覆盖保存", () => {
    const customBundle: SavedPresetBundle = {
      id: "bundle_clean",
      preset: { ...DEFAULT_SETTINGS.preset, id: "preset_clean", name: "干净预设" },
      promptConfig: toPresetPromptConfig(DEFAULT_SETTINGS.promptConfig),
    };
    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      preset: customBundle.preset,
      savedPresets: [customBundle],
    };

    renderSection(
      <PresetSelectorSection
        settings={settings}
        activeBundleId="bundle_clean"
        isActivePresetDirty={false}
        {...createHandlers()}
      />,
    );

    expect(screen.queryByText("未保存")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAVE_LABEL })).toBeDisabled();
  });

  it("会话已冻结行为预设时提示修改不会立即生效", () => {
    renderSection(
      <PresetSelectorSection
        settings={DEFAULT_SETTINGS}
        activeBundleId="bundle_mobile_tavern_basic"
        isActivePresetDirty={false}
        frozenPresetName="剧本助手"
        {...createHandlers()}
      />,
    );

    expect(screen.getByText(/已冻结行为预设/)).toBeInTheDocument();
    expect(screen.getByText(/剧本助手/)).toBeInTheDocument();
  });
});
