import { expect, test, type Page } from "@playwright/test";

interface UiPerformanceSnapshot {
  longAnimationFrames: number[];
  layoutShift: number;
  splashMountCount: number;
  supported: {
    longAnimationFrame: boolean;
    layoutShift: boolean;
  };
}

async function resetUiMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perfWindow = window as Window & {
      __mobileTavernUiPerformance?: UiPerformanceSnapshot;
    };
    if (!perfWindow.__mobileTavernUiPerformance) return;
    perfWindow.__mobileTavernUiPerformance.longAnimationFrames.length = 0;
    perfWindow.__mobileTavernUiPerformance.layoutShift = 0;
  });
}

async function readUiMetrics(page: Page): Promise<UiPerformanceSnapshot> {
  return page.evaluate(() => {
    const perfWindow = window as Window & {
      __mobileTavernUiPerformance?: UiPerformanceSnapshot;
    };
    return perfWindow.__mobileTavernUiPerformance ?? {
      longAnimationFrames: [],
      layoutShift: 0,
      splashMountCount: 0,
      supported: { longAnimationFrame: false, layoutShift: false },
    };
  });
}

interface TouchContractViolation {
  selector: string;
  label: string;
  width: number;
  height: number;
  fontSize: number;
}

async function readTouchContractViolations(page: Page): Promise<{
  targets: TouchContractViolation[];
  fields: TouchContractViolation[];
}> {
  return page.evaluate(() => {
    const density = document.querySelector<HTMLElement>('[data-ui-density]')?.dataset.uiDensity;
    const interactiveFontMinimum = density === "accessible" ? 12 : 10;
    const inspect = (selector: string, minimumSize: number, minimumFontSize: number) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || !element.checkVisibility()) return [];
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        if (rect.width >= minimumSize && rect.height >= minimumSize && fontSize >= minimumFontSize) return [];
        return [{
          selector: element.tagName.toLowerCase() + (element.getAttribute("role") ? `[role=${element.getAttribute("role")}]` : ""),
          label: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 80),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          fontSize,
        }];
      });

    return {
      targets: inspect(
        'button, [role="button"], [role="tab"], [role="menuitem"], label:has(input[type="file"]), label:has(input[type="checkbox"]), label:has(input[type="radio"])',
        24,
        interactiveFontMinimum,
      ),
      fields: inspect(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]), select, textarea',
        28,
        interactiveFontMinimum,
      ),
    };
  });
}

test.describe("Web 与移动 WebView UI 性能契约", () => {
  test.beforeAll(async ({ browser }) => {
    // 先让 Vite 完成首次模块转译；正式用例仍使用全新 context，因此保留应用数据、
    // Kernel 和 React 的真实冷启动，只排除不属于 APK/WebView 的开发服务器编译时间。
    const warmupPage = await browser.newPage();
    await warmupPage.goto("/", { timeout: 60_000 });
    await warmupPage.locator('[data-ui="main-tab-bar"]').waitFor({ state: "visible", timeout: 60_000 });
    await warmupPage.close();
  });

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

    await context.addInitScript(() => {
      interface LayoutShiftEntry extends PerformanceEntry {
        hadRecentInput: boolean;
        value: number;
      }
      const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
      const snapshot: UiPerformanceSnapshot = {
        longAnimationFrames: [],
        layoutShift: 0,
        splashMountCount: 0,
        supported: {
          longAnimationFrame: supportedTypes.includes("long-animation-frame"),
          layoutShift: supportedTypes.includes("layout-shift"),
        },
      };
      (window as Window & { __mobileTavernUiPerformance?: UiPerformanceSnapshot })
        .__mobileTavernUiPerformance = snapshot;

      const seenSplashNodes = new WeakSet<Element>();
      const countSplashNode = (element: Element) => {
        const candidates = element.matches('[data-ui="startup-splash"]')
          ? [element]
          : Array.from(element.querySelectorAll('[data-ui="startup-splash"]'));
        for (const candidate of candidates) {
          if (seenSplashNodes.has(candidate)) continue;
          seenSplashNodes.add(candidate);
          snapshot.splashMountCount += 1;
        }
      };
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element) countSplashNode(node);
          }
        }
      }).observe(document, { childList: true, subtree: true });

      if (snapshot.supported.longAnimationFrame) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) snapshot.longAnimationFrames.push(entry.duration);
        }).observe({ type: "long-animation-frame", buffered: true });
      }
      if (snapshot.supported.layoutShift) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as LayoutShiftEntry[]) {
            if (!entry.hadRecentInput) snapshot.layoutShift += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      }
    });
  });

  test("冷启动、Tab 切换与键盘式 resize 保持稳定", async ({ page }, testInfo) => {
    const startedAt = Date.now();
    await page.goto("/", { timeout: 60_000 });
    const tablist = page.locator('[data-ui="main-tab-bar"]');
    await expect(tablist).toBeVisible({ timeout: 60_000 });
    const startupMs = Date.now() - startedAt;
    expect(startupMs, "开发构建冷启动不应超过 30 秒").toBeLessThan(30_000);
    const startupMetrics = await readUiMetrics(page);
    expect(startupMetrics.splashMountCount, "Web Splash 不应在 Provider 就绪后再次挂载").toBe(1);

    if (testInfo.project.name === "mobile-chromium") {
      const navContract = await tablist.evaluate((element) => {
        const tabs = Array.from(element.querySelectorAll<HTMLElement>('[role="tab"]'));
        const label = tabs[0]?.querySelector<HTMLElement>("span");
        const style = getComputedStyle(element);
        return {
          targets: tabs.map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
          labelFontSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
          backdropFilter: style.backdropFilter,
        };
      });
      expect(navContract.targets.length).toBeGreaterThan(0);
      expect(navContract.targets.every(({ width, height }) => width >= 44 && height >= 44), "底栏主操作触控目标不得小于 44px").toBe(true);
      expect(navContract.labelFontSize, "底栏主标签字号不得低于 12px").toBeGreaterThanOrEqual(12);
      expect(navContract.backdropFilter, "触屏设备不应保留底栏大面积毛玻璃").toBe("none");
    }

    await resetUiMetrics(page);
    const coldSwitchDurations: number[] = [];
    for (const tabName of ["设置", "角色", "会话", "角色"]) {
      const started = await page.evaluate(() => performance.now());
      const tab = page.getByRole("tab", { name: tabName });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      coldSwitchDurations.push(await page.evaluate((start) => performance.now() - start, started));
    }

    const warmSwitchDurations: number[] = [];
    for (const tabName of ["设置", "会话", "角色"]) {
      const started = await page.evaluate(() => performance.now());
      const tab = page.getByRole("tab", { name: tabName });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      warmSwitchDurations.push(await page.evaluate((start) => performance.now() - start, started));
    }

    const navigationTabs = tablist.getByRole("tab");
    await navigationTabs.first().focus();
    await page.keyboard.press("End");
    await expect(navigationTabs.last()).toBeFocused();
    await expect(navigationTabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(navigationTabs.first()).toBeFocused();
    await expect(navigationTabs.first()).toHaveAttribute("aria-selected", "true");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const compactHeight = Math.max(360, Math.min(520, (viewport?.height ?? 720) - 240));
    const resizeStarted = await page.evaluate(() => performance.now());
    await page.setViewportSize({ width: viewport?.width ?? 393, height: compactHeight });
    await expect.poll(() => page.locator('[data-ui="main-tab-content"]').evaluate((element) => {
      const root = element.parentElement;
      return root ? Math.round(root.getBoundingClientRect().height) : 0;
    })).toBe(compactHeight);
    const resizeMs = await page.evaluate((start) => performance.now() - start, resizeStarted);

    const metrics = await readUiMetrics(page);
    const maxColdSwitchMs = Math.max(...coldSwitchDurations);
    const maxWarmSwitchMs = Math.max(...warmSwitchDurations);
    const maxLongAnimationFrameMs = Math.max(0, ...metrics.longAnimationFrames);
    const mobileMultiplier = testInfo.project.name === "mobile-chromium" ? 1.5 : 1;

    expect(maxColdSwitchMs, "首次懒加载 Tab 切换响应时间超出基线").toBeLessThan(2_000 * mobileMultiplier);
    expect(maxWarmSwitchMs, "缓存后 Tab 切换响应时间超出基线").toBeLessThan(500 * mobileMultiplier);
    expect(resizeMs, "键盘式 viewport resize 响应时间超出基线").toBeLessThan(700 * mobileMultiplier);
    expect(metrics.layoutShift, "非用户触发的累计布局偏移过高").toBeLessThan(0.2);
    if (metrics.supported.longAnimationFrame) {
      expect(maxLongAnimationFrameMs, "出现过长的 Long Animation Frame").toBeLessThan(300 * mobileMultiplier);
    }

    console.log(JSON.stringify({
      project: testInfo.project.name,
      startupMs,
      coldSwitchDurations,
      warmSwitchDurations,
      resizeMs,
      layoutShift: metrics.layoutShift,
      maxLongAnimationFrameMs,
      splashMountCount: startupMetrics.splashMountCount,
    }));
  });

  test("横竖屏与前后台恢复保留聊天草稿、焦点和 Safe Area", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "仅在移动尺寸项目验证旋转契约");

    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator('[data-ui="main-tab-bar"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /通用 AI 助手/ }).click();

    const input = page.getByRole("textbox", { name: /发送给.+的消息输入框/ });
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("旋转后仍应保留的草稿");
    await expect(input).toBeFocused();

    await page.setViewportSize({ width: 851, height: 393 });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("androidSafeAreasChanged", {
        detail: { top: 0, bottom: 0, left: 22, right: 8 },
      }));
    });

    await expect(page.locator('[data-ui="main-tab-content"]')).toHaveAttribute("data-active-tab", "chat");
    await expect(input).toHaveValue("旋转后仍应保留的草稿");
    await expect(input).toBeFocused();
    await expect.poll(() => page.evaluate(() => ({
      left: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-left").trim(),
      right: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-right").trim(),
    }))).toEqual({ left: "22px", right: "8px" });

    const landscapeBox = await input.boundingBox();
    expect(landscapeBox).not.toBeNull();
    expect((landscapeBox?.y ?? 0) + (landscapeBox?.height ?? 0)).toBeLessThanOrEqual(393);

    await page.evaluate(() => {
      (window as Window & {
        AndroidThemeBridge?: { getSafeAreas: () => string };
      }).AndroidThemeBridge = {
        getSafeAreas: () => JSON.stringify({ top: 31, bottom: 17, left: 0, right: 0 }),
      };
      window.dispatchEvent(new CustomEvent("mobileTavernNativeResume"));
    });
    await expect.poll(() => page.evaluate(() => ({
      top: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top").trim(),
      bottom: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom").trim(),
    }))).toEqual({ top: "31px", bottom: "17px" });

    await page.setViewportSize({ width: 393, height: 851 });
    await expect(input).toHaveValue("旋转后仍应保留的草稿");
    await expect(page.locator('[data-ui="main-tab-content"]')).toHaveAttribute("data-active-tab", "chat");
  });

  test("触屏主要页面满足可读字号和触控下限", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "仅在移动尺寸项目验证触屏契约");

    await page.goto("/", { timeout: 60_000 });
    const tablist = page.locator('[data-ui="main-tab-bar"]');
    await expect(tablist).toBeVisible({ timeout: 60_000 });

    for (const tabId of ["characters", "chat-history", "global-worldbook", "settings"]) {
      const tab = tablist.locator(`[data-tab-id="${tabId}"]`);
      await tab.click();
      await expect(page.locator('[data-ui="main-tab-content"]')).toHaveAttribute("data-active-tab", tabId);
      const violations = await readTouchContractViolations(page);
      expect(violations.targets, `${tabId} 存在低于 32px 或当前界面密度字号下限的可见互动控件`).toEqual([]);
      expect(violations.fields, `${tabId} 存在低于 44px 或 16px 的可见表单控件`).toEqual([]);
    }
  });
});
