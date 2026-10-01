import { LorebookEntry } from "../../types";

/**
 * 设置合并工具。
 *
 * 历史上这些函数全部使用 `any`，调用方无法从类型上判断返回值形状（`QUALITY-TYPES`）。
 * 这里只做类型收口：合并语义与历史行为逐字一致。
 */

/**
 * 必须整体替换、禁止深合并的设置键。
 *
 * `savedPresets` 是预设列表：逐项深合并会留下被删除预设的字段，也会让「整体替换」
 * 语义在持久化层被悄悄破坏。预设列表的权威落库入口是 `PresetService` 的
 * `saved_presets_bundle`；这里保留整体替换语义用于旧设置对象的兼容路径。
 */
export const WHOLE_REPLACE_SETTINGS_KEYS: readonly string[] = ["savedPresets"];

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 提取 `nextObj` 相对 `baseObj` 的增量差异（深层嵌套对象比较）。
 *
 * 发生变更的属性只保留变化部分；无差异时返回 `undefined` 表示无需写入。
 */
export const getNestedDelta = (nextObj: unknown, baseObj: unknown): Record<string, unknown> | undefined => {
  if (!nextObj || typeof nextObj !== "object") return undefined;
  if (!baseObj || typeof baseObj !== "object") return nextObj as Record<string, unknown>;

  const next = nextObj as Record<string, unknown>;
  const base = baseObj as Record<string, unknown>;
  const delta: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(next)) {
    const nextVal = next[key];
    const baseVal = base[key];

    if (nextVal !== baseVal) {
      if (WHOLE_REPLACE_SETTINGS_KEYS.includes(key)) {
        delta[key] = nextVal;
        hasChanges = true;
      } else if (isMergeableObject(nextVal)) {
        const subDelta = getNestedDelta(nextVal, baseVal);
        if (subDelta !== undefined) {
          delta[key] = subDelta;
          hasChanges = true;
        }
      } else {
        delta[key] = nextVal;
        hasChanges = true;
      }
    }
  }
  return hasChanges ? delta : undefined;
};

/** 将 `source` 深度合并到 `target` 上，返回新对象。数组会被整体替换。 */
export const deepMerge = <T>(target: T, source: unknown): T => {
  if (!source || typeof source !== "object") {
    return (source !== undefined ? source : target) as T;
  }

  const sourceRecord = source as Record<string, unknown>;
  if (!target || typeof target !== "object") {
    return (Array.isArray(source) ? [...source] : { ...sourceRecord }) as T;
  }

  // 数组分支保留历史行为：沿用数组本身，仅按键覆盖。
  const result: Record<string, unknown> = Array.isArray(target)
    ? ([...target] as unknown as Record<string, unknown>)
    : { ...(target as Record<string, unknown>) };

  for (const key of Object.keys(sourceRecord)) {
    const val = sourceRecord[key];
    if (isMergeableObject(val)) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
};

/**
 * 规范化世界书条目：保证 `keys` 始终为字符串数组。
 *
 * 历史数据可能以逗号分隔字符串形式存储，这里统一转换为数组；其余字段原样保留。
 */
export const cleanLorebookEntry = (entry: LorebookEntry): LorebookEntry => {
  if (!entry) return entry;
  const storedKeys: unknown = entry.keys;
  if (Array.isArray(storedKeys)) return entry;
  if (typeof storedKeys === "string") {
    return {
      ...entry,
      keys: storedKeys
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    };
  }
  return { ...entry, keys: [] };
};
