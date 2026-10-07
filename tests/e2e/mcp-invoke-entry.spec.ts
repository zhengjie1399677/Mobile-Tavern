/**
 * 聊天输入区「调用能力」显性入口的端到端回归。
 *
 * 用户反馈："MCP 启用了、测试调用正常，但在正文聊天里根本调用不了一点"。
 * 除发送链路修复（冻结快照叠加已启用外部来源）外，还必须有一个用户可见的入口。
 * 本用例不依赖外网 MCP 服务：验证按钮/命令能打开调用面板，且没有已启用来源时给出明确引导。
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
  test("输入区「调用能力」按钮与 /tool 命令都能打开调用面板", async ({ page }) => {
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

    // 入口一：快捷栏按钮
    await page.getByRole("button", { name: "添加内容" }).click();
    await expect(page.getByRole("menu", { name: "添加内容与输入工具" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("menuitemcheckbox", { name: /快捷栏/ }).click();
    await page.getByRole("button", { name: /调用能力/ }).click();
    await expect(page.getByText("调用外部能力")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/还没有已启用并连通的 MCP 工具/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "关闭能力调用面板" }).click();
    await expect(page.getByText("调用外部能力")).toHaveCount(0);

    // 入口二：斜杠命令
    const textarea = page.locator("#chat-input-area-container textarea").first();
    await textarea.fill("/tool 2001年发生了什么");
    await textarea.press("Enter");
    await expect(page.getByText("调用外部能力")).toBeVisible({ timeout: 10_000 });
  });
});
