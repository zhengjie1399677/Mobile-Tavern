/**
 * 世界书导入持久化与预设列表 E2E 回归测试。
 *
 * 覆盖两个已修复 bug 的行为验证：
 *   1. 从全局导出格式 JSON 导入世界书到角色后，重启（reload）条目不消失
 *      （根因：catalog 空壳不显示 + 空壳覆盖完整角色卡）。
 *   2. 预设下拉列出出厂预设与导入预设（出厂预设已降级为普通预设，不再有来源标识）。
 *
 * 遵循 AGENTS.md `TEST-CONTROLLED`：有限超时、中文文案断言、不加载境外 CDN。
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

const WORLDBOOK_JSON = {
  entries: [
    {
      id: "e2e-entry-1",
      comment: "E2E 测试词条",
      keys: ["e2e_trigger"],
      content: "E2E 世界书测试内容",
      constant: false,
      enabled: true,
    },
  ],
};

const PRESET_JSON = {
  name: "E2E 测试预设",
  temperature: 0.63,
  top_p: 0.91,
};

test.describe("世界书角色导入持久化", () => {
  test("导入 JSON 到角色后重启条目不消失", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // 进入世界书 Tab，名录应显示内置角色
    await page.getByRole("tab", { name: "世界书" }).click();
    const charCard = page.getByText("Lina Schneider");
    await expect(charCard).toBeVisible({ timeout: 30_000 });
    await charCard.click();

    // 在角色专属词库视图导入世界书 JSON
    const importFile = page.locator('label:has-text("导入") input[type="file"]');
    await importFile.setInputFiles({
      name: "worldbook.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(WORLDBOOK_JSON)),
    });

    // 导入成功提示并关闭
    await expect(
      page.getByText(/成功导入 1 条设定到【Lina Schneider】的专属角色词库/),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();

    // 条目出现在列表中
    await expect(page.getByText("E2E 测试词条")).toBeVisible({ timeout: 10_000 });

    // 重启（reload 保持同 context，IndexedDB 数据保留）验证持久化
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "世界书" }).click();
    const charAfter = page.getByText("Lina Schneider");
    await expect(charAfter).toBeVisible({ timeout: 30_000 });
    await charAfter.click();

    // 修复后世界书 Tab 会重灌完整数据，条目应重新可见
    await expect(page.getByText("E2E 测试词条")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("预设列表", () => {
  test("下拉列出出厂预设与导入预设", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // 设置 → 预设分类
    await page.getByRole("tab", { name: "设置" }).click();
    await page.getByRole("button", { name: /^预设/ }).click();

    // 出厂预设已降级为普通预设，与导入预设同列于下拉（不再有来源标识）
    const presetSelect = page.getByLabel(/当前预设/);
    await expect(presetSelect).toBeVisible({ timeout: 10_000 });
    await presetSelect.click();
    await expect(
      page.locator('[data-slot="select-item"]', { hasText: "基本预设" }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");

    // 导入一个预设 JSON
    const importFile = page.locator('label:has-text("导入配置") input[type="file"]');
    await importFile.setInputFiles({
      name: "preset.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(PRESET_JSON)),
    });

    // 导入成功提示并关闭
    await expect(page.getByText(/预设已导入/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();

    // 下拉出现导入的预设
    await presetSelect.click();
    await expect(
      page.locator('[data-slot="select-item"]', { hasText: "E2E 测试预设" }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
  });
});
