import { describe, expect, it } from "vitest";
import {
  buildThemeDocumentCandidate,
  isThemeDocumentDirty,
} from "../../src/domain/themes/themeDocumentDraft";
import {
  createThemeDocumentDraftFromTemplate,
  createUniqueThemeCopyName,
  getBlankThemeTemplate,
  NEUTRAL_LIGHT_THEME,
} from "../../src/domain/themes/themeStartPoints";
import { validateThemePackage, type CustomThemePackage } from "../../src/utils/themePackage";

const SOURCE: CustomThemePackage = {
  ...NEUTRAL_LIGHT_THEME,
  id: "custom_source",
  importedAt: 123,
  name: "源主题",
};

describe("主题起点模板", () => {
  it("深色/浅色空白模板都能通过包校验", () => {
    expect(validateThemePackage(getBlankThemeTemplate("blank-dark")).valid).toBe(true);
    expect(validateThemePackage(getBlankThemeTemplate("blank-light")).valid).toBe(true);
  });

  it("复制模板会剥离 id/importedAt，且新草稿不脏", () => {
    const draft = createThemeDocumentDraftFromTemplate(SOURCE, "源主题 副本");
    expect(draft.theme.id).toBeUndefined();
    expect(draft.theme.importedAt).toBeUndefined();
    expect(draft.theme.name).toBe("源主题 副本");
    expect(isThemeDocumentDirty(draft)).toBe(false);
  });

  it("副本保存时生成新 ID，不覆盖源主题", () => {
    const draft = createThemeDocumentDraftFromTemplate(SOURCE, "源主题 副本");
    const result = buildThemeDocumentCandidate(draft, [SOURCE]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.theme.id).not.toBe("custom_source");
      expect(result.theme.name).toBe("源主题 副本");
    }
  });

  it("副本名不重复且不超过 40 字符", () => {
    const name = createUniqueThemeCopyName("源主题", ["源主题 副本", "源主题 副本 2"]);
    expect(name).toBe("源主题 副本 3");

    const longName = createUniqueThemeCopyName("很长的主题名称".repeat(10), []);
    expect(longName.length).toBeLessThanOrEqual(40);
  });
});
