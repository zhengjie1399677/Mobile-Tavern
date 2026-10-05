/**
 * UI 语言读取。
 *
 * 语言由 `LanguageContext` 写入 localStorage（该键是既有事实来源，本文件只是把它暴露给
 * 非 React 场景，例如上下文来源的日期/时间格式化）。
 */

export const UI_LANGUAGE_STORAGE_KEY = "mobile_tavern_language";

/** 读取 UI 语言；未设置时回落到浏览器语言，再回落到 zh-CN。 */
export function readUiLanguage(): string {
  try {
    const stored = globalThis.localStorage?.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage 在部分环境不可用（隐私模式/测试替身），继续回落。
  }
  return globalThis.navigator?.language || "zh-CN";
}
