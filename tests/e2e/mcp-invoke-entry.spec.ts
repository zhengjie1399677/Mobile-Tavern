/**
 * MCP 总开关与聊天气泡弹层（Popover）的端到端回归。
 *
 * 用户定稿（2026-10-07）：
 *   - 总开关默认关闭，聊天里不出现 MCP 入口；`/tool` 也会被明确拒绝；
 *   - 在工作台「扩展能力」打开总开关后，快捷栏才出现 MCP 按钮；
 *   - 气泡必须能关（× 按钮 / Escape / 点击外部）；
 *   - 不依赖外网 MCP 服务：只验证入口、关闭方式、空态引导与跳转工作台。
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
  test("默认关闭时聊天无入口；打开总开关后气泡可开可关", async ({ page }) => {
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

    // 默认关闭：展开快捷栏也没有 MCP 按钮
    await page.getByRole("button", { name: "添加内容" }).click();
    await expect(page.getByRole("menu", { name: "添加内容与输入工具" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("menuitemcheckbox", { name: /快捷栏/ }).click();
    await expect(page.getByRole("button", { name: "MCP 能力" })).toHaveCount(0);

    // 默认关闭时 /tool 明确拒绝
    const textarea = page.locator("#chat-input-area-container textarea").first();
    await textarea.fill("/tool 测试");
    await textarea.press("Enter");
    await expect(page.getByText(/外部能力（MCP）总开关当前是关闭的/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();

    // 到工作台打开总开关
    await page.getByRole("button", { name: "返回角色列表" }).click();
    await page.getByRole("tab", { name: "工作台" }).click();
    const masterSwitch = page.getByLabel("启用外部能力").first();
    await expect(masterSwitch).toBeVisible({ timeout: 30_000 });
    await masterSwitch.click();

    // 回聊天：快捷栏出现 MCP 按钮
    await page.getByRole("tab", { name: "角色" }).click();
    await page.getByText(CARD_JSON.name).first().click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });
    const mcpButton = page.getByRole("button", { name: "MCP 能力" });
    await expect(mcpButton).toBeVisible({ timeout: 10_000 });

    // 打开气泡 → × 关闭
    await mcpButton.click();
    const popover = page.getByLabel("MCP 能力面板");
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover.getByText("还没有接入 MCP 来源")).toBeVisible({ timeout: 10_000 });
    await popover.getByRole("button", { name: "关闭 MCP 面板" }).click();
    await expect(popover).toBeHidden({ timeout: 10_000 });

    // `/tool` 打开同一气泡 → Escape 关闭
    await textarea.fill("/tool 2001年发生了什么");
    await textarea.press("Enter");
    await expect(page.getByLabel("MCP 能力面板")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden({ timeout: 10_000 });

    // 打开后点击面板外部也能关闭
    await mcpButton.click();
    await expect(page.getByLabel("MCP 能力面板")).toBeVisible({ timeout: 10_000 });
    const viewport = page.viewportSize();
    await page.mouse.click((viewport?.width ?? 400) - 6, 200);
    await expect(popover).toBeHidden({ timeout: 10_000 });

    // 空态可以跳工作台管理
    await mcpButton.click();
    await page.getByLabel("MCP 能力面板").getByRole("button", { name: "去工作台接入" }).click();
    await expect(page.getByLabel("编辑工作台布局")).toBeVisible({ timeout: 30_000 });
  });
});
