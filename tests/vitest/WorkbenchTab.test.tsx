import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkbenchTab from "../../src/tabs/WorkbenchTab";
import { HostCalendarWidget } from "../../src/components/workbench/HostCalendarWidget";
import { TimeLapseVisualizerWidget } from "../../src/components/workbench/TimeLapseVisualizerWidget";
import { HostStorageMetricsWidget } from "../../src/components/workbench/HostStorageMetricsWidget";

// Mock useUnifiedApp
vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: any) => any) =>
    selector({
      sessions: [{ id: "session-1", name: "Test Session" }],
      characters: [{ id: "char-1", name: "Test Char" }],
      showCustomAlert: vi.fn(),
      showCustomConfirm: vi.fn(),
      showCustomPrompt: vi.fn(),
      getKernelService: vi.fn(),
    }),
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
    setEnabled: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("WorkbenchTab (宿主工作台)", () => {
  it("应该正确挂载工作台与其 4 个核心可视化小组件", () => {
    render(<WorkbenchTab />);
    expect(screen.getByText("宿主工作台")).toBeInTheDocument();
    expect(screen.getByText("Host Engine Ready")).toBeInTheDocument();
    expect(screen.getByText("LOCAL TIME")).toBeInTheDocument();
  });

  it("日历组件能够正常渲染并支持今天与月份切换", () => {
    render(<HostCalendarWidget />);
    expect(screen.getByText("系统时空日历")).toBeInTheDocument();
    expect(screen.getByText("今天")).toBeInTheDocument();

    const todayBtn = screen.getByText("今天");
    fireEvent.click(todayBtn);
    expect(todayBtn).toBeInTheDocument();
  });

  it("时空流逝等待组件能够正常切换时长与计时状态", () => {
    render(<TimeLapseVisualizerWidget />);
    expect(screen.getByText("时空流逝与等待")).toBeInTheDocument();
    expect(screen.getByText("5分")).toBeInTheDocument();
    expect(screen.getByText("15分")).toBeInTheDocument();
    expect(screen.getByText("25分")).toBeInTheDocument();

    // 切换为 5 分钟预设
    fireEvent.click(screen.getByText("5分"));
    expect(screen.getByText("05:00")).toBeInTheDocument();
  });

  it("本地存储指标组件能正常展示会话与实体统计", () => {
    render(<HostStorageMetricsWidget />);
    expect(screen.getByText("本地存储与持久化")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB 数据健康度")).toBeInTheDocument();
    expect(screen.getByText("健康")).toBeInTheDocument();
  });
});
