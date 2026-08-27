export interface VisibleViewportMetrics {
  height: number;
  offsetTop: number;
}

export interface VerticalRect {
  top: number;
  bottom: number;
}

export interface KeyboardViewportState {
  baselineHeight: number;
  viewportWidth: number;
  isOpen: boolean;
}

export function resolveAppViewportHeight(
  innerHeight: number,
  visualViewportHeight?: number,
): number {
  const finiteInnerHeight = Number.isFinite(innerHeight) ? Math.max(0, innerHeight) : 0;
  if (!Number.isFinite(visualViewportHeight)) return Math.round(finiteInnerHeight);
  return Math.round(Math.min(finiteInnerHeight, Math.max(0, visualViewportHeight ?? 0)));
}

export function isOutsideVisibleViewport(
  rect: VerticalRect,
  viewport: VisibleViewportMetrics,
  margin = 16,
): boolean {
  const visibleTop = viewport.offsetTop + margin;
  const visibleBottom = viewport.offsetTop + viewport.height - margin;
  return rect.top < visibleTop || rect.bottom > visibleBottom;
}

/**
 * 根据可视视口推导软键盘状态。
 *
 * 旋转会同时显著改变宽度和高度，不能继续沿用竖屏高度基准，否则横屏会被误判为
 * 键盘展开。普通键盘动画通常只改变高度，因此保留同一宽度下的最大稳定高度。
 */
export function resolveKeyboardViewportState(
  previous: KeyboardViewportState,
  currentHeight: number,
  currentWidth: number,
): KeyboardViewportState {
  const height = Number.isFinite(currentHeight) ? Math.max(0, currentHeight) : 0;
  const width = Number.isFinite(currentWidth) ? Math.max(0, currentWidth) : 0;
  const previousHeight = Math.max(0, previous.baselineHeight);
  const previousWidth = Math.max(0, previous.viewportWidth);
  const widthChange = Math.abs(width - previousWidth);
  const orientationChanged = previousWidth > 0 && widthChange > Math.max(48, previousWidth * 0.2);

  if (orientationChanged || previousHeight === 0) {
    return {
      baselineHeight: height,
      viewportWidth: width,
      isOpen: false,
    };
  }

  const baselineHeight = Math.max(previousHeight, height);
  const threshold = Math.min(baselineHeight * 0.15, 100);
  return {
    baselineHeight,
    viewportWidth: width,
    isOpen: baselineHeight - height > threshold,
  };
}
