import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const readSource = (relativePath: string): string =>
  readFileSync(resolve(workspaceRoot, relativePath), "utf8");

/** 按花括号配平截取某个 CSS 块的内部内容（不处理字符串里的花括号，本仓库样式表未使用）。 */
const extractCssBlock = (source: string, marker: string, from = 0): string => {
  const start = source.indexOf(marker, from);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
};

const collectSources = (directory: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) collectSources(fullPath, acc);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) acc.push(fullPath);
  }
  return acc;
};

/** 降级层必须覆盖的主题选择器与全部主题色变量。 */
const fallbackThemes = [
  ":root",
  '[data-theme="snow"]',
  '[data-theme="sand"]',
  '[data-theme="ocean"]',
  '[data-theme="obsidian"]',
] as const;

const themeColorVariables = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
] as const;

/** 源码里通过工具类消费的 Tailwind 调色板族，命中即要求降级层给出同名 hex 变量。 */
const paletteUtilityPattern =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|placeholder|divide|outline|decoration|accent|caret|shadow)-(amber|blue|cyan|emerald|green|indigo|orange|pink|purple|red|rose|sky|slate|teal|violet|yellow|zinc)-(\d{2,3})\b/g;

const hexValuePattern = (variable: string): RegExp =>
  new RegExp(`${variable}:\\s*#[0-9a-fA-F]{6}\\b`);

const imageSources = [
  "src/components/CharacterDetailDrawer.tsx",
  "src/components/FloatingCat.tsx",
  "src/components/FloatingCharacter.tsx",
  "src/components/SplashScreen.tsx",
  "src/components/community/CommunityCardDetail.tsx",
  "src/components/session-manager/SessionManagerPanel.tsx",
  "src/tabs/CharactersTab.tsx",
  "src/tabs/CommunityTab.tsx",
  "src/tabs/chat/CharacterPortraitSection.tsx",
  "src/tabs/chat/ChatHeader.tsx",
  "src/tabs/chat/attachment-composer/PendingAttachmentStrip.tsx",
  "src/tabs/chat/message-bubble/GeneratedImageBlock.tsx",
  "src/tabs/chat/message-bubble/MessageAttachmentParts.tsx",
  "src/tabs/chat/message-bubble/MessageAvatar.tsx",
  "src/tabs/settings/LocalResourceManager.tsx",
  "src/tabs/settings/PersonaConfigSection.tsx",
  "src/tabs/worldbook/CharacterWorldbookList.tsx",
] as const;

const deferredImageSources = [
  "src/components/session-manager/SessionManagerPanel.tsx",
  "src/tabs/CommunityTab.tsx",
  "src/tabs/chat/message-bubble/GeneratedImageBlock.tsx",
  "src/tabs/chat/message-bubble/MessageAttachmentParts.tsx",
  "src/tabs/settings/LocalResourceManager.tsx",
  "src/tabs/worldbook/CharacterWorldbookList.tsx",
] as const;

describe("WebView 低成本渲染规范", () => {
  it("触屏端关闭大面积模糊和背景循环动画，并统一触控与表单下限", () => {
    const css = readSource("src/index.css");
    const coarsePointerBlock = css.match(
      /@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(coarsePointerBlock).toContain('[class*="backdrop-blur"]');
    expect(coarsePointerBlock).toContain("backdrop-filter: none !important");
    expect(coarsePointerBlock).toContain(".animate-bg-pan-zoom");
    expect(coarsePointerBlock).toContain("animation: none !important");
    expect(coarsePointerBlock).toContain("touch-action: manipulation");
    expect(coarsePointerBlock).toContain('[data-ui-density="accessible"]');
    expect(coarsePointerBlock).not.toMatch(/}\s*:where\(\s*\.text-\\\[8px/);
  });

  it("减少动态效果时停止无限动画并缩短过渡", () => {
    const css = readSource("src/index.css");
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(reducedMotionBlock).toContain("animation-iteration-count: 1 !important");
    expect(reducedMotionBlock).toContain("transition-duration: 0.01ms !important");
    expect(reducedMotionBlock).toContain("scroll-behavior: auto !important");
  });

  it.each(imageSources)("%s 的图片显式选择解码策略", (relativePath) => {
    const source = readSource(relativePath);
    const imageTags = source.match(/<img\b[\s\S]*?>/g) ?? [];

    expect(imageTags.length).toBeGreaterThan(0);
    for (const imageTag of imageTags) expect(imageTag).toMatch(/\bdecoding=/);
  });

  it.each(deferredImageSources)("%s 的非首屏图片使用懒加载", (relativePath) => {
    expect(readSource(relativePath)).toContain('loading="lazy"');
  });

  it("旧 WebView 降级配色层覆盖全部主题，且自身不含 oklch/color-mix", () => {
    const css = readSource("src/index.css");
    const fallback = extractCssBlock(css, "@supports not (color: oklch(0% 0 0))");

    expect(fallback).not.toBe("");
    // 降级层本身必须能用 Chrome 108 解析，否则等于没有兜底。
    expect(fallback).not.toMatch(/oklch\(|color-mix\(/);
    // 降级层不在 @layer 内，必须排在原主题块之后，靠源码顺序赢得同优先级覆盖。
    expect(css.indexOf("@supports not (color: oklch(0% 0 0))")).toBeGreaterThan(
      css.indexOf('[data-theme="obsidian"]'),
    );

    for (const selector of fallbackThemes) {
      const themeBlock = extractCssBlock(fallback, selector);
      expect(themeBlock, `${selector} 缺少降级主题块`).not.toBe("");
      for (const variable of themeColorVariables) {
        expect(themeBlock, `${selector} 缺少 ${variable} 的 hex 降级值`).toMatch(
          hexValuePattern(variable),
        );
      }
      // 降级层只换颜色，明暗模式仍由上面的原主题块决定。
      expect(themeBlock, `${selector} 不应在降级层重新定义 color-scheme`).not.toContain(
        "color-scheme",
      );
    }
  });

  it("源码使用的 Tailwind 调色板颜色都有降级 hex", () => {
    const css = readSource("src/index.css");
    const fallback = extractCssBlock(css, "@supports not (color: oklch(0% 0 0))");
    const usedPaletteColors = new Set<string>();

    for (const file of collectSources(resolve(workspaceRoot, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(paletteUtilityPattern)) {
        usedPaletteColors.add(`--color-${match[1]}-${match[2]}`);
      }
    }

    // 覆盖率下限防止扫描规则失效后测试静默通过。
    expect(usedPaletteColors.size).toBeGreaterThan(60);
    const missing = [...usedPaletteColors].filter(
      (variable) => !hexValuePattern(variable).test(fallback),
    );
    expect(missing, `以下调色板变量缺少 hex 降级值：${missing.join(", ")}`).toEqual([]);
  });

  it("主 Tab 保持动态分包，聊天预取复用同一加载入口", () => {
    const registration = readSource("src/composition/registerMainTabExtensions.ts");
    const loader = readSource("src/composition/mainTabLoaders.ts");

    expect(registration.match(/lazy\(\(\) => import\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(registration).toContain("const ChatTab = lazy(loadChatTab)");
    expect(loader).toContain('import("../tabs/ChatTab")');
    expect(loader).toContain("await loadChatTab()");
  });
});
