import type { PresetBundle } from "../../domain/presets/contracts";

/**
 * 预设拥有的设置字段边界。
 *
 * `savedPresets` 逻辑上属于预设业务域、物理上落在独立的 `saved_presets_bundle` 键里，
 * 但历史上它同时挂在 `UserSettings` 上，于是"写设置时剔除、合并时整体替换"变成了
 * 两处各自 `delete` / 特判的隐式约定（`ARCH-FLOW`）。这里把它收敛成唯一来源：
 * 所有写设置主记录的路径都必须经过 `withoutPresetOwnedSettings`。
 */

/** 逻辑上属于预设业务域、禁止写入设置主记录的键。 */
export const PRESET_OWNED_SETTINGS_KEYS: readonly string[] = ["savedPresets"];

/**
 * 复制一份设置并剔除预设拥有的字段。
 *
 * 参数与返回类型保持一致（`savedPresets` 本身是可选字段），调用方无需额外断言；
 * 底层只做浅拷贝 + 删除，不触碰其它字段。
 */
export function withoutPresetOwnedSettings<T extends { savedPresets?: PresetBundle[] }>(
  settings: T,
): T {
  const next = { ...settings };
  const mutable = next as { savedPresets?: PresetBundle[] };
  for (const key of PRESET_OWNED_SETTINGS_KEYS) {
    delete mutable[key as keyof typeof mutable];
  }
  return next;
}
