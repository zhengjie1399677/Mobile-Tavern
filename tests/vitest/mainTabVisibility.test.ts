import { describe, expect, it } from "vitest";
import { getVisibleBottomBarTabs, sanitizeHiddenMainTabs } from "../../src/domain/ui/mainTabVisibility";

const tabs = [
  { id: "characters", meta: { showInBottomBar: true } },
  { id: "community", meta: { showInBottomBar: true } },
  { id: "chat-history", meta: { showInBottomBar: true } },
  { id: "chat", meta: { showInBottomBar: false } },
  { id: "settings", meta: { showInBottomBar: true } },
];

describe("主 Tab 显隐", () => {
  it("隐藏用户选择的可选底栏入口", () => {
    expect(getVisibleBottomBarTabs(tabs, ["community", "chat-history"]).map(tab => tab.id))
      .toEqual(["characters", "settings"]);
  });

  it("角色与设置是恢复入口，不能被隐藏", () => {
    expect(sanitizeHiddenMainTabs(["characters", "settings", "community", "unknown"]))
      .toEqual(["community", "unknown"]);
  });

  it("保留合法的未来扩展 Tab id，让后续 UI 插件也能复用显隐设置", () => {
    expect(sanitizeHiddenMainTabs(["plugin.weather", "../unsafe", "UPPERCASE"]))
      .toEqual(["plugin.weather"]);
  });

  it("隐藏只影响底栏，不会移除页面注册", () => {
    const visible = getVisibleBottomBarTabs(tabs, ["chat-history"]);
    expect(visible.some(tab => tab.id === "chat-history")).toBe(false);
    expect(tabs.some(tab => tab.id === "chat-history")).toBe(true);
  });
});
