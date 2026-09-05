import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedAppContextProps } from "../../src/UnifiedAppContext";
import WorkbenchTab from "../../src/tabs/WorkbenchTab";
import { HostCalendarWidget } from "../../src/components/workbench/HostCalendarWidget";
import { RussellMoodCompassWidget } from "../../src/components/workbench/RussellMoodCompassWidget";
import { ActivityRingsOrbitWidget } from "../../src/components/workbench/ActivityRingsOrbitWidget";
import { TrendSparklineWaveWidget } from "../../src/components/workbench/TrendSparklineWaveWidget";
import { HostStorageMetricsWidget } from "../../src/components/workbench/HostStorageMetricsWidget";
import { ToolCapabilitiesWidget } from "../../src/components/workbench/ToolCapabilitiesWidget";

const { reloadToolRuntime, setToolPluginEnabled } = vi.hoisted(() => ({
  reloadToolRuntime: vi.fn().mockResolvedValue(undefined),
  setToolPluginEnabled: vi.fn().mockResolvedValue(undefined),
}));

// Mock useUnifiedApp
vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: <T,>(selector: (state: UnifiedAppContextProps) => T): T =>
    selector({
      sessions: [
        {
          id: "session-1",
          name: "Test Session",
          messages: [
            { id: "m1", sender: "user", content: "Hello", timestamp: Date.now() },
            { id: "m2", sender: "assistant", content: "Hi there!", timestamp: Date.now() },
          ],
        },
      ],
      totalSessionCount: 1,
      isDBReady: true,
      characters: [{ id: "char-1", name: "Test Char" }],
      showCustomAlert: vi.fn(),
      showCustomConfirm: vi.fn(),
      showCustomPrompt: vi.fn(),
      getKernelService: vi.fn(() => ({ reload: reloadToolRuntime })),
    } as unknown as UnifiedAppContextProps),
}));

// Mock toolPluginManagementUseCases
vi.mock("../../src/application/useCases/toolPluginManagementUseCases", () => ({
  toolPluginManagementUseCases: {
    list: vi.fn().mockResolvedValue([
      {
        id: "test.plugin",
        enabled: true,
        manifest: {
          name: "Test Search Plugin",
          version: "1.0.0",
          description: "A test external search plugin",
        },
        sourceVerification: { trustLevel: "official" },
      },
    ]),
    setEnabled: setToolPluginEnabled,
  },
}));

describe("WorkbenchTab (宿主工作台)", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadToolRuntime.mockClear();
    setToolPluginEnabled.mockClear();
  });

  it("应该正确挂载工作台与其核心纯可视化小组件", () => {
    render(<WorkbenchTab />);
    expect(screen.getByText("宿主工作台")).toBeInTheDocument();
    expect(screen.getByText("Host Engine Ready")).toBeInTheDocument();
    expect(screen.getByText("LOCAL TIME")).toBeInTheDocument();
  });

  it("日历热力矩阵能够正常渲染并支持切换今天", () => {
    render(<HostCalendarWidget />);
    expect(screen.getByText("已载入活跃热力与心相色谱")).toBeInTheDocument();
    expect(screen.getByText("今天")).toBeInTheDocument();

    const todayBtn = screen.getByText("今天");
    fireEvent.click(todayBtn);
    expect(todayBtn).toBeInTheDocument();
  });

  it("心智气象罗盘组件能够正常渲染极坐标象限与定锚星核", () => {
    render(<RussellMoodCompassWidget />);
    expect(screen.getByText("心智气象罗盘")).toBeInTheDocument();
    expect(screen.getByText("极坐标双轴心相定锚")).toBeInTheDocument();
    expect(screen.getAllByText("充沛 · 灵感").length).toBeGreaterThan(0);
    expect(screen.getByText("宁静 · 自洽")).toBeInTheDocument();
  });

  it("活跃流光罗盘能正常渲染双环与昼夜时相盘", () => {
    render(<ActivityRingsOrbitWidget />);
    expect(screen.getByText("宿主活跃脉搏")).toBeInTheDocument();
    expect(screen.getByText("已载入交互")).toBeInTheDocument();
    expect(screen.getByText("已载入会话")).toBeInTheDocument();
    expect(screen.getByText("24H 昼夜分布")).toBeInTheDocument();
  });

  it("7日活跃波形图组件能正常渲染平滑流光波形", () => {
    render(<TrendSparklineWaveWidget />);
    expect(screen.getByText("已载入的 7 日活跃波形")).toBeInTheDocument();
    expect(screen.getByText("近一周已载入")).toBeInTheDocument();
  });

  it("本地存储指标组件能正常展示会话与实体统计", () => {
    render(<HostStorageMetricsWidget />);
    expect(screen.getByText("本地存储与持久化")).toBeInTheDocument();
    expect(screen.getByText("浏览器存储容量估算")).toBeInTheDocument();
    expect(screen.getByText("未检测")).toBeInTheDocument();
  });

  it("损坏的心相缓存不会阻断工作台渲染", () => {
    localStorage.setItem("mobile_tavern_workbench_moods_v1", "null");
    render(<HostCalendarWidget />);
    expect(screen.getByText("已载入活跃热力与心相色谱")).toBeInTheDocument();
  });

  it("同页写入心相后会同步刷新日历", async () => {
    render(<HostCalendarWidget />);
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    localStorage.setItem("mobile_tavern_workbench_moods_v1", JSON.stringify({
      [dateKey]: { x: -0.5, y: -0.5, updatedAt: Date.now() },
    }));
    window.dispatchEvent(new Event("mobileTavernWorkbenchMoodChanged"));
    expect(await screen.findByText("疲惫 · 虚耗")).toBeInTheDocument();
  });

  it("切换工具插件后会同步重载运行时", async () => {
    render(<ToolCapabilitiesWidget />);
    fireEvent.click(await screen.findByRole("button", { name: "关闭 Test Search Plugin" }));
    await waitFor(() => {
      expect(setToolPluginEnabled).toHaveBeenCalledWith("test.plugin", false);
      expect(reloadToolRuntime).toHaveBeenCalledTimes(1);
    });
  });
});
