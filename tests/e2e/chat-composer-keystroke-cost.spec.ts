// 聊天输入框"按键路径"性能守卫（e2e）
//
// 背景：输入框曾经在每次按键时都调用 triggerScroll("auto")，而该实现会在 100ms 后把消息列表
// scrollTop 强制写成 scrollHeight（并读一次 offsetHeight 触发强制重排）。用户翻看历史时，
// 任何一个按键——包括删除一个字符——都会把页面拽回底部，表现为"页面被顶一下"。
//
// 本用例锁定"按键不得产生程序化滚动/强制重排"这一可复现部分：
//   - 软键盘打开（视口收缩 + 输入区 paddingBottom 变 4px）时连续按键与删除字符：0 次程序化滚动、0 次强制重排；
//   - 只有输入区高度真的变化时，才允许一次同帧贴底滚动。
//
// 真机观感（键盘动画、Safe Area、Android WebView 合成）无法在 Chromium 复现，
// 需要真机时按 docs/agents/ui_webview_performance.md 与 scripts/measure-android-webview-ui.ps1 复核。
import { expect, test, type Page } from "@playwright/test";

interface KeystrokeProbe {
  /** 消息列表 scrollTop 的属性写入次数（旧实现的主要症状来源） */
  scrollTopWrites: number;
  /** 消息列表 scrollTo() 调用次数（贴底补偿走这条路径） */
  scrollToCalls: number;
  /** 消息列表 offsetHeight 读取次数（强制同步重排的迹象） */
  offsetReads: number;
}

async function installKeystrokeProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: KeystrokeProbe = { scrollTopWrites: 0, scrollToCalls: 0, offsetReads: 0 };
    (window as unknown as { __keystrokeProbe?: KeystrokeProbe }).__keystrokeProbe = probe;

    const isMessageScroller = (element: unknown): boolean =>
      Boolean(
        element &&
          typeof element === "object" &&
          "matches" in (element as Element) &&
          (element as Element).matches?.('[data-ui="chat-surface"] .custom-scrollbar'),
      );

    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const nativeScrollTo = Element.prototype.scrollTo;

    if (scrollTopDescriptor?.get && scrollTopDescriptor.set) {
      Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        get(this: Element) {
          return scrollTopDescriptor.get!.call(this);
        },
        set(this: Element, value: number) {
          if (isMessageScroller(this)) probe.scrollTopWrites += 1;
          scrollTopDescriptor.set!.call(this, value);
        },
      });
    }
    if (offsetHeightDescriptor?.get) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          if (isMessageScroller(this)) probe.offsetReads += 1;
          return offsetHeightDescriptor.get!.call(this);
        },
      });
    }
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      if (isMessageScroller(this)) probe.scrollToCalls += 1;
      return (nativeScrollTo as (...rest: unknown[]) => void).apply(this, args);
    } as typeof Element.prototype.scrollTo;
  });
}

async function openChatComposer(page: Page) {
  await page.goto("/", { timeout: 60_000 });
  await expect(page.locator('[data-ui="main-tab-bar"]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /通用 AI 助手/ }).click();
  const input = page.getByLabel(/发送给.+的消息输入框/);
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  return input;
}

const readProbe = (page: Page) =>
  page.evaluate(() => {
    const probe = (window as { __keystrokeProbe?: KeystrokeProbe }).__keystrokeProbe;
    return probe
      ? { ...probe }
      : { scrollTopWrites: -1, scrollToCalls: -1, offsetReads: -1 };
  });

const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const probe = (window as { __keystrokeProbe?: KeystrokeProbe }).__keystrokeProbe;
    if (probe) {
      probe.scrollTopWrites = 0;
      probe.scrollToCalls = 0;
      probe.offsetReads = 0;
    }
  });

test.describe("聊天输入框按键路径成本", () => {
  test("按键与删除字符不产生程序化滚动或强制重排", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "仅移动端尺寸需要该守卫");
    test.setTimeout(180_000);
    await installKeystrokeProbe(page);
    const input = await openChatComposer(page);

    // 模拟软键盘打开：视口高度收缩超过 15% 阈值（与真机 adjustResize 等效），宽度保持不变。
    await page.setViewportSize({ width: 393, height: 500 });
    await page.waitForTimeout(600);
    const shellPadding = await page
      .locator("#chat-input-area-container")
      .evaluate((element) => (element as HTMLElement).style.paddingBottom);
    expect(shellPadding, "软键盘应处于打开状态，否则本守卫不成立").toBe("4px");

    await input.click();
    await input.fill("性能守卫");
    await page.keyboard.press("End");
    await page.waitForTimeout(400);

    // 逐键输入：不改变行数，因此既不需要滚动，也不需要重排
    await resetProbe(page);
    await page.keyboard.type("abcdefgh", { delay: 150 });
    await page.waitForTimeout(400);
    expect(await readProbe(page)).toEqual({
      scrollTopWrites: 0,
      scrollToCalls: 0,
      offsetReads: 0,
    });

    // 删除一个字符：报告中"页面跳动"的原始场景，必须同样零成本
    await resetProbe(page);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(400);
    expect(await readProbe(page)).toEqual({
      scrollTopWrites: 0,
      scrollToCalls: 0,
      offsetReads: 0,
    });

    // 改变行数（新增换行再删除）时允许一次同帧贴底补偿，但不得出现 scrollTop 强写与强制重排
    await page.keyboard.press("Shift+Enter");
    await page.waitForTimeout(300);
    await resetProbe(page);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    const heightChangeProbe = await readProbe(page);
    expect(heightChangeProbe.scrollTopWrites).toBe(0);
    expect(heightChangeProbe.offsetReads).toBe(0);
    expect(heightChangeProbe.scrollToCalls).toBeLessThanOrEqual(1);
  });
});
