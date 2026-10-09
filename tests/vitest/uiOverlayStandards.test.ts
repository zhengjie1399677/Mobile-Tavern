import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");

const interactiveOverlaySources = [
  "src/components/MemoryTableDrawer.tsx",
  "src/components/MemoryFragmentEditor.tsx",
  "src/components/community/CommunityCardDetail.tsx",
  "src/tabs/CommunityTab.tsx",
  "src/components/plugins/AgentHostDiagnosticsModal.tsx",
  "src/components/ThemeEditorModal.tsx",
  "src/components/FloatingCharacter.tsx",
  // 正则编辑 Modal 已从 RegexManagementSection 拆到 RegexEditorDialog，
  // 统一 Dialog / 返回键栈的守卫随之迁移到浮层实际所在文件（同等语义）。
  "src/components/presetForm/RegexEditorDialog.tsx",
  "src/components/plugins/PluginManagerSection.tsx",
  "src/components/plugins/ToolPluginManagerSection.tsx",
] as const;

describe("移动端互动浮层规范", () => {
  it.each(interactiveOverlaySources)("%s 使用统一 Dialog、可访问标题与返回键栈", (relativePath) => {
    const source = readFileSync(resolve(workspaceRoot, relativePath), "utf8");

    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogTitle");
    expect(source).toContain("useMobileBackHandler");
    expect(source).not.toContain("fixed inset-0");
  });
});
