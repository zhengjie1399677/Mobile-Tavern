/**
 * MVU 开关门控契约 E2E 测试
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

test.describe("MVU 脚本可选动态加载", () => {
  test("默认无 MVU iframe 渲染", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    // 默认 enableScriptExecution=false，不应有 MVU message iframe
    const frames = page.locator("iframe.mvu-message-iframe");
    await expect(frames).toHaveCount(0);
  });

  test("设置面板高级功能入口可见", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    const settings = page.getByRole("tab", { name: "设置" });
    await expect(settings).toBeVisible({ timeout: 30_000 });
    await settings.click();
    await expect(settings).toHaveAttribute("aria-selected", "true");

    const advancedCategory = page.getByRole("button", { name: /高级设置/ });
    await expect(advancedCategory).toBeVisible({ timeout: 10_000 });
    await advancedCategory.click();
    await expect(page.getByRole("heading", { name: "高级设置" })).toBeVisible({ timeout: 10_000 });
  });
});
