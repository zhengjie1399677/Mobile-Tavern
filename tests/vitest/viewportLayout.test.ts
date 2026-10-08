import { describe, expect, it } from "vitest";
import {
  isOutsideVisibleViewport,
  resolveAppViewportHeight,
  resolveEffectiveBottomInset,
  resolveKeyboardViewportState,
} from "../../src/utils/viewportLayout";

describe("移动端可视视口布局", () => {
  it("使用 layout viewport 与 visual viewport 中更小的高度", () => {
    expect(resolveAppViewportHeight(800, 512.4)).toBe(512);
    expect(resolveAppViewportHeight(800, 900)).toBe(800);
    expect(resolveAppViewportHeight(800)).toBe(800);
  });

  it("仅在输入控件越过可视区域边界时请求滚动", () => {
    const viewport = { height: 500, offsetTop: 20 };

    expect(isOutsideVisibleViewport({ top: 100, bottom: 140 }, viewport)).toBe(false);
    expect(isOutsideVisibleViewport({ top: 8, bottom: 48 }, viewport)).toBe(true);
    expect(isOutsideVisibleViewport({ top: 480, bottom: 510 }, viewport)).toBe(true);
  });

  it("只把同一宽度下的显著高度收缩识别为软键盘", () => {
    const initial = { baselineHeight: 800, viewportWidth: 393, isOpen: false };
    expect(resolveKeyboardViewportState(initial, 760, 393).isOpen).toBe(false);
    expect(resolveKeyboardViewportState(initial, 560, 393).isOpen).toBe(true);
  });

  it("旋转时重建高度基准而不是误判为软键盘", () => {
    const portrait = { baselineHeight: 800, viewportWidth: 393, isOpen: false };
    const landscape = resolveKeyboardViewportState(portrait, 393, 800);

    expect(landscape).toEqual({
      baselineHeight: 393,
      viewportWidth: 800,
      isOpen: false,
    });
    expect(resolveKeyboardViewportState(landscape, 260, 800).isOpen).toBe(true);
  });

  it("软键盘可见时底部安全区按 0 结算", () => {
    // 键盘弹起：即使桥上报了输入法高度也不能当作底部 inset
    expect(resolveEffectiveBottomInset(312, true)).toBe(0);
    // 键盘收起：使用导航栏 / 手势条 inset
    expect(resolveEffectiveBottomInset(24, false)).toBe(24);
    // 异常值收敛
    expect(resolveEffectiveBottomInset(Number.NaN, false)).toBe(0);
    expect(resolveEffectiveBottomInset(-8, false)).toBe(0);
  });
});
