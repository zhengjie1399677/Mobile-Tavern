/**
 * 宿主与互联设置分区 E2E 回归。
 *
 * 覆盖三条当前必须守住的行为：
 * 1. 默认只监听回环地址，且界面判定与 headless 启动闸门一致（都能启动）。
 * 2. 放开局域网（0.0.0.0 / 局域网 IP）必须二次确认；取消后不得写入设置。
 * 3. 远程宿主探测的失败原因必须可解释，不能只给"失败"两个字。
 */

import { test, expect, type Page } from "@playwright/test";

async function openHostSection(page: Page) {
  await page.goto("/", { timeout: 60_000 });
  await page.getByRole("tab", { name: "设置" }).click();
  const category = page.getByRole("button", { name: /宿主与互联/ });
  await expect(category).toBeVisible({ timeout: 20_000 });
  await category.click();
  await expect(page.getByText("本机作为宿主")).toBeVisible({ timeout: 15_000 });
}

test.describe("宿主与互联设置", () => {
  test("默认仅本机监听，校验通过且提供启动配置", async ({ page }) => {
    await openHostSection(page);
    await expect(page.getByText("连接到远程宿主")).toBeVisible();
    await expect(page.getByTestId("host-binding-scope-badge")).toHaveText("仅本机");
    await expect(page.getByTestId("host-binding-assessment")).toHaveAttribute("data-level", "ok");
    await expect(page.getByRole("button", { name: /复制启动配置/ })).toBeEnabled();
    await expect(page.getByText("HEADLESS_HOST=127.0.0.1")).toBeVisible();
  });

  test("放开局域网必须二次确认，取消后保持仅本机", async ({ page }) => {
    await openHostSection(page);
    await page.getByRole("button", { name: "0.0.0.0", exact: true }).click();
    await expect(page.getByText("确认放开局域网访问")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "取消", exact: true }).click();

    await expect(page.getByTestId("host-binding-scope-badge")).toHaveText("仅本机");
    await expect(page.getByTestId("host-binding-assessment")).toHaveAttribute("data-level", "ok");
  });

  test("确认放开后缺凭据即判定不可启动，生成凭据后恢复可启动", async ({ page }) => {
    await openHostSection(page);
    const assessment = page.getByTestId("host-binding-assessment");
    const copyEnv = page.getByRole("button", { name: /复制启动配置/ });

    await page.getByRole("button", { name: "0.0.0.0", exact: true }).click();
    await page.getByRole("button", { name: "确定", exact: true }).click();

    await expect(page.getByTestId("host-binding-scope-badge")).toHaveText("已放开对外");
    await expect(assessment).toHaveAttribute("data-level", "error");
    await expect(page.getByText(/未设置访问凭据/)).toBeVisible();
    await expect(copyEnv).toBeDisabled();

    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect(assessment).toHaveAttribute("data-level", "warning");
    await expect(page.getByText(/明文 HTTP 传输/)).toBeVisible();
    await expect(copyEnv).toBeEnabled();
  });

  test("端口非法只提示、不改写用户已填内容", async ({ page }) => {
    await openHostSection(page);
    const port = page.getByLabel("监听端口");
    const invalidHint = page.getByText("端口需为 1~65535 的整数");

    await port.fill("70000");
    await expect(invalidHint).toBeVisible();
    await expect(port).toHaveValue("70000");

    await port.fill("18080");
    await expect(invalidHint).toHaveCount(0);
    await expect(port).toHaveValue("18080");
  });

  test("远程宿主地址格式错误与不可达给出不同原因", async ({ page }) => {
    await openHostSection(page);
    const url = page.getByLabel("宿主地址");
    const testButton = page.getByRole("button", { name: /测试连接/ });
    const result = page.getByTestId("host-remote-result");

    await expect(testButton).toBeDisabled();

    await url.fill("ws://nope");
    await expect(testButton).toBeEnabled();
    await testButton.click();
    await expect(result).toHaveAttribute("data-ok", "false");
    await expect(page.getByText(/地址格式无法识别/)).toBeVisible();

    // 端口 1 必然无监听：用于稳定复现"不可达"，不依赖外网。
    await url.fill("127.0.0.1:1");
    await testButton.click();
    await expect(page.getByText(/连不上该地址/)).toBeVisible({ timeout: 20_000 });
  });
});
