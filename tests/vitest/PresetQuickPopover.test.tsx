import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresetQuickPopover } from "../../src/tabs/chat/composer-panels/PresetQuickPopover";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

const mockState = vi.hoisted(() => ({
  settings: null as UserSettings | null,
  listeners: new Set<() => void>(),
}));

vi.mock("../../src/UnifiedAppContext", async () => {
  const React = await import("react");
  return {
    useUnifiedApp: (selector?: (value: unknown) => unknown) => {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((tick) => tick + 1);
        mockState.listeners.add(listener);
        return () => {
          mockState.listeners.delete(listener);
        };
      }, []);
      if (!mockState.settings) {
        throw new Error("Harness not initialized");
      }
      const value = {
        settings: mockState.settings,
        updateSettings: (next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
          if (!mockState.settings) return;
          mockState.settings = typeof next === "function" ? next(mockState.settings) : next;
          for (const listener of mockState.listeners) {
            listener();
          }
        },
        handleLoadPresetBundle: vi.fn(async () => undefined),
        handleToggleCustomPrompt: vi.fn(),
      };
      return selector ? selector(value) : value;
    },
  };
});

vi.mock("../../src/hooks/useMobileBackHandler", () => ({
  useMobileBackHandler: vi.fn(),
}));

describe("PresetQuickPopover 主/规则提示词快捷开关稳定性", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
    mockState.settings = null;
    mockState.listeners.clear();
  });

  it("关闭系统提示词与规则提示词后条目留在原地，可随时重新开启", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "系统核心设定";
    settings.promptConfig.useMainPrompt = true;
    settings.promptConfig.jailbreakPrompt = "越狱规则设定";
    settings.promptConfig.useJailbreak = true;
    mockState.settings = settings;

    render(
      <LanguageProvider>
        <PresetQuickPopover open={true} onOpenChange={vi.fn()} />
      </LanguageProvider>,
    );

    const mainSwitch = screen.getByRole("switch", { name: /系统提示词/ });
    const jailSwitch = screen.getByRole("switch", { name: /规则提示词/ });
    expect(mainSwitch).toBeChecked();
    expect(jailSwitch).toBeChecked();

    fireEvent.click(mainSwitch);
    fireEvent.click(jailSwitch);

    expect(screen.getByRole("switch", { name: /系统提示词/ })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /规则提示词/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole("switch", { name: /系统提示词/ }));
    expect(screen.getByRole("switch", { name: /系统提示词/ })).toBeChecked();
  });
});
