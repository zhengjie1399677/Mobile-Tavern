/**
 * 缓冲型到达的分帧回放（2026-10-06）。
 *
 * 背景：大量第三方中转站在整段生成期间不发字节、最后一次性下发全文，或忽略 `stream`
 * 只回一段完整正文。此时若照旧"到达即整段显示"，屏幕会从空白直接跳到全文并一次性
 * 完成整段 Markdown 解析，表现为卡顿式喷出。策略：到达仍按原样累计（权威数据不变），
 * 只有"显示长度"按拍推进；真流式的小增量照旧即时显示（零额外延迟）。
 *
 * 覆盖：
 *  - 小增量（真流式）立即显示，不引入额外延迟
 *  - 单次增量 ≥ 阈值（缓冲型）进入分帧回放：逐步显示、不回退、最终补齐
 *  - 回放总时长上限生效（超预算拍直接补齐）
 *  - isStreamActiveRef 置 false（取消/切换会话/结束）后回放立即停止
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import type { ChatSession } from "../../src/types";
import {
  BUFFERED_ARRIVAL_THRESHOLD_CHARS,
  REVEAL_MAX_MS,
  REVEAL_TICK_MS,
  buildThrottledUpdater,
} from "../../src/hooks/useChat/helpers/streamHelpers";

function createHarness() {
  let sessions: ChatSession[] = [{
    id: "session-1",
    characterId: "char-1",
    title: "测试会话",
    createdAt: 0,
    summaries: [],
    messages: [{ id: "ai-1", sender: "assistant", content: "", timestamp: 0 }],
  }];
  const commits: string[] = [];

  const setSessionViews = ((action: React.SetStateAction<ChatSession[]>) => {
    sessions = typeof action === "function" ? action(sessions) : action;
    commits.push(sessions[0].messages[0].content);
  }) as React.Dispatch<React.SetStateAction<ChatSession[]>>;

  const pendingUpdateTimeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  const updater = buildThrottledUpdater(
    setSessionViews,
    "session-1",
    "ai-1",
    [],
    [],
    pendingUpdateTimeoutRef as React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  );

  return { updater, commits, pendingUpdateTimeoutRef };
}

describe("缓冲型到达的分帧回放", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("真流式小增量立即显示，不引入额外延迟", () => {
    const { updater, commits } = createHarness();

    updater.throttledUpdate("你好");

    expect(commits).toEqual(["你好"]);
  });

  it("缓冲型一次性到达时分帧显示，最终补齐全文", async () => {
    const { updater, commits } = createHarness();
    const fullText = "甲".repeat(BUFFERED_ARRIVAL_THRESHOLD_CHARS * 6);

    updater.throttledUpdate(fullText);
    // 到达瞬间不得整段喷出（旧行为会立刻显示全文）
    expect(commits).toEqual([]);

    await vi.advanceTimersByTimeAsync(REVEAL_TICK_MS);
    expect(commits.length).toBe(1);
    expect(commits[0].length).toBeGreaterThan(0);
    expect(commits[0].length).toBeLessThan(fullText.length);

    await vi.advanceTimersByTimeAsync(REVEAL_MAX_MS);
    expect(commits[commits.length - 1]).toBe(fullText);

    // 单调不回退，且每一步都是全文的前缀
    for (let i = 1; i < commits.length; i++) {
      expect(commits[i].length).toBeGreaterThanOrEqual(commits[i - 1].length);
      expect(fullText.startsWith(commits[i])).toBe(true);
    }
    // 总时长有界：从开始回放到补齐不超过上限 + 两拍余量
    expect(commits.length).toBeLessThanOrEqual(
      Math.ceil(REVEAL_MAX_MS / REVEAL_TICK_MS) + 3,
    );
  });

  it("回放总时长超预算时直接补齐，长文不会播很久", async () => {
    const { updater, commits } = createHarness();
    const fullText = "乙".repeat(BUFFERED_ARRIVAL_THRESHOLD_CHARS * 40);

    updater.throttledUpdate(fullText);
    await vi.advanceTimersByTimeAsync(REVEAL_MAX_MS + REVEAL_TICK_MS * 2);

    expect(commits[commits.length - 1]).toBe(fullText);
    expect(commits.length).toBeLessThanOrEqual(
      Math.ceil(REVEAL_MAX_MS / REVEAL_TICK_MS) + 3,
    );
  });

  it("回放期间 isStreamActiveRef 置 false 后立即停止（取消/切会话/提交）", async () => {
    const { updater, commits, pendingUpdateTimeoutRef } = createHarness();
    const fullText = "丙".repeat(BUFFERED_ARRIVAL_THRESHOLD_CHARS * 8);

    updater.throttledUpdate(fullText);
    await vi.advanceTimersByTimeAsync(REVEAL_TICK_MS);
    const committedBeforeStop = commits.length;

    updater.isStreamActiveRef.current = false;
    if (pendingUpdateTimeoutRef.current) {
      clearTimeout(pendingUpdateTimeoutRef.current);
      pendingUpdateTimeoutRef.current = null;
    }
    await vi.advanceTimersByTimeAsync(REVEAL_MAX_MS);

    expect(commits.length).toBe(committedBeforeStop);
  });
});
