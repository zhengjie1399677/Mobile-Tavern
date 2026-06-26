import { LorebookEntry } from "../../types";

// 提取 nextObj 相对于 baseObj 的增量差异（深层嵌套对象比较）。
// 当某属性发生变更时仅保留变化部分，未变更字段返回 undefined 表示无差异。
export const getNestedDelta = (nextObj: any, baseObj: any): any => {
  if (!nextObj || typeof nextObj !== "object") return undefined;
  if (!baseObj || typeof baseObj !== "object") return nextObj;

  const delta: any = {};
  let hasChanges = false;

  for (const key of Object.keys(nextObj)) {
    const nextVal = nextObj[key];
    const baseVal = baseObj[key];

    if (nextVal !== baseVal) {
      if (key === "savedPresets") {
        delta[key] = nextVal;
        hasChanges = true;
      } else if (nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
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

// 将 source 深度合并到 target 上，返回新对象。数组会被整体替换。
export const deepMerge = (target: any, source: any): any => {
  if (!source || typeof source !== "object") return source !== undefined ? source : target;
  if (!target || typeof target !== "object") {
    return Array.isArray(source) ? [...source] : { ...source };
  }

  const result = Array.isArray(target) ? [...target] : { ...target };

  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      result[key] = deepMerge(target[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
};

// 规范化世界书条目：保证 keys 始终为字符串数组。
// 历史数据可能以逗号分隔字符串形式存储，这里统一转换为数组。
export const cleanLorebookEntry = (entry: any): LorebookEntry => {
  if (!entry) return entry;
  return {
    ...entry,
    keys: Array.isArray(entry.keys)
      ? entry.keys
      : typeof entry.keys === "string"
        ? (entry.keys as string)
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
  };
};
