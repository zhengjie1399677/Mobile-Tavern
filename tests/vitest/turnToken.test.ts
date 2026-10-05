/**
 * Turn 令牌：唯一过期判断的语义回归。
 *
 * 重点钉住两件事：
 *  1. 三条过期条件（取消 / 切换会话 / 会话消失）任一成立即过期；
 *  2. **修订号推进本身不会判过期**——因为本命令自己的写入也会推进修订号，
 *     误判会把合法提交一起丢掉。这条断言是为了防止后人"顺手打开"该臂。
 */
import { describe, expect, it } from "vitest";
import {
  createTurnToken,
  isStale,
  shouldDiscard,
  type FreshnessPort,
} from "@/src/application/useCases/turnToken";

function port(overrides: Partial<FreshnessPort> = {}): FreshnessPort {
  return {
    activeSessionId: () => "session-1",
    hasSession: () => true,
    ...overrides,
  };
}

describe("Turn 令牌过期判断", () => {
  it("未取消、会话未切换、会话仍在 → 不过期", () => {
    const token = createTurnToken({
      sessionId: "session-1",
      signal: new AbortController().signal,
      commandId: "cmd-1",
    });
    expect(isStale(token, port())).toBe(false);
  });

  it("取消不等于属主已变：isStale 为 false（中断结果仍需落盘）", () => {
    const controller = new AbortController();
    const token = createTurnToken({
      sessionId: "session-1",
      signal: controller.signal,
      commandId: "cmd-1",
    });
    controller.abort(new Error("user cancelled"));
    expect(isStale(token, port())).toBe(false);
    // 需要"取消即丢弃"的场景用 shouldDiscard。
    expect(shouldDiscard(token, port())).toBe(true);
  });

  it("活跃会话切换后过期", () => {
    const token = createTurnToken({
      sessionId: "session-1",
      signal: new AbortController().signal,
      commandId: "cmd-1",
    });
    expect(isStale(token, port({ activeSessionId: () => "session-2" }))).toBe(true);
  });

  it("会话被删除/不在视图里时过期", () => {
    const token = createTurnToken({
      sessionId: "session-1",
      signal: new AbortController().signal,
      commandId: "cmd-1",
    });
    expect(isStale(token, port({ hasSession: () => false }))).toBe(true);
  });

  it("修订号推进本身不判过期（本命令自己的写入也会推进它）", () => {
    const token = createTurnToken({
      sessionId: "session-1",
      signal: new AbortController().signal,
      baseRevision: 3,
      commandId: "cmd-1",
    });
    // 视图报告修订号已到 9 —— 完全可能来自本命令自己的两次提交。
    expect(isStale(token, port({ contentRevision: () => 9 }))).toBe(false);
  });

  it("令牌记录 baseRevision 与 commandId 供诊断", () => {
    const token = createTurnToken({
      sessionId: "session-1",
      signal: new AbortController().signal,
      baseRevision: 7,
      commandId: "cmd-explicit",
    });
    expect(token).toMatchObject({
      commandId: "cmd-explicit",
      sessionId: "session-1",
      baseRevision: 7,
    });
  });
});
