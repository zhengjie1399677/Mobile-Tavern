import { afterEach, describe, expect, it } from "vitest";
import {
  initViewportDiagnostic,
  getViewportSnapshot,
  getViewportHistory,
  getViewportMeta,
  measureDynamicViewportHeight,
  __resetViewportDiagnosticForTest,
} from "../../src/utils/viewportDiagnostic";

describe("viewportDiagnostic 视口诊断黑匣子", () => {
  afterEach(() => {
    __resetViewportDiagnosticForTest();
  });

  it("initViewportDiagnostic 幂等：重复调用不追加 init 记录", () => {
    initViewportDiagnostic();
    const len1 = getViewportHistory().length;
    initViewportDiagnostic();
    initViewportDiagnostic();
    const len2 = getViewportHistory().length;
    expect(len2).toBe(len1);
  });

  it("getViewportSnapshot 返回当前 window 尺寸与 hasVisualViewport 标志", () => {
    const snap = getViewportSnapshot();
    expect(snap.innerW).toBe(window.innerWidth);
    expect(snap.innerH).toBe(window.innerHeight);
    expect(typeof snap.hasVisualViewport).toBe("boolean");
    if (snap.hasVisualViewport) {
      expect(snap.vvpW).not.toBeNull();
      expect(snap.vvpH).not.toBeNull();
    }
  });

  it("window resize 事件被记录到历史，包含 window 源", () => {
    initViewportDiagnostic();
    const before = getViewportHistory().length;
    window.dispatchEvent(new Event("resize"));
    const after = getViewportHistory().length;
    expect(after).toBeGreaterThan(before);
    // happy-dom 可能在 window resize 时联动触发 visualViewport.resize，故只断言新增记录含 window 源。
    const newRecords = getViewportHistory().slice(before);
    expect(newRecords.some(r => r.source === "window")).toBe(true);
  });

  it("环形缓冲：超过上限丢弃最旧记录", () => {
    initViewportDiagnostic();
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new Event("resize"));
    }
    expect(getViewportHistory().length).toBeLessThanOrEqual(30);
  });

  it("getViewportMeta 返回 viewport meta 标签内容字符串", () => {
    const meta = getViewportMeta();
    expect(typeof meta).toBe("string");
    expect(meta.length).toBeGreaterThan(0);
  });

  it("measureDynamicViewportHeight 返回数值或 null（取决于环境 dvh 支持）", () => {
    const h = measureDynamicViewportHeight();
    expect(h === null || typeof h === "number").toBe(true);
  });

  it("getViewportHistory 返回副本，修改不影响内部状态", () => {
    initViewportDiagnostic();
    const h1 = getViewportHistory();
    h1.push({ time: 0, source: "init", innerW: 0, innerH: 0, vvpW: null, vvpH: null, vvpOffsetTop: null, vvpScale: null });
    const h2 = getViewportHistory();
    expect(h2.length).toBe(h1.length - 1);
  });
});
