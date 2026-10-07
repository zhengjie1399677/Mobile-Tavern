/**
 * 聊天界面 MCP 气泡弹层（Popover）的端到端回归。
 *
 * 用户定稿的形态：不再用全屏底部面板，而是输入框左侧的「MCP 能力」按钮弹出气泡，
 * 面板内直接做来源启停与工具调用；`/tool` 命令同样打开该气泡。
 * 本用例不依赖外网 MCP 服务：验证入口、空态引导与跳转工作台。
 */
import { test, expect } from "@playwright/test";

const CARD_JSON = {
  name: "E2E能力入口卡",
  description: "调用能力入口验证",
  personality: "",
  scenario: "",
  first_mes: "你好。",
  mes_example: "",
};

test.describe("MCP 显性调用入口", () => {
  test("输入区「MCP 能力」按钮与 /tool 命令都能打开气泡弹层", async ({ page }) => {
    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("tab", { name: "角色" }).click();
    await page
      .locator('#main-tabpanel-characters input[type="file"][accept*=".json"]')
      .setInputFiles({
        name: "e2e-tool-entry-card.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(CARD_JSON)),
      });
    await expect(page.getByText(/导入成功/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();
    await page.getByText(CARD_JSON.name).first().click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });

    // 入口一：输入框左侧的 MCP 能力按钮 → 锚定气泡
    await page.getByRole("button", { name: "MCP 能力" }).click();
    const popover = page.getByLabel("MCP 能力面板");
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover.getByText("还没有接入 MCP 来源")).toBeVisible({ timeout: 10_000 });

    // 入口二：斜杠命令打开同一个气泡
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden({ timeout: 10_000 });
    const textarea = page.locator("#chat-input-area-container textarea").first();
    await textarea.fill("/tool 2001年发生了什么");
    await textarea.press("Enter");
    await expect(page.getByLabel("MCP 能力面板")).toBeVisible({ timeout: 10_000 });

    // 空态可以直接跳到工作台管理
    await page.getByLabel("MCP 能力面板").getByRole("button", { name: "去工作台接入" }).click();
    await expect(page.getByLabel("编辑工作台布局")).toBeVisible({ timeout: 30_000 });
  });
});
