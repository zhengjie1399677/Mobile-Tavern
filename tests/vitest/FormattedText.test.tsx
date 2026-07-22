import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FormattedText from "../../src/components/FormattedText";
import type { CharacterCard } from "../../src/types";

const mockSettings = {
  enableHtmlRendering: true,
  enableScriptExecution: false,
  enableLoopProtection: true,
  enableAsteriskFormatting: false,
  globalRegexScripts: [],
  presetRegexScripts: [],
};

const mockContext: {
  settings: typeof mockSettings;
  activeCharacter: Partial<CharacterCard> | null;
} = {
  settings: mockSettings,
  activeCharacter: null,
};

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: () => mockContext,
}));

describe("FormattedText component", () => {
  beforeEach(() => {
    mockContext.settings = {
      enableHtmlRendering: true,
      enableScriptExecution: false,
      enableLoopProtection: true,
      enableAsteriskFormatting: false,
      globalRegexScripts: [],
      presetRegexScripts: [],
    };
    mockContext.activeCharacter = null;
  });

  it("should render normal text correctly", () => {
    render(<FormattedText text="Hello world" charName="Bot" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("不把内部 data-th-srcdoc-id 误报为未提取的 srcdoc", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const iframe = '<iframe id="TH-msg-iframe-0-0" name="TH-msg-iframe-0-0" data-th-srcdoc-id="th-srcdoc-TH-msg-iframe-0-0-1784713021718" style="width: 100%; min-height: 0; border: none; display: block; background: transparent;"></iframe>';

    render(<FormattedText text={iframe} charName="Bot" />);

    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes("srcdoc present but regex MISSED"),
      ),
    ).toBe(false);
    errorSpy.mockRestore();
  });

  it("继续提取角色卡直接提供的 srcdoc 内容", () => {
    mockContext.settings.enableScriptExecution = true;
    const { container } = render(
      <FormattedText
        text={'<iframe srcdoc="&lt;script&gt;window.__TH_MESSAGE_ID=0;&lt;/script&gt;&lt;div data-testid=&#39;card-body&#39;&gt;扬州&lt;/div&gt;"></iframe>'}
        charName="Bot"
      />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.srcdoc).toContain("data-testid='card-body'");
    expect(iframe?.srcdoc).toContain("扬州");
    expect(iframe?.getAttribute("allowtransparency")).toBe("true");
  });

  it("should render bold text inside strong tags", () => {
    render(<FormattedText text="Hello **world**" charName="Bot" />);
    const strongEl = screen.getByText("world");
    expect(strongEl.tagName).toBe("STRONG");
    expect(strongEl).toHaveClass("font-bold");
  });

  it("should render italic text with default styling when enableAsteriskFormatting is false", () => {
    mockContext.settings.enableAsteriskFormatting = false;
    render(<FormattedText text="*sigh* Hello" charName="Bot" />);
    const italicEl = screen.getByText("sigh");
    expect(italicEl.tagName).toBe("SPAN");
    expect(italicEl).toHaveClass("italic");
    expect(italicEl).toHaveClass("text-[inherit]");
    expect(italicEl).not.toHaveClass("text-muted-foreground/80");
  });

  it("should render italic text with grey styling when enableAsteriskFormatting is true globally", () => {
    mockContext.settings.enableAsteriskFormatting = true;
    render(<FormattedText text="*sigh* Hello" charName="Bot" />);
    const italicEl = screen.getByText("sigh");
    expect(italicEl.tagName).toBe("SPAN");
    expect(italicEl).toHaveClass("italic");
    expect(italicEl).toHaveClass("text-muted-foreground/80");
  });

  it("should respect character-level visualSettings override when activeCharacter defines enableAsteriskFormatting", () => {
    // Global setting is false, but activeCharacter visualSettings is true
    mockContext.settings.enableAsteriskFormatting = false;
    mockContext.activeCharacter = {
      id: "char-1",
      name: "Bot",
      visualSettings: {
        enableAsteriskFormatting: true,
      },
    };
    render(<FormattedText text="*sigh* Hello" charName="Bot" />);
    const italicEl = screen.getByText("sigh");
    expect(italicEl.tagName).toBe("SPAN");
    expect(italicEl).toHaveClass("text-muted-foreground/80");
  });

  it("should respect character-level visualSettings override when activeCharacter disables enableAsteriskFormatting explicitly", () => {
    // Global setting is true, but activeCharacter visualSettings is false
    mockContext.settings.enableAsteriskFormatting = true;
    mockContext.activeCharacter = {
      id: "char-1",
      name: "Bot",
      visualSettings: {
        enableAsteriskFormatting: false,
      },
    };
    render(<FormattedText text="*sigh* Hello" charName="Bot" />);
    const italicEl = screen.getByText("sigh");
    expect(italicEl.tagName).toBe("SPAN");
    expect(italicEl).toHaveClass("text-[inherit]");
  });

  it("should render nested bold text within italic asterisks correctly", () => {
    mockContext.settings.enableAsteriskFormatting = true;
    const { container } = render(
      <FormattedText text="*sigh, looking at your **eyes**.*" charName="Bot" />
    );
    // 整个段落应该被渲染为 italic 的 span
    const italicEl = container.querySelector(".italic");
    expect(italicEl).toBeInTheDocument();
    expect(italicEl).toHaveClass("text-muted-foreground/80");

    // 内部应该有 strong 标签包裹 eyes 字符
    const boldEl = container.querySelector("strong");
    expect(boldEl).toBeInTheDocument();
    expect(boldEl?.textContent).toBe("eyes");
    expect(boldEl).toHaveClass("font-bold");
  });

  it("should render complex nested italic and bold ending with *** correctly", () => {
    mockContext.settings.enableAsteriskFormatting = true;
    const { container } = render(
      <FormattedText text='*He nods, **"Yes, I will."***' charName="Bot" />
    );
    const italicEl = container.querySelector(".italic");
    expect(italicEl).toBeInTheDocument();
    expect(italicEl).toHaveClass("text-muted-foreground/80");

    const boldEl = container.querySelector("strong");
    expect(boldEl).toBeInTheDocument();
    expect(boldEl?.textContent).toBe('"Yes, I will."');
  });
});
