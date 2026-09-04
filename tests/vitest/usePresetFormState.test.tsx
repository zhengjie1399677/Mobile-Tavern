import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { usePresetFormState } from "../../src/components/presetForm/usePresetFormState";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

function Wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

describe("usePresetFormState 提示词批量删除", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
  });

  it("按自定义词条 identifier 删除对应自由编排区块", async () => {
    const initial = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.customPrompts = [{
      id: "prompt-row-id",
      identifier: "external-prompt-identifier",
      name: "外部提示词",
      role: "system",
      content: "不应继续发送",
      enabled: true,
    }];
    initial.promptConfig.usePromptComposition = true;
    initial.promptConfig.composition = {
      id: "external-composition",
      name: "外部编排",
      version: 1,
      blocks: [{
        id: "st_external-prompt-identifier",
        name: "外部提示词",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "不应继续发送",
        order: 100,
        placement: { type: "ordered" },
        compatibility: {
          source: "sillytavern",
          originalIdentifier: "external-prompt-identifier",
        },
      }],
    };

    let latestSettings: UserSettings = initial;
    const updateSettings = vi.fn((next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      latestSettings = typeof next === "function" ? next(latestSettings) : next;
    });
    const { result } = renderHook(() => usePresetFormState({
      settings: initial,
      updateSettings,
      showCustomConfirm: vi.fn(async () => true),
      showCustomAlert: vi.fn(async () => undefined),
      activeCharacter: null,
      saveCharacter: vi.fn(async () => undefined),
    }), { wrapper: Wrapper });

    act(() => {
      result.current.setSelectedPromptIds(["prompt-row-id"]);
    });
    await act(async () => {
      await result.current.handleBatchDeletePrompts();
    });

    expect(latestSettings.promptConfig.customPrompts).toEqual([]);
    expect(latestSettings.promptConfig.composition?.blocks).toEqual([]);
  });
});
