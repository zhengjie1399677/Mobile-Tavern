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

  it("空交互草稿生成 Theme 1.0，遇到同名主题自动递增命名", () => {
    const draft = createThemeDocumentDraft(null);
    draft.theme.name = "新主题";
    draft.interactionSource = JSON.stringify({ media: {}, state: {}, interactions: [] });

    // 第一次冲突：自动递增为 "新主题 1"
    const duplicate1 = buildThemeDocumentCandidate(draft, [{
      ...EXISTING_THEME,
      id: "custom_other",
      name: "新主题",
    }]);
    expect(duplicate1.success).toBe(true);
    if (!duplicate1.success) return;
    expect(duplicate1.theme.name).toBe("新主题 1");

    // 第二次冲突（已有 "新主题" 和 "新主题 1"）：自动递增为 "新主题 2"
    const duplicate2 = buildThemeDocumentCandidate(draft, [
      { ...EXISTING_THEME, id: "custom_1", name: "新主题" },
      { ...EXISTING_THEME, id: "custom_2", name: "新主题 1" },
    ]);
    expect(duplicate2.success).toBe(true);
    if (!duplicate2.success) return;
    expect(duplicate2.theme.name).toBe("新主题 2");

    // 若原名已带无空格数字如 "新自定义主题1"，递增为 "新自定义主题2"
    draft.theme.name = "新自定义主题1";
    const duplicate3 = buildThemeDocumentCandidate(draft, [
      { ...EXISTING_THEME, id: "custom_3", name: "新自定义主题1" },
    ]);
    expect(duplicate3.success).toBe(true);
    if (!duplicate3.success) return;
    expect(duplicate3.theme.name).toBe("新自定义主题2");

    // 无冲突时保留原名并正确处理 Theme 1.0 字段
    draft.theme.name = "独一无二主题";
    const result = buildThemeDocumentCandidate(draft, []);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.theme.name).toBe("独一无二主题");
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
