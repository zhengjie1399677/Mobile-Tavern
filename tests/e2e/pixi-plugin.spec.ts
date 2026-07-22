import { expect, test } from "@playwright/test";

test("PixiJS 插件在禁止 unsafe-eval 的强沙箱中完成初始化", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/tests/e2e/fixtures/pixi-plugin-sandbox.html", { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator("html")).toHaveAttribute("data-ready-count", "2", { timeout: 5_000 });

  const plugin = page.frameLocator("#plugin");
  if (testInfo.project.name === "mobile-chromium") {
    await expect(plugin.locator(".rotate")).toBeVisible();
  } else {
    await plugin.locator("#start").click();
    await expect(plugin.locator("#start-screen")).not.toHaveClass(/visible/);
    await expect(plugin.locator("#speech-text")).toHaveText(/\S/);
    await plugin.locator("#attack").click();
    await expect(plugin.locator("#attack")).toHaveClass(/cooldown/);
  }

  expect(consoleErrors.filter((message) => message.includes("unsafe-eval"))).toEqual([]);
  expect(pageErrors.filter((message) => message.includes("unsafe-eval"))).toEqual([]);
  await expect(page.getByTitle("PixiJS 插件强沙箱")).toHaveAttribute("sandbox", "allow-scripts");
});

test("星渊终焉在强沙箱中完成 WebGL 初始化并进入战斗", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/tests/e2e/fixtures/astral-rift-sandbox.html", { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-ready-count", "2", { timeout: 8_000 });
  const plugin = page.frameLocator("#plugin");

  if (testInfo.project.name === "mobile-chromium") {
    await expect(plugin.locator("#portrait-lock")).toBeVisible();
  } else {
    await plugin.locator("#start").click();
    await expect(plugin.locator("#start-screen")).not.toHaveClass(/visible/);
    await expect(plugin.locator("#phase")).toHaveText("PHASE 01");
    await expect(plugin.locator("#dialogue-text")).toContainText("终焉");
    await page.waitForTimeout(700);
    await page.screenshot({ path: testInfo.outputPath("astral-rift-combat.png") });
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect(page.getByTitle("星渊终焉强沙箱")).toHaveAttribute("sandbox", "allow-scripts");
});
