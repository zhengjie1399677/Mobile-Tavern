import type { SamplerPreset, UserSettings } from "../../types";
import type { RuntimeProfileSamplingSettings } from "../runtimeProfiles/contracts";
import { applyPresetBundleActivation } from "./presetBundleLifecycle";

/**
 * Agent Profile 绑定的行为预设与采样，在启动该 Profile 时**一次性**套用。
 *
 * 为什么不是"按会话冻结"：会话级锁定会让用户在设置页换的预设不进入请求，
 * 表现成"切换预设没用"。可复现性由 Agent 身份快照与 Agent Journal 承担，
 * 不需要靠锁死配置（见 `resolveAgentSessionSettings` 的不变量）。
 * 因此绑定只在启动那一刻写回设置，之后预设与采样完全由用户自由切换。
 */

/** Profile 中可一次性套用到的行为绑定。 */
export interface AgentProfilePresetBinding {
  readonly promptPresetId?: string;
  readonly sampling?: RuntimeProfileSamplingSettings;
}

export type AgentProfilePresetBindingOutcome = "applied" | "none" | "preset-missing";

export interface AgentProfilePresetBindingResult {
  readonly outcome: AgentProfilePresetBindingOutcome;
  readonly settings: UserSettings;
  /** outcome 为 `preset-missing` 时给出缺失的预设 id，供调用方提示用户重新绑定。 */
  readonly missingPresetId?: string;
}

/**
 * 计算套用绑定后的设置。纯函数，可先预览再落库。
 *
 * 不变量：
 * - 没有绑定（或绑定为空）时返回原设置引用，不产生无意义的设置写入。
 * - 绑定的预设已被删除时**绝不**静默换成别的预设，只套用采样并报告 `preset-missing`。
 * - 采样覆盖只叠加在预设采样之上，不触碰 Provider、API Key 等无关字段。
 */
export function applyAgentProfilePresetBinding(
  settings: UserSettings,
  binding: AgentProfilePresetBinding | undefined,
  presetDefaults: SamplerPreset,
): AgentProfilePresetBindingResult {
  const presetId = binding?.promptPresetId;
  const sampling = binding?.sampling;
  if (!presetId && !sampling) return { outcome: "none", settings };

  const withSampling = (base: UserSettings): UserSettings =>
    sampling ? { ...base, preset: { ...base.preset, ...sampling } } : base;

  if (presetId) {
    const bundle = (settings.savedPresets ?? []).find((candidate) => candidate.id === presetId);
    if (!bundle) {
      return {
        outcome: "preset-missing",
        settings: withSampling(settings),
        missingPresetId: presetId,
      };
    }
    return {
      outcome: "applied",
      settings: withSampling(applyPresetBundleActivation(settings, bundle, presetDefaults)),
    };
  }

  return { outcome: "applied", settings: withSampling(settings) };
}
