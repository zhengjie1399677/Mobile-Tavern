import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PromptCompositionEditor from "../../src/components/presetForm/PromptCompositionEditor";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

interface WindowWithOrientationBridge extends Window {
  AndroidThemeBridge?: {
    setScreenOrientation: (mode: "landscape" | "auto") => boolean;
  };
}

function Harness({ withPreview = false }: { withPreview?: boolean }) {
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
  return (
    <>
      <PromptCompositionEditor
        settings={settings}
        updateSettings={setSettings}
        preview={withPreview ? {
          messages: [
            { role: "system", content: "第一条系统消息" },
            { role: "user", content: "第二条用户消息" },
          ],
          diagnostics: [{ code: "test_notice", level: "warning", message: "测试诊断" }],
          estimatedTokens: 12,
          contextAvailable: true,
        } : undefined}
      />
      <output data-testid="composition-state">
        {JSON.stringify(settings.promptConfig.composition)}
      </output>
    </>
  );
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
    stubWideViewport(false);
    delete (window as unknown as WindowWithOrientationBridge).AndroidThemeBridge;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("允许删除最后一个区块，并把空编排保留为合法状态", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "删除区块" }));

    expect(screen.getByText("当前将发送 0 条消息。系统不会自动补充 Prompt，部分 API 可能拒绝空请求。")).toBeInTheDocument();
    expect(screen.queryByText("唯一消息")).not.toBeInTheDocument();
  });

  it("使用明确的模式选择，并在底部编辑面板中修改区块", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.getByRole("button", { name: "传统 Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自由编排" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "编辑区块：唯一消息" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "编辑 Prompt 区块" })).toBeInTheDocument();
  });

  it("可搜索并在光标处插入数据源宏", async () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "编辑区块：唯一消息" }));
    fireEvent.click(await screen.findByRole("button", { name: "插入数据源" }));
    fireEvent.change(await screen.findByPlaceholderText("搜索数据源"), { target: { value: "角色描述" } });
    fireEvent.click(await screen.findByRole("button", { name: /角色描述/ }));

    expect(screen.getByTestId("composition-state")).toHaveTextContent("{{character.description}}");
  });

  it("按最终顺序展示真实编译消息与诊断", () => {
    render(<LanguageProvider><Harness withPreview /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "预览" }));

    expect(screen.getByRole("heading", { name: "最终 messages 预览" })).toBeInTheDocument();
    expect(screen.getByText("2 条消息")).toBeInTheDocument();
    expect(screen.getByText("约 12 Token")).toBeInTheDocument();
    expect(screen.getByText("第一条系统消息")).toBeInTheDocument();
    expect(screen.getByText("第二条用户消息")).toBeInTheDocument();
    expect(screen.getByText("测试诊断")).toBeInTheDocument();
  });

  it("宽屏时同时展示区块配置与可视化工作台", () => {
    stubWideViewport(true);
    render(<LanguageProvider><Harness withPreview /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "编辑区块：唯一消息" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const wideEditor = screen.getByRole("region", { name: "宽屏区块配置" });
    expect(wideEditor).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Prompt 可视化工作台" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "图中区块：唯一消息" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(within(wideEditor).getByLabelText("区块名称"), { target: { value: "横屏改名" } });
    expect(screen.getByRole("button", { name: "图中区块：横屏改名" })).toBeInTheDocument();
    expect(screen.getByTestId("composition-state")).toHaveTextContent("横屏改名");
  });

  it("宽屏工作台可在编排图与最终消息之间切换", () => {
    stubWideViewport(true);
    render(<LanguageProvider><Harness withPreview /></LanguageProvider>);

    const workbench = screen.getByRole("region", { name: "Prompt 可视化工作台" });
    expect(within(workbench).getByRole("button", { name: "编排图" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(workbench).getByRole("button", { name: "最终预览" }));

    expect(screen.getByText("第一条系统消息")).toBeInTheDocument();
    expect(screen.getByText("第二条用户消息")).toBeInTheDocument();
  });

  it("窄屏可从工具栏打开只读编排图并定位区块", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "编排图" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "图中区块：唯一消息" }));

    expect(screen.getByRole("heading", { name: "编辑 Prompt 区块" })).toBeInTheDocument();
  });

  it("仅在 Android 原生桥接可用时展示横屏入口", () => {
    const setScreenOrientation = vi.fn().mockReturnValue(true);
    (window as unknown as WindowWithOrientationBridge).AndroidThemeBridge = { setScreenOrientation };
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "进入横屏工作台" }));
    expect(setScreenOrientation).toHaveBeenCalledWith("landscape");
    fireEvent.click(screen.getByRole("button", { name: "恢复自动旋转" }));
    expect(setScreenOrientation).toHaveBeenLastCalledWith("auto");
  });

  it("浏览器环境不显示 Android 横屏入口", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.queryByRole("button", { name: "进入横屏工作台" })).not.toBeInTheDocument();
  });
});

function stubWideViewport(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
    matches,
    media: "(min-width: 700px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}
