/**
 * Vitest 测试环境初始化
 *
 * 职责：
 * 1. 引入 @testing-library/jest-dom 断言扩展（toBeInTheDocument 等）。
 * 2. 补齐 happy-dom 缺失的浏览器 API polyfill（matchMedia 等），
 *    供依赖这些 API 的组件在测试环境下正常运行。
 * 3. 在每个用例后自动清理渲染产物，避免用例间 DOM 污染。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// 组件渲染测试用例间清理 DOM
afterEach(() => {
  cleanup();
});

// happy-dom 默认不提供 matchMedia，部分 UI 组件（如响应式布局）依赖它
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// IntersectionObserver polyfill（懒加载组件可能依赖）
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: typeof MockIntersectionObserver }).IntersectionObserver = MockIntersectionObserver;
  (globalThis as unknown as { IntersectionObserver: typeof MockIntersectionObserver }).IntersectionObserver = MockIntersectionObserver;
}

// ResizeObserver polyfill（部分布局组件可能依赖）
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
  (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
}

// 抑制 tavernHelperBridge 在测试中产生的诊断日志噪声
// （仅在非显式断言日志的场景下静默，避免淹没测试输出）
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const first = args[0];
  if (typeof first === "string" && (first.startsWith("[TavernHelper") || first.startsWith("[MVU"))) {
    return;
  }
  originalConsoleLog(...args);
};
