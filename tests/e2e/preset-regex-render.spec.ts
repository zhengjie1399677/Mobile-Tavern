/**
 * 预设展示正则的端到端回归。
 *
 * 覆盖用户反馈的"预设正则没有生效、思维块以原文显示"链路：
 * 导入带 `extensions.regex_scripts`（markdownOnly=true、placement=[2]）的预设，
 * 再导入一张开场白包含 `<thinking>…</thinking>` 的角色卡并进入聊天，
 * 断言 AI 消息按展示正则渲染出折叠容器，而不是把思维内容当普通文本显示。
 *
 * 遵循 `TEST-CONTROLLED`：有限超时、只用本地 dev server、不加载境外 CDN。
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

const COT_PRESET = {
  name: "E2E 思维链折叠预设",
  temperature: 0.8,
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      system_prompt: true,
      role: "system",
      content: "你是{{char}}。",
      injection_position: 0,
      injection_depth: 0,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [{ identifier: "main", enabled: true }],
    },
  ],
  extensions: {
    regex_scripts: [
      {
        id: "e2e-cot-fold",
        scriptName: "E2E-CoT折叠",
        findRegex: "/^([\\s\\S]*<\\/think(?:ing)?>)/i",
        // 与双星纪一致：用 <details>/<summary> 产出可折叠思维块。
        replaceString:
          '<details data-e2e-folded="1"><summary>思考过程</summary><p data-e2e-cot-body>$1</p></details>',
        disabled: false,
        placement: [2],
        runOnEdit: true,
        markdownOnly: true,
        promptOnly: false,
        substituteRegex: 0,
      },
    ],
  },
};

const THINKING_MESSAGE = [
  "<thinking>",
  "<!-- begin_of_Subtext_think -->",
  "这是模型的内部思考，正常应被展示正则折叠。",
  "<!-- end_of_Subtext_think -->",
  "</thinking>",
  "### 正文",
  "正文第一段。",
].join("\n");

const CARD_JSON = {
  name: "E2E折叠测试卡",
  description: "预设正则渲染验证",
  personality: "",
  scenario: "",
  first_mes: THINKING_MESSAGE,
  mes_example: "",
};

/**
 * 精确复现用户场景的聊天记录：野牛静默消息会被渲染层过滤，
 * 其后 AI 消息的"渲染下标"与"会话绝对下标"必然错位——旧实现会用错位的
 * 下标反查 sender，把这条 AI 消息判成用户消息，进而跳过 placement=[2] 的展示正则。
 */
const HISTORY_JSON = {
  character_name: CARD_JSON.name,
  messages: [
    { name: CARD_JSON.name, is_user: false, mes: "开场白。", send_date: 1700000000000 },
    {
      name: CARD_JSON.name,
      is_user: false,
      mes: "野牛静默续写（不应显示）。",
      send_date: 1700000001000,
      extra: { isBisonSilent: true },
    },
    { name: "用户", is_user: true, mes: "请继续。", send_date: 1700000002000 },
    { name: CARD_JSON.name, is_user: false, mes: THINKING_MESSAGE, send_date: 1700000003000 },
  ],
};

/** 打开应用根节点。 */
async function openApp(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/", { timeout: 60_000 });
  await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
}

/** 导入带展示正则的预设（导入即激活）。 */
async function importPreset(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("tab", { name: "设置" }).click();
  // 设置页签首次挂载有入场动画，等壳层稳定后再点分类，避免偶发 "not stable" 超时。
  await expect(page.locator(".settings-shell").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^预设/ }).click({ timeout: 15_000 });
  await page
    .locator('label:has-text("导入配置") input[type="file"]')
    .setInputFiles({
      name: "e2e-cot-preset.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(COT_PRESET)),
    });
  await expect(page.getByText(/预设已导入/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "确定" }).click();
}

/** 导入角色卡，结束后停留在角色页。 */
async function importCard(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("tab", { name: "角色" }).click();
  await page
    // 设置页签是 Keep-Alive，仍留在 DOM 里且有同名文件输入，必须限定在角色面板内。
    .locator('#main-tabpanel-characters input[type="file"][accept*=".json"]')
    .setInputFiles({
      name: "e2e-cot-card.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(CARD_JSON)),
    });
  await expect(page.getByText(/导入成功/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "确定" }).click();
}

/** 导入预设 + 卡片，返回后停留在角色页。 */
async function importPresetAndCard(page: import("@playwright/test").Page): Promise<void> {
  await openApp(page);
  await importPreset(page);
  await importCard(page);
}

/** 在设置页内切到指定分类；窄屏需要先返回分类列表。 */
async function openSettingsCategory(
  page: import("@playwright/test").Page,
  name: RegExp,
): Promise<void> {
  // 先等设置页稳定（预设分区的内容渲染完成），避免在页签切换动画期间误判分类导航不存在。
  await expect(page.getByText(/正则过滤脚本管理/)).toBeVisible({ timeout: 10_000 });
  const back = page.getByRole("button", { name: "返回设置分类" });
  if (await back.count() > 0 && await back.first().isVisible().catch(() => false)) {
    await back.first().click({ timeout: 15_000 });
    await expect(page.getByRole("button", { name })).toBeVisible({ timeout: 10_000 });
  }
  await page.getByRole("button", { name }).click({ timeout: 15_000 });
}

test.describe("预设展示正则", () => {
  test("导入预设后 AI 消息的思维块按展示正则折叠渲染", async ({ page }) => {
    await importPresetAndCard(page);

    await page.getByText("E2E折叠测试卡").first().click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });

    // 展示正则应产出可折叠容器：默认收起、点开 summary 后可见思维文本
    const folded = page.locator('[data-e2e-folded="1"]').first();
    await expect(folded).toBeVisible({ timeout: 20_000 });
    await expect(folded.locator("summary")).toContainText("思考过程");
    const body = page.locator("[data-e2e-cot-body]").first();
    await expect(body).toBeHidden();
    await folded.locator("summary").click();
    await expect(body).toBeVisible();
    await expect(body).toContainText("内部思考");
  });

  test("静默消息造成下标错位后，AI 消息的正则仍按消息来源执行", async ({ page }) => {
    await importPresetAndCard(page);

    // 导入与该角色匹配的酒馆聊天记录（含一条野牛静默消息）
    await page.getByRole("tab", { name: "设置" }).click();
    await openSettingsCategory(page, /记忆与数据/);
    await page
      .locator('label:has-text("选择聊天文件并导入") input[type="file"]')
      .setInputFiles({
        name: "e2e-cot-history.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(HISTORY_JSON)),
      });
    await expect(page.getByText(/成功识别匹配到本地角色/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();
    await expect(page.getByText(/聊天记录导入成功/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();

    // 从角色页进入：selectCharacter 会选最近会话，即刚导入的这条
    await page.getByRole("tab", { name: "角色" }).click();
    await page.getByText("E2E折叠测试卡").first().click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });

    // 修复前：错位下标把这条 AI 消息判成用户消息 → 展示正则被跳过 → 思维内容裸露。
    const folded = page.locator('[data-e2e-folded="1"]').first();
    await expect(folded).toBeVisible({ timeout: 20_000 });
    await folded.locator("summary").click();
    await expect(page.locator("[data-e2e-cot-body]").first()).toContainText("内部思考");
    // 野牛静默消息不应出现在正文里
    await expect(page.getByText("野牛静默续写（不应显示）。")).toHaveCount(0);
  });
});

test.describe("平行宇宙视图", () => {
  test("新建分支后，非活跃分支也会水合消息并画出轮次节点", async ({ page }) => {
    await openApp(page);
    await importCard(page);
    await page.getByText("E2E折叠测试卡").first().click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });

    // 新建第二条对话分支（带开场白的第一条消息）
    await page.getByTitle("会话功能").click();
    await page.getByRole("menuitem", { name: /新建对话分支/ }).click();
    await expect(page.getByText(/请输入全新独立分支存档名称/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "确定" }).click();
    await expect(page.locator("#chat-input-area-container")).toBeVisible({ timeout: 30_000 });

    // 进入时空图谱：两条分支各有一条开场白消息 → 两个可点击轮次节点。
    await page.getByTitle("会话功能").click();
    await page.getByRole("button", { name: /全部分支/ }).click();
    await page.getByRole("button", { name: /时空图谱/ }).click();
    await expect(page.locator('svg circle[role="button"]')).toHaveCount(2, { timeout: 20_000 });
  });
});
