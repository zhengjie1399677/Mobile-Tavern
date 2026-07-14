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

  test("设置面板连接标签页可见", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.getByRole("tab", { name: "角色馆" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: "设置" }).click();
    await expect(page.getByRole("tab", { name: "设置" })).toHaveAttribute("aria-selected", "true");

    // 连接子标签页可见且选中（defaultValue="api" → 标签名"连接"）
    const apiTab = page.getByRole("tab", { name: "连接" });
    await expect(apiTab).toBeVisible({ timeout: 10_000 });
    await expect(apiTab).toHaveAttribute("aria-selected", "true");
  });
});
