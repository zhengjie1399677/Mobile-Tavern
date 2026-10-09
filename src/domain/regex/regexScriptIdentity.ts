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

/**
 * 正则脚本列表归一：SillyTavern 的 `regex_scripts` 既可能是数组，也可能是
 * `{"0": {...}}` 形式的对象（历史导出与第三方卡都存在）——数组专有方法直接调用会抛错，
 * 因此所有消费点必须先经这里归一。
 *
 * 只做容器形态归一，不逐字段修复：条目形状由调用方按现有口径判读。
 */
export function normalizeRegexScripts(value: unknown): RegexScript[] {
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === "object" ? Object.values(value) : []);
  return list.filter((item): item is RegexScript =>
    typeof item === "object" && item !== null && !Array.isArray(item));
}

/**
 * 剥离编辑器专用字段（`scope`）后的持久化形态。
 *
 * `scope` 只用于把这次编辑路由到 global／preset／character 三个列表，属于界面状态；
 * 一旦随对象写进设置或角色卡，就成了实体契约之外的字段。历史缺陷：带 `scope` 的预设
 * 在下次读取时触发实体校验失败，整条正则轨道被清空（见 `bundleMigration` 的逐条收口）。
 */
export function toPersistedRegexScript<T extends RegexScript & { scope?: unknown }>(
  script: T,
): RegexScript {
  const { scope: _scope, ...persisted } = script;
  return persisted;
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
