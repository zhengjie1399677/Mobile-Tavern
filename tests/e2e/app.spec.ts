/**
 * 应用骨架与关键交互流程 E2E 测试
 */

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.includes("fonts.googleapis.com") ||
      url.includes("fonts.gstatic.com") ||
      url.includes("cdn.jsdelivr.net") ||
      url.includes("testingcf.jsdelivr.net")
    ) {
      return route.abort("aborted");
    }
    return route.continue();
  });
});

test.describe("应用启动", () => {
  test("首页可加载且 #root 渲染内容", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    const content = await page.locator("#root").innerHTML();
    expect(content.trim().length).toBeGreaterThan(0);
  });

  test("底部导航栏存在且含 Tab 按钮", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    // 底部 tablist 存在
    const tablist = page.getByRole("tablist").first();
    await expect(tablist).toBeVisible({ timeout: 30_000 });
    // tablist 内含按钮（至少1个）
    const tabs = tablist.getByRole("tab");
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Tab 切换", () => {
  test("设置 Tab 可点击且变为选中状态", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    const settings = page.getByRole("tab", { name: "设置" });
    await expect(settings).toBeVisible({ timeout: 30_000 });
    await settings.click();
    await expect(settings).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("设置面板", () => {
  test("设置分类首页可进入模型与连接详情", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.getByRole("tab", { name: "设置" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "设置" }).click();

    const connectionCategory = page.getByRole("button", { name: /模型与连接/ });
    await expect(connectionCategory).toBeVisible({ timeout: 10_000 });
    await connectionCategory.click();
    await expect(page.getByRole("heading", { name: "模型与连接" })).toBeVisible({ timeout: 5_000 });
    if ((page.viewportSize()?.width || 0) < 600) {
      await expect(page.getByRole("button", { name: "返回设置分类" })).toBeVisible();
    }
  });
});

test.describe("崩溃兜底", () => {
  test("页面不应白屏（至少根节点含内容）", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    const content = await page.locator("#root").innerHTML();
    expect(content.trim().length).toBeGreaterThan(0);

    if (errors.length > 0) {
      console.warn(`[E2E] Console errors during startup: ${errors.length} total.`);
    }
  });
});
