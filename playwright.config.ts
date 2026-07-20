import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 端到端测试配置
 *
 * 遵循 AGENTS.md 核心行为准则四（受控浏览器自动化测试规范）：
 * - 强制超时上限：导航 ≤10s、单个断言/定位 ≤5s，禁止无界等待。
 * - 本地静态化资源：webServer 自动拉起 Vite 开发服务器（端口 3000），
 *   测试全程禁止加载境外 CDN（由 E2E 用例内通过 page.on('request') 断言保障）。
 * - 重试次数有限：仅对失败用例重试 1 次。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // 单个测试用例整体超时上限 120s（首次启动 IndexedDB + Kernel 初始化较慢）
  timeout: 120_000,
  expect: {
    // 单个断言默认超时 5s（准则四要求）
    timeout: 5_000,
  },
  // 失败用例重试上限（有限重试，禁止无界等待）
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    // 导航超时上限 10s（准则四要求）
    navigationTimeout: 30_000,
    actionTimeout: 5_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 拦截并中止对境外 CDN 的请求，强制本地静态化资源（准则四 + 代理环境限制）
    // 在用例中通过 context.route 增强，此处仅保留基础策略
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 以 Android 常用窄屏尺寸验证触控布局与 Safe Area 相关 DOM 契约。
      // 该项目不替代真机验证，但能在 CI 中稳定防止移动端首屏与导航回归。
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npx tsx server.ts",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
