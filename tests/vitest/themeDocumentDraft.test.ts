import { describe, expect, it } from "vitest";
import {
  buildThemeDocumentCandidate,
  cloneThemeDocumentDraft,
  createThemeDocumentDraft,
  isThemeDocumentDirty,
  upsertCustomThemePackage,
} from "../../src/domain/themes/themeDocumentDraft";
import type { CustomThemePackage } from "../../src/utils/themePackage";

const EXISTING_THEME: CustomThemePackage = {
  schemaVersion: "1.1",
  id: "custom_existing",
  importedAt: 123,
  name: "已有主题",
  version: "2.0.0",
  description: "保留高级字段",
  isDark: true,
  variables: {
    "--background": "#111111",
    "--primary": "#88aaff",
  },
  customCss: "[data-ui=\"main-tab-bar\"] { opacity: .95; }",
  state: {
    awake: { type: "boolean", default: false },
  },
  interactions: [],
};

describe("主题工作室草稿", () => {
  it("从已有主题创建独立草稿，不会反向修改正式主题", () => {
    const draft = createThemeDocumentDraft(EXISTING_THEME);
    draft.theme.variables["--primary"] = "#ffffff";

    expect(EXISTING_THEME.variables["--primary"]).toBe("#88aaff");
    expect(draft.interactionSource).toContain("awake");
    expect(draft.baseline).not.toBe(draft.theme);
  });

  it("判断草稿是否存在未保存修改", () => {
    const draft = createThemeDocumentDraft(EXISTING_THEME);
    expect(isThemeDocumentDirty(draft)).toBe(false);

    const changed = cloneThemeDocumentDraft(draft);
    changed.theme.description = "新的说明";
    expect(isThemeDocumentDirty(changed)).toBe(true);
  });

  it("保存时保留原 ID，并根据交互内容选择 Theme 1.1", () => {
    const draft = createThemeDocumentDraft(EXISTING_THEME);
    draft.theme.name = " 已有主题 ";

    const result = buildThemeDocumentCandidate(draft, []);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.theme.id).toBe("custom_existing");
    expect(result.theme.importedAt).toBe(123);
    expect(result.theme.schemaVersion).toBe("1.1");
    expect(result.theme.name).toBe("已有主题");
  });

  it("空交互草稿生成 Theme 1.0，并拒绝同名主题", () => {
    const draft = createThemeDocumentDraft(null);
    draft.theme.name = "新主题";
    draft.interactionSource = JSON.stringify({ media: {}, state: {}, interactions: [] });

    const duplicate = buildThemeDocumentCandidate(draft, [{
      ...EXISTING_THEME,
      id: "custom_other",
      name: "新主题",
    }]);
    expect(duplicate.success).toBe(false);

    const result = buildThemeDocumentCandidate(draft, []);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.theme.schemaVersion).toBe("1.0");
    expect(result.theme.media).toBeUndefined();
    expect(result.theme.state).toBeUndefined();
    expect(result.theme.interactions).toBeUndefined();
  });

  it("交互 JSON 解析失败时保留错误而不生成主题", () => {
    const draft = createThemeDocumentDraft(null);
    draft.interactionSource = "{";

    const result = buildThemeDocumentCandidate(draft, []);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]).toContain("JSON");
  });

  it("同一新主题连续保存时按 ID 更新而不是产生重复项", () => {
    const first = { ...EXISTING_THEME, id: "custom_new", name: "新主题" };
    const second = { ...first, description: "第二次保存" };

    const once = upsertCustomThemePackage([], first);
    const twice = upsertCustomThemePackage(once, second);

    expect(twice).toHaveLength(1);
    expect(twice[0].description).toBe("第二次保存");
  });
});
