import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MainLayout from "../../src/components/MainLayout";
import { KernelProvider } from "../../src/contexts/KernelContext";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { unifiedAppStore } from "../../src/UnifiedAppContext";
import { createKernel } from "../../src/kernel/Kernel";
import { bindRuntimeKernel } from "../../src/kernel/runtimeKernel";
import type { IExtension } from "../../src/kernel/types";
import type {
  ILocalResourceService,
  IThemeInteractionService,
} from "../../src/application/serviceContracts";
import type { TabType } from "../../src/contexts/AppContext";
import type { UserSettings } from "../../src/types";

describe("MainLayout Keep-Alive Tab Panels", () => {
  it("首次挂载仅渲染当前激活页签，切换后保留已访问页签且保持 DOM 结构", async () => {
    const CharactersMock = () => (
      <div data-testid="characters-page">
        <input data-testid="char-search-input" defaultValue="initial-search" />
      </div>
    );
    const SettingsMock = () => (
      <div data-testid="settings-page">
        <span data-testid="settings-content">Settings Loaded</span>
      </div>
    );
    const WorldbookMock = () => (
      <div data-testid="worldbook-page">Worldbook Loaded</div>
    );

    const mockTabs: Array<IExtension<React.ComponentType<Record<string, unknown>>>> = [
      { id: "characters", targetPoint: "main:tabs", priority: 100, value: CharactersMock, meta: { name: "角色", icon: "VenetianMask", showInBottomBar: true } },
      { id: "settings", targetPoint: "main:tabs", priority: 60, value: SettingsMock, meta: { name: "设置", icon: "Settings", showInBottomBar: true } },
      { id: "global-worldbook", targetPoint: "main:tabs", priority: 70, value: WorldbookMock, meta: { name: "世界书", icon: "Book", showInBottomBar: true } },
    ];

    const kernel = createKernel();
    try {
      bindRuntimeKernel(kernel);
    } catch {}

    const mockSnapshot = {
      revision: 0,
      themeId: null,
      mediaEnabled: false,
      media: {},
      surfaces: {},
      state: {},
      styleStates: [] as string[],
    };

    const themeInteractionService = {
      name: "themeInteractions",
      isCritical: false,
      init: vi.fn(),
      destroy: vi.fn(),
      activateTheme: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      getSnapshot: vi.fn(() => mockSnapshot),
      setEnvironment: vi.fn(),
      deactivateTheme: vi.fn(),
      dispatch: vi.fn(),
    } satisfies IThemeInteractionService;
    await kernel.registerService("themeInteractions", themeInteractionService);

    const localResourceService = {
      name: "localResources",
      isCritical: false,
      init: vi.fn(),
      destroy: vi.fn(),
      listResources: vi.fn(async () => []),
      importFile: vi.fn(async () => { throw new Error("测试未实现导入"); }),
      deleteResource: vi.fn(async () => undefined),
      getObjectUrl: vi.fn(async () => ""),
      getResourceReference: vi.fn((id: string) => `local-resource://${id}`),
      resolveResourceReference: vi.fn(async () => ""),
      getCssReference: vi.fn((id: string) => `url(\"local-resource://${id}\")`),
    } satisfies ILocalResourceService;
    await kernel.registerService("localResources", localResourceService);

    mockTabs.forEach((tab) => kernel.registerExtension(tab));

    unifiedAppStore.setState({
      activeTab: "characters",
      setActiveTab: (tab: TabType) => unifiedAppStore.setState({ activeTab: tab }),
      safeAreas: { top: 0, bottom: 0 },
      settings: { hiddenMainTabs: [] } as unknown as UserSettings,
      currentTheme: "obsidian",
      runningPlugin: undefined,
      charModalOpen: false,
      timelineModalOpen: false,
      showSessionManager: false,
    });

    function Harness() {
      return (
        <LanguageProvider>
          <KernelProvider kernel={kernel}>
            <MainLayout />
          </KernelProvider>
        </LanguageProvider>
      );
    }

    render(<Harness />);

    // 1. 首次挂载：只有 characters panel 存在并可见
    const charPanel = document.getElementById("main-tabpanel-characters");
    expect(charPanel).toBeInTheDocument();
    expect(charPanel?.getAttribute("aria-label")).toMatch(/Characters|角色/);
    expect(charPanel?.style.display).not.toBe("none");

    // 未访问的 settings 和 worldbook 未挂载
    expect(document.getElementById("main-tabpanel-settings")).not.toBeInTheDocument();
    expect(document.getElementById("main-tabpanel-global-worldbook")).not.toBeInTheDocument();

    // 在角色页修改输入框内容
    const searchInput = screen.getByTestId("char-search-input") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "search-keyword" } });
    expect(searchInput.value).toBe("search-keyword");

    // 2. 点击切换至设置页
    const settingsTabBtn = screen.getByRole("tab", { name: /Settings|设置/i });
    expect(settingsTabBtn).toHaveAttribute("aria-controls", "main-tabpanel-settings");
    fireEvent.click(settingsTabBtn);

    // 设置页此时被挂载并可见
    const settingsPanel = document.getElementById("main-tabpanel-settings");
    expect(settingsPanel).toBeInTheDocument();
    expect(settingsPanel?.style.display).not.toBe("none");
    expect(screen.getByTestId("settings-content")).toBeInTheDocument();

    // 角色页依然存在于 DOM 中（未被销毁 Unmount），但处于 display: none
    expect(charPanel).toBeInTheDocument();
    expect(charPanel?.style.display).toBe("none");

    // 3. 点击切回角色页
    const charactersTabBtn = screen.getByRole("tab", { name: /Characters|角色/i });
    fireEvent.click(charactersTabBtn);

    // 角色页恢复可见，且输入框内容状态完整保留！
    expect(charPanel?.style.display).not.toBe("none");
    expect((screen.getByTestId("char-search-input") as HTMLInputElement).value).toBe("search-keyword");

    // 设置页保留在 DOM 中处于隐藏态
    expect(settingsPanel?.style.display).toBe("none");

    // 4. 未被点击过的 worldbook 依然未被提前挂载
    expect(document.getElementById("main-tabpanel-global-worldbook")).not.toBeInTheDocument();
  });
});
