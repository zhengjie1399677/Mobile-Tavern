/**
 * 工作台活动 Provider 测试：唯一数据源与刷新节流。
 *
 * 断言三件事：
 *   1. 多张卡片共享同一次聚合加载（不是每张卡片各自扫描一次）；
 *   2. 隐藏的 Keep-Alive 页签不触发加载，切回工作台才补一次；
 *   3. 聚合失败时退化为空快照而不是崩溃。
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadSpy, appState } = vi.hoisted(() => ({
  loadSpy: vi.fn(),
  appState: {
    current: {
      sessions: [] as unknown[],
      totalSessionCount: 7,
      activeTab: "workbench",
    },
  },
}));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (_state: unknown) => unknown) => selector(appState.current),
}));
vi.mock("../../src/application/useCases/workbenchActivityUseCases", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/application/useCases/workbenchActivityUseCases")
  >();
  return { ...actual, loadWorkbenchActivitySnapshot: loadSpy };
});

import {
  WorkbenchActivityProvider,
  useWorkbenchActivity,
} from "../../src/components/workbench/WorkbenchActivityProvider";
import { createEmptyWorkbenchActivitySnapshot } from "../../src/application/useCases/workbenchActivityUseCases";

const REFRESH_DEBOUNCE_MS = 600;

function Probe({ label }: { label: string }): React.JSX.Element {
  const { activity, todayKey } = useWorkbenchActivity();
  return (
    <span data-testid={label}>{`${label}|${activity.todayCount}|${todayKey}|${activity.totalSessionCount}`}</span>
  );
}

async function flushDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, REFRESH_DEBOUNCE_MS + 100));
  });
}

describe("WorkbenchActivityProvider", () => {
  beforeEach(() => {
    loadSpy.mockReset();
    appState.current = { sessions: [], totalSessionCount: 7, activeTab: "workbench" };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("四张卡片共享同一次聚合加载", async () => {
    loadSpy.mockImplementation(async ({ now, totalSessionCount }: { now: number; totalSessionCount: number }) => ({
      ...createEmptyWorkbenchActivitySnapshot(now, totalSessionCount),
      todayCount: 5,
    }));

    render(
      <WorkbenchActivityProvider>
        <Probe label="a" />
        <Probe label="b" />
        <Probe label="c" />
        <Probe label="d" />
      </WorkbenchActivityProvider>,
    );
    await flushDebounce();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    for (const label of ["a", "b", "c", "d"]) {
      expect(screen.getByTestId(label)).toHaveTextContent(`${label}|5|`);
    }
    expect(screen.getByTestId("a")).toHaveTextContent("|7");
  });

  it("隐藏的 Keep-Alive 页签不触发加载", async () => {
    appState.current = { sessions: [], totalSessionCount: 7, activeTab: "chat" };
    loadSpy.mockResolvedValue(createEmptyWorkbenchActivitySnapshot(Date.now(), 7));

    render(
      <WorkbenchActivityProvider>
        <Probe label="a" />
      </WorkbenchActivityProvider>,
    );
    await flushDebounce();

    expect(loadSpy).not.toHaveBeenCalled();
    // 降级为稳定的空快照，界面仍可渲染
    expect(screen.getByTestId("a")).toHaveTextContent("a|0|");
  });

  it("聚合失败时退化为上一次（此处为初始空）快照而不抛出", async () => {
    loadSpy.mockRejectedValue(new Error("事务中止"));

    render(
      <WorkbenchActivityProvider>
        <Probe label="a" />
      </WorkbenchActivityProvider>,
    );
    await flushDebounce();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("a")).toHaveTextContent("a|0|");
  });

  it("无 Provider 时卡片拿到稳定降级值，不发起任何加载", () => {
    render(<Probe label="lone" />);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("lone")).toHaveTextContent("lone|0|");
  });
});
