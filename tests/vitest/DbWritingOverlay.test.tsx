import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DbWritingOverlay from "../../src/components/DbWritingOverlay";
import {
  dispatchMobileBack,
  resetMobileBackHandlersForTest,
} from "../../src/infrastructure/native/mobileBackNavigation";

const appState = vi.hoisted(() => ({ isDbWriting: false }));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: { isDbWriting: boolean }) => unknown) => selector(appState),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const WRITE_OVERLAY_ESCAPE_MS = 10_000;

/**
 * 回归背景：写入遮罩覆盖整个视口并吞掉点击，一旦某次写入的 await 不返回，
 * 界面会永久停在"整屏变暗 + 点不动"。这里钉住"到点必须给出逃生入口"。
 */
describe("写入遮罩的逃生入口", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMobileBackHandlersForTest();
    appState.isDbWriting = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("写入中显示遮罩，未超时不提供关闭入口", () => {
    appState.isDbWriting = true;
    render(<DbWritingOverlay />);

    expect(screen.getByText("db.writing_overlay")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.close" })).not.toBeInTheDocument();
  });

  it("超过逃生超时后出现关闭按钮，点击即释放遮挡", () => {
    appState.isDbWriting = true;
    render(<DbWritingOverlay />);

    act(() => {
      vi.advanceTimersByTime(WRITE_OVERLAY_ESCAPE_MS);
    });

    const escapeButton = screen.getByRole("button", { name: "common.close" });
    expect(screen.getByText("db.writing_overlay_timeout")).toBeInTheDocument();
    fireEvent.click(escapeButton);

    expect(screen.queryByText("db.writing_overlay")).not.toBeInTheDocument();
  });

  it("Android 返回键同样能释放遮挡", () => {
    appState.isDbWriting = true;
    render(<DbWritingOverlay />);

    act(() => {
      expect(dispatchMobileBack()).toBe(true);
    });

    expect(screen.queryByText("db.writing_overlay")).not.toBeInTheDocument();
  });

  it("无写入时整层不挂载", () => {
    render(<DbWritingOverlay />);

    expect(screen.queryByText("db.writing_overlay")).not.toBeInTheDocument();
  });
});
