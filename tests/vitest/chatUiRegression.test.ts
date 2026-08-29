import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const readSource = (relativePath: string): string => (
  readFileSync(resolve(workspaceRoot, relativePath), "utf8")
);

describe("聊天界面回归守卫", () => {
  it("输入区与浮层共享居中的宽度边界", () => {
    const source = readSource("src/tabs/chat/ChatInputArea.tsx");
    expect(source).toContain("flex w-full max-w-3xl items-end");
    expect(source.match(/w-full max-w-3xl/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("编辑器保持消息侧对齐且不触发居中平滑跳动", () => {
    const source = readSource("src/tabs/chat/MessageBubble.tsx");
    expect(source).not.toContain("max-w-none");
    expect(source).toContain('block: "nearest", behavior: "auto"');
    expect(source).toContain('isUser ? "justify-end" : "justify-start"');
  });

  it("附件菜单把快捷栏放在媒体入口之前", () => {
    const source = readSource("src/tabs/chat/attachment-composer/AttachmentPicker.tsx");
    expect(source.indexOf("<span>快捷栏</span>")).toBeLessThan(source.indexOf("CHOICES.map"));
  });

  it("会话菜单直接提供新建会话、切换会话与切换人设", () => {
    const source = readSource("src/tabs/chat/ChatHeader.tsx");
    expect(source).toContain("handleStartNewSession");
    expect(source).toContain("setActiveSessionId(session.id)");
    expect(source).toContain("switchUserPersona(event.target.value)");
    expect(source).toContain("addUserPersona");
  });

  it("平行宇宙以目标角色和目录会话作为进入种子", () => {
    const source = readSource("src/components/SessionManagerModal.tsx");
    expect(source).toContain("universeCharacterId");
    expect(source).toContain("universeSeedSession");
    expect(source).toContain("setActiveCharId(session.characterId)");
    expect(source).toContain("sessions={universeSessions}");
  });

  it("手动整理提示不再声称删除消息、释放内存或暴露底层错误", () => {
    const locale = readSource("src/locales/zh-CN.ts");
    const summaryHook = readSource("src/hooks/useChat/useTimelineSummary.ts");
    expect(locale).toContain("原始消息不会被删除");
    expect(locale).not.toContain("腾出内存空间");
    expect(summaryHook).not.toContain('"记忆整理出错: " + getErrorMessage(e)');
  });
});
