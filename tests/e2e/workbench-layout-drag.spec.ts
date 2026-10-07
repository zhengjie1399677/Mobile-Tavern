/**
 * 工作台布局"长按拖动"的真实触摸回归。
 *
 * 用户实测反馈"长按微微放大但完全无法移动"：长按后才设 `touch-action:none`
 * 在 Android 上无效，浏览器先把这次触摸接管成列表滚动并发出 pointercancel。
 * 本用例用 CDP 派发真实触摸序列（touchStart → 长按 → touchMove → touchEnd），
 * 复现设备语义：拖动必须被识别、顺序必须改变并在重开面板后保持。
 *
 * 遵循 `TEST-CONTROLLED`：只在本地 dev server 上执行，超时有限。
 */
import { test, expect } from "@playwright/test";

test.describe("工作台布局拖动", () => {
  test("长按后拖动可以改变卡片顺序并持久化", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP 触摸事件仅 Chromium 支持");
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("tab", { name: "工作台" }).click();
    const layoutButton = page.getByLabel("编辑工作台布局");
    await expect(layoutButton).toBeVisible({ timeout: 30_000 });
    await layoutButton.click();
    await expect(page.getByText("编辑布局")).toBeVisible({ timeout: 10_000 });

    const rows = page.locator("[data-card-row]");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const firstId = await rows.first().getAttribute("data-card-row");
    const secondId = await rows.nth(1).getAttribute("data-card-row");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();

    // 真实触摸序列：按住第一行超过长按阈值，再下移一行高度后松手。
    const box = await rows.first().boundingBox();
    expect(box).not.toBeNull();
    const startX = Math.round(box!.x + box!.width / 2);
    const startY = Math.round(box!.y + box!.height / 2);
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    await page.waitForTimeout(420);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y: startY + 70 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    // 顺序应交换：原来的第一张卡落到第二位
    await expect(rows.nth(1)).toHaveAttribute("data-card-row", firstId!, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute("data-card-row", secondId!, { timeout: 10_000 });

    // 关闭并重开面板：改动必须已写入设置（持久化）
    await page.getByRole("button", { name: "完成" }).click();
    await layoutButton.click();
    await expect(page.getByText("编辑布局")).toBeVisible({ timeout: 10_000 });
    await expect(rows.nth(1)).toHaveAttribute("data-card-row", firstId!, { timeout: 10_000 });
  });
});
