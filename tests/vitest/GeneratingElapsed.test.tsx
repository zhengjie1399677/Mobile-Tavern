/**
 * 生成等待计时（GeneratingElapsed）回归。
 *
 * 需求背景（2026-10-06）：等待首字节期间屏幕无输出，用户无法判断已等待多久，
 * 主观上更慢。显示秒数属于纯粹感官反馈，不改变请求/超时/提交语义。
 *
 * 覆盖：
 *  - 以占位消息 timestamp 为起点显示已等待秒数
 *  - 每秒自行推进（不影响父组件）
 *  - startedAt 变化（新一次生成）时重置
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GeneratingElapsed from "../../src/tabs/chat/message-bubble/GeneratingElapsed";
import { LanguageProvider } from "../../src/contexts/LanguageContext";

const BASE_TIME = Date.UTC(2026, 9, 6, 3, 0, 0);

function renderElapsed(startedAt?: number) {
  return render(
    <LanguageProvider>
      <GeneratingElapsed startedAt={startedAt} />
    </LanguageProvider>,
  );
}

function elapsedText(): string {
  return screen.getByTestId("generating-elapsed").textContent ?? "";
}

describe("生成等待计时", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("以生成开始时刻为起点显示秒数", () => {
    renderElapsed(BASE_TIME - 5_000);
    expect(elapsedText()).toBe("5 秒");
  });

  it("每秒自行推进", async () => {
    renderElapsed(BASE_TIME);
    expect(elapsedText()).toBe("0 秒");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(elapsedText()).toBe("3 秒");
  });

  it("换到新一次生成时按新起点重置", async () => {
    const { rerender } = renderElapsed(BASE_TIME - 9_000);
    expect(elapsedText()).toBe("9 秒");

    await act(async () => {
      rerender(
        <LanguageProvider>
          <GeneratingElapsed startedAt={BASE_TIME} />
        </LanguageProvider>,
      );
    });
    expect(elapsedText()).toBe("0 秒");
  });

  it("缺少起点时按 0 秒显示，不抛错", () => {
    renderElapsed(undefined);
    expect(elapsedText()).toBe("0 秒");
  });
});
