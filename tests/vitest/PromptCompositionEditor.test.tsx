import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PromptCompositionEditor from "../../src/components/presetForm/PromptCompositionEditor";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

function Harness() {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const initial = structuredClone(DEFAULT_SETTINGS);
    initial.promptConfig.usePromptComposition = true;
    initial.promptConfig.composition = {
      id: "editor-test",
      name: "编辑器测试",
      version: 1,
      blocks: [{
        id: "only-block",
        name: "唯一消息",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "可删除",
        order: 100,
        placement: { type: "ordered" },
      }],
    };
    return initial;
  });
  return <PromptCompositionEditor settings={settings} updateSettings={setSettings} />;
}

describe("PromptCompositionEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === "mobile_tavern_language" ? "zh-CN" : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("允许删除最后一个区块，并把空编排保留为合法状态", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "删除区块" }));

    expect(screen.getByText("当前为空编排，这是合法状态，不会隐式注入内容。")).toBeInTheDocument();
    expect(screen.queryByText("唯一消息")).not.toBeInTheDocument();
  });
});
