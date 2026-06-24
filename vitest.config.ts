import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vitest 测试配置
 *
 * 设计要点：
 * - environment: 'happy-dom'：提供轻量 DOM 实现（比 jsdom 快），支持 React 组件渲染测试
 *   与 tavernHelperBridge 这类依赖 window/document 的模块集成测试。
 * - 复用 vite 的 react 插件与路径别名，确保测试与生产构建解析一致。
 * - setupFiles 引入 jest-dom 断言扩展与浏览器 API polyfill。
 * - 测试范围限定在 tests/vitest（单元/集成）与 src 下可测工具，避免误跑 E2E。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/vitest/setup.ts"],
    include: ["tests/vitest/**/*.test.ts", "tests/vitest/**/*.test.tsx"],
    // tavernHelperBridge 通过 ?raw 引入 MVU 脚本字符串，依赖 vite 的 ?raw 处理
    // vitest 基于 vite，原生支持，无需额外配置
    css: false,
  },
});
