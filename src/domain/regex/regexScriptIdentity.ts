import type { RegexScript } from "../../types";

/**
 * 正则脚本的稳定身份：优先 `id`，缺 `id` 的历史脚本（SillyTavern 卡片/旧预设常见）回落到 `scriptName`。
 *
 * 三处调用点必须共用同一口径：列表 key、开关/删除的目标、编辑保存的匹配。
 * 过去全局/预设轨只比较 `r.id === reg.id`，两个都缺 id 时会 `undefined === undefined` 命中，
 * 保存一条就把列表里所有缺 id 的脚本一起覆盖成同一条。
 */
export function regexScriptKey(script: Pick<RegexScript, "id" | "scriptName">): string {
  const id = typeof script.id === "string" ? script.id.trim() : "";
  if (id) return id;
  return typeof script.scriptName === "string" ? script.scriptName.trim() : "";
}

/** 按稳定身份写入脚本：命中则原地替换，未命中则追加。列表顺序保持稳定。 */
export function upsertRegexScriptByKey(
  scripts: readonly RegexScript[],
  script: RegexScript,
): RegexScript[] {
  const key = regexScriptKey(script);
  const index = key ? scripts.findIndex((item) => regexScriptKey(item) === key) : -1;
  if (index === -1) return [...scripts, script];
  const next = [...scripts];
  next[index] = script;
  return next;
}

/**
 * 按稳定身份打开/关闭脚本。
 *
 * 命中项未发生实际变化时返回**原数组**，便于调用方判定"这次操作不产生写入"
 * （`updateSettings` 的写入会落到 IndexedDB，空写要避免）。
 */
export function setRegexScriptDisabledByKey(
  scripts: readonly RegexScript[],
  key: string,
  disabled: boolean,
): RegexScript[] {
  let changed = false;
  const next = scripts.map((script) => {
    if (regexScriptKey(script) !== key || script.disabled === disabled) return script;
    changed = true;
    return { ...script, disabled };
  });
  return changed ? next : (scripts as RegexScript[]);
}

/** 按稳定身份删除脚本；未命中时返回原数组（同上，避免空写）。 */
export function removeRegexScriptByKey(
  scripts: readonly RegexScript[],
  key: string,
): RegexScript[] {
  const next = scripts.filter((script) => regexScriptKey(script) !== key);
  return next.length === scripts.length ? (scripts as RegexScript[]) : next;
}
