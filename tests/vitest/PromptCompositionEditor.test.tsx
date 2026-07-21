import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PromptCompositionEditor from "../../src/components/presetForm/PromptCompositionEditor";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { PromptWorkbenchFocusProvider } from "../../src/contexts/PromptWorkbenchFocusContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

interface WindowWithOrientationBridge extends Window {
  AndroidThemeBridge?: {
    setScreenOrientation?: (mode: "landscape" | "auto") => boolean;
    saveFile?: (fileName: string, content: string) => string;
    shareText?: (title: string, text: string, mimeType: string) => boolean;
  };
}

function Harness({ withPreview = false, withTwoBlocks = false }: { withPreview?: boolean; withTwoBlocks?: boolean }) {
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
      }, ...(withTwoBlocks ? [{
        id: "second-block",
        name: "第二消息",
        enabled: true,
        role: "user" as const,
        source: { type: "template" as const },
        template: "第二条",
        order: 200,
        placement: { type: "ordered" as const },
      }] : [])],
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

function ManagedFocusHarness() {
  const [active, setActive] = useState(false);
  return (
    <PromptWorkbenchFocusProvider value={{ active, managed: true, setActive }}>
      <Harness />
      <output data-testid="focus-state">{String(active)}</output>
    </PromptWorkbenchFocusProvider>
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

  it("自由编排可见控件统一使用现代高密度基元", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.getByLabelText("编排名称")).toHaveAttribute("data-prompt-control", "input");
    expect(screen.getByRole("button", { name: "自由编排" })).toHaveAttribute("data-prompt-control", "button");
    expect(document.querySelector("select")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑区块：唯一消息" }));

    expect(screen.getByRole("switch", { name: "启用区块" })).toHaveAttribute("data-prompt-control", "switch");
    expect(screen.getByRole("combobox", { name: "数据源" })).toHaveAttribute("data-prompt-control", "select");
    expect(screen.getByLabelText("区块名称")).toHaveAttribute("data-prompt-control", "input");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("新增操作使用明确文案，并创建未命名 Prompt 区块", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.getByRole("button", { name: "添加聊天历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "载入基础示例" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加 Prompt 区块" }));

    expect(screen.getByTestId("composition-state")).toHaveTextContent("未命名 Prompt 区块");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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

  it("最终预览使用统一的触屏纵向滚动且不截断单条长消息", () => {
    render(<LanguageProvider><Harness withPreview /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "预览" }));

    expect(screen.getByTestId("prompt-preview-scroll")).toHaveClass("overflow-y-auto", "touch-pan-y", "min-h-0");
    expect(screen.getByText("第一条系统消息")).not.toHaveClass("max-h-64");
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
    render(<LanguageProvider><ManagedFocusHarness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "进入横屏工作台" }));
    expect(setScreenOrientation).toHaveBeenCalledWith("landscape");
    expect(screen.getByTestId("focus-state")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "恢复自动旋转" }));
    expect(setScreenOrientation).toHaveBeenLastCalledWith("auto");
    expect(screen.getByTestId("focus-state")).toHaveTextContent("false");
  });

  it("浏览器环境不显示 Android 横屏入口", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.queryByRole("button", { name: "进入横屏工作台" })).not.toBeInTheDocument();
  });

  it("删除与排序等自由编辑可以撤销并重做", () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "删除区块" }));
    expect(screen.queryByText("唯一消息")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByText("唯一消息")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.queryByText("唯一消息")).not.toBeInTheDocument();
  });

  it("触屏拖动离开手柄后仍可把区块移动到新位置", () => {
    render(<LanguageProvider><Harness withTwoBlocks /></LanguageProvider>);
    const articles = Array.from(document.querySelectorAll<HTMLElement>("[data-prompt-block-id]"));
    vi.spyOn(articles[0], "getBoundingClientRect").mockReturnValue(rectAt(0));
    vi.spyOn(articles[1], "getBoundingClientRect").mockReturnValue(rectAt(100));

    fireEvent.pointerDown(screen.getByRole("button", { name: "拖动区块：唯一消息" }), {
      pointerId: 7,
      pointerType: "touch",
      clientY: 20,
    });
    fireEvent.pointerMove(window, { pointerId: 7, pointerType: "touch", clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 7, pointerType: "touch", clientY: 140 });

    const state = JSON.parse(screen.getByTestId("composition-state").textContent ?? "{}");
    expect(state.blocks.map((block: { id: string }) => block.id)).toEqual(["second-block", "only-block"]);
  });

  it("可通过 Android 原生桥接保存和分享模板，并复制同一份 JSON", async () => {
    const saveFile = vi.fn().mockReturnValue("Download/Mobile Tavern/editor-test.prompt-composition.json");
    const shareText = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    (window as unknown as WindowWithOrientationBridge).AndroidThemeBridge = { saveFile, shareText };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "导出 JSON" }));
    expect(saveFile).toHaveBeenCalledOnce();
    expect(saveFile.mock.calls[0][0]).toBe("编辑器测试.prompt-composition.json");

    fireEvent.click(screen.getByRole("button", { name: "复制 JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "分享 JSON" }));
    expect(shareText).toHaveBeenCalledOnce();
    expect(shareText.mock.calls[0][1]).toBe(writeText.mock.calls[0][0]);
  });

  it("导入 JSON 会替换当前编排，并可立即撤销恢复", async () => {
    const imported = JSON.stringify({
      id: "imported-composition",
      name: "导入模板",
      version: 1,
      blocks: [{
        id: "imported-block",
        name: "导入消息",
        enabled: true,
        role: "user",
        source: { type: "template" },
        template: "导入内容",
        order: 100,
        placement: { type: "ordered" },
      }],
    });
    const file = { size: imported.length, text: vi.fn().mockResolvedValue(imported) };
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.change(screen.getByLabelText("选择 Prompt 编排 JSON 文件"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByTestId("composition-state")).toHaveTextContent("导入消息"));

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByTestId("composition-state")).toHaveTextContent("唯一消息");
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

function rectAt(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 300,
    bottom: top + 80,
    width: 300,
    height: 80,
    toJSON: () => ({}),
  };
}
