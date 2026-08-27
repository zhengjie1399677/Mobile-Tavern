import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const readSource = (relativePath: string): string =>
  readFileSync(resolve(workspaceRoot, relativePath), "utf8");

const imageSources = [
  "src/components/CharacterDetailDrawer.tsx",
  "src/components/FloatingCat.tsx",
  "src/components/FloatingCharacter.tsx",
  "src/components/SplashScreen.tsx",
  "src/components/community/CommunityCardDetail.tsx",
  "src/tabs/CharactersTab.tsx",
  "src/tabs/ChatHistoryTab.tsx",
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
  "src/tabs/ChatHistoryTab.tsx",
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
    expect(coarsePointerBlock).toContain("min-block-size: 2rem");
    expect(coarsePointerBlock).toContain("min-block-size: 2.75rem");
    expect(coarsePointerBlock).toContain("font-size: 1rem");
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

  it("主 Tab 保持动态分包，聊天预取复用同一加载入口", () => {
    const registration = readSource("src/composition/registerMainTabExtensions.ts");
    const loader = readSource("src/composition/mainTabLoaders.ts");

    expect(registration.match(/lazy\(\(\) => import\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(registration).toContain("const ChatTab = lazy(loadChatTab)");
    expect(loader).toContain('import("../tabs/ChatTab")');
    expect(loader).toContain("await loadChatTab()");
  });
});
