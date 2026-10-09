import type { PresetPromptConfig, PromptConfig } from "../../types";

/**
 * 预设与全局设置之间的 Prompt 字段搬运。
 *
 * 预设只拥有传统 `promptConfig`：提取时按值拷贝，激活时整体替换（预设未声明的字段
 * 必须回到运行期出厂默认，绝不保留上一个预设的残留值）。
 */

/** 从完整设置中提取预设可拥有的 Prompt 字段。 */
export function toPresetPromptConfig(config: PromptConfig): PresetPromptConfig {
  return { ...config };
}

/** 应用预设的 Prompt 字段：整体替换，不做字段级合并。 */
export function applyPresetPromptConfig(_current: PromptConfig, stored: PresetPromptConfig): PromptConfig {
  return { ...stored };
}

/**
 * 预设快照的稳定序列化：键序无关、忽略 `undefined`。
 *
 * 切换脏检查与启动期引导的落库判断必须共用同一套比较语义，否则同一份数据会出现
 * "一边认为脏、一边认为干净"的分歧。
 */
export function stableSerializePresetSnapshot(value: unknown): string {
  return JSON.stringify(normalizeForPresetSnapshot(value));
}

function normalizeForPresetSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForPresetSnapshot);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      normalized[key] = normalizeForPresetSnapshot(item);
    }
    return normalized;
  }
  return value;
}
