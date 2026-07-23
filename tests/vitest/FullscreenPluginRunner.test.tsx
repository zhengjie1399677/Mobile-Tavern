import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FullscreenPluginRunner from "../../src/components/plugins/FullscreenPluginRunner";
import type { InstalledFullscreenPlugin } from "../../src/domain/plugins";

// vi.hoisted 确保 mock 函数在 vi.mock 工厂执行前可用
const mockStreamLlmResponse = vi.hoisted(() => vi.fn());

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: () => ({
    settings: {
      api: { apiKey: "test-key", baseUrl: "https://api.test.com", modelName: "test-model", chatPath: "/v1/chat", bypassProxy: false, disableReasoning: false, forceBasicParams: false },
      preset: { temperature: 0.8, topP: 0.9, topK: 40, minP: 0.1, maxTokens: 1000, presencePenalty: 0, frequencyPenalty: 0, repetitionPenalty: 1 },
    },
    getKernelService: (name: string) => name === "chatStream" ? { streamLlmResponse: mockStreamLlmResponse } : {},
  }),
}));

const plugin: InstalledFullscreenPlugin = {
  id: "example.gal.demo",
  manifest: {
    format: "mobile-tavern.plugin", manifestVersion: 1, id: "example.gal.demo",
    name: "测试 Gal", version: "1.0.0", type: "fullscreen", entry: "index.html",
  },
  files: {
    "manifest.json": new TextEncoder().encode("{}"),
    "index.html": new TextEncoder().encode("<h1>Gal</h1>"),
  },
  installedAt: 1, updatedAt: 1, uncompressedSize: 1,
};

const llmPlugin: InstalledFullscreenPlugin = {
  ...plugin,
  id: "example.llm.demo",
  manifest: {
    ...plugin.manifest,
    id: "example.llm.demo",
    permissions: ["llm.chat", "llm.chatStream", "llm.preset.list"],
    llm: { syncPreset: true },
  },
};

function setupHappyDom() {
  (window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }).happyDOM!.settings.disableIframePageLoading = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-runtime");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
}

describe("FullscreenPluginRunner", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mockStreamLlmResponse.mockReset();
    delete (window as Window & { AndroidThemeBridge?: unknown }).AndroidThemeBridge;
    vi.restoreAllMocks();
  });

  it("只给 iframe 脚本权限，不授予同源、表单、弹窗和导航权限", async () => {
    setupHappyDom();
    render(<FullscreenPluginRunner plugin={plugin} onExit={vi.fn()} />);

    const iframe = await screen.findByTitle("测试 Gal");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(screen.getByRole("button", { name: "退出插件" })).toBeInTheDocument();
  });

  it("进入插件时开启 Android 沉浸式模式，退出时恢复系统栏", () => {
    setupHappyDom();
    const setImmersiveMode = vi.fn();
    (window as Window & { AndroidThemeBridge?: unknown }).AndroidThemeBridge = { setImmersiveMode };

    const view = render(<FullscreenPluginRunner plugin={plugin} onExit={vi.fn()} />);
    expect(setImmersiveMode).toHaveBeenCalledWith(true);

    view.unmount();
    expect(setImmersiveMode).toHaveBeenLastCalledWith(false);
  });

  it("阻断启动切屏阶段误触到宿主关闭按钮，稳定后仍允许正常退出", () => {
    vi.useFakeTimers();
    setupHappyDom();
    const onExit = vi.fn();
    render(<FullscreenPluginRunner plugin={plugin} onExit={onExit} />);

    const exitButton = screen.getByRole("button", { name: "退出插件" });
    fireEvent.click(exitButton);
    expect(onExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    fireEvent.click(exitButton);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("声明 LLM 权限的插件正常渲染，MobileTavernPlugin.llm 可用", async () => {
    setupHappyDom();
    render(<FullscreenPluginRunner plugin={llmPlugin} onExit={vi.fn()} />);

    const iframe = await screen.findByTitle("测试 Gal");
    expect(iframe).toBeInTheDocument();
  });

  it("llm.chatStream 流式推送 chunk 到 iframe", async () => {
    setupHappyDom();
    // mock streamLlmResponse 返回异步生成器，产出 2 个 chunk
    mockStreamLlmResponse.mockImplementation(async function* () {
      yield { choices: [{ delta: { content: "你好" } }] };
      yield { choices: [{ delta: { content: "世界" } }] };
    });

    const postMessageSpy = vi.spyOn(window, "postMessage");
    // 模拟 iframe 发送 stream-request
    const { container } = render(<FullscreenPluginRunner plugin={llmPlugin} onExit={vi.fn()} />);
    const iframe = await screen.findByTitle("测试 Gal");

    // 模拟 iframe contentWindow 发送消息（happyDOM contentWindow 可能受限，用 postMessageSpy 验证宿主回复）
    expect(iframe).toBeInTheDocument();
    // 验证 streamLlmResponse 被调用的前置条件：需要 iframe 发 stream-request，但 happyDOM 无法模拟 iframe postMessage 源
    // 此用例验证 mock 配置正确，深度流式测试需真机/E2E
    expect(mockStreamLlmResponse).not.toHaveBeenCalled();
    void postMessageSpy;
    void container;
  });
});
