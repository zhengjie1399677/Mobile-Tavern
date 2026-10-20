/**
 * 新建主题的起点模板。
 *
 * 模板只提供合法的初始变量；复制时必须剥离 `id/importedAt`，否则保存会覆盖源主题。
 */

import type { CustomThemePackage } from "../../utils/themePackage";
import {
  createThemeDocumentDraft,
  NEUTRAL_DARK_THEME,
  type ThemeDocumentDraft,
} from "./themeDocumentDraft";

const MAX_THEME_NAME_LENGTH = 40;

export const NEUTRAL_LIGHT_THEME: CustomThemePackage = {
  schemaVersion: "1.0",
  name: "新浅色主题",
  version: "1.0.0",
  description: "",
  isDark: false,
  variables: {
    "--background": "#f6f7f9",
    "--foreground": "#18181b",
    "--card": "#ffffff",
    "--card-foreground": "#18181b",
    "--popover": "#ffffff",
    "--popover-foreground": "#18181b",
    "--primary": "#2563eb",
    "--primary-foreground": "#ffffff",
    "--secondary": "#e4e4e7",
    "--secondary-foreground": "#18181b",
    "--muted": "#eceef2",
    "--muted-foreground": "#52525b",
    "--accent": "#e0e7ff",
    "--accent-foreground": "#1e1b4b",
    "--destructive": "#dc2626",
    "--destructive-foreground": "#ffffff",
    "--border": "#d4d4d8",
    "--input": "#ffffff",
    "--ring": "#2563eb",
    "--radius": "0.6rem",
    "--dialogue-color": "#18181b",
    "--prose-color": "#3f3f46",
  },
  customCss: "",
};

export type ThemeStartPointKind = "blank-dark" | "blank-light" | "clone";

/** 生成不重复的副本名；超过 40 字符时截断。 */
export function createUniqueThemeCopyName(
  name: string,
  existingNames: readonly string[],
  suffix = "副本",
): string {
  const base = name.trim() || "未命名主题";
  const suffixText = suffix.trim() ? ` ${suffix.trim()}` : "";
  const taken = new Set(existingNames.map(item => item.trim().toLocaleLowerCase()));

  const build = (index: number): string => {
    const tail = index > 1 ? ` ${index}` : "";
    return `${base}${suffixText}${tail}`.slice(0, MAX_THEME_NAME_LENGTH);
  };

  for (let index = 1; index < 1000; index += 1) {
    const candidate = build(index);
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${base.slice(0, MAX_THEME_NAME_LENGTH - 6)} ${Date.now()}`.slice(0, MAX_THEME_NAME_LENGTH);
}

/** 从模板创建新草稿：剥离运行时标识，基线即模板本身，因此新草稿不脏。 */
export function createThemeDocumentDraftFromTemplate(
  template: CustomThemePackage,
  name = template.name,
): ThemeDocumentDraft {
  const clone = JSON.parse(JSON.stringify(template)) as CustomThemePackage;
  clone.name = name.slice(0, MAX_THEME_NAME_LENGTH);
  delete clone.id;
  delete clone.importedAt;
  return createThemeDocumentDraft(clone);
}

export function getBlankThemeTemplate(kind: "blank-dark" | "blank-light"): CustomThemePackage {
  return kind === "blank-light" ? NEUTRAL_LIGHT_THEME : NEUTRAL_DARK_THEME;
}
