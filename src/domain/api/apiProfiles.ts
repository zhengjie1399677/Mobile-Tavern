/**
 * API 通道档案（`ApiProfile`）与当前表单（`ApiConfig`）之间的纯投影规则。
 *
 * 背景（2026-10-06 缺陷修复）：档案此前只有“另存”，没有任何把表单写回档案的路径，
 * 且编辑 Base URL / API Key 会立刻清空 `currentApiProfileId`。用户以为在编辑“档案 B”，
 * 实际改的是临时表单，再点“另存”就复制出内容一模一样的第二条档案——看起来像两条
 * 档案被“合并”了。现在投影、脏检查与写回共用同一份字段清单，语义只有一个来源。
 */

import type { ApiConfig, ApiProfile } from "../../types";

/**
 * 档案承载的字段清单。
 *
 * `ApiConfig` 另有 `savedUrls` / `contextLimit` / `sendNames` 等“当前表单专属”字段，
 * 不属于档案，切换档案时不得被覆盖。
 */
export const API_PROFILE_FIELDS = [
  "type",
  "baseUrl",
  "apiKey",
  "modelName",
  "chatPath",
  "modelsPath",
  "bypassProxy",
  "disableReasoning",
  "reasoningStrength",
  "forceBasicParams",
  "supportsVision",
  "supportsAudioInput",
] as const;

export type ApiProfileField = (typeof API_PROFILE_FIELDS)[number];

/** 档案承载的字段子集（id / name 之外的投影结果）。 */
export type ApiProfileFields = Pick<ApiProfile, ApiProfileField>;

/**
 * 只取档案字段。
 *
 * 逐字段显式拷贝（而不是遍历清单）以保持返回类型精确；清单与拷贝字段必须一致，
 * 由 `tests/vitest/apiProfiles.test.ts` 的字面量同步守卫强制。
 *
 * 缺省字段保持 `undefined`：与历史“选择通道即整体覆盖表单”语义逐字一致，
 * 避免旧行为里用 `undefined` 表达“使用默认路径”的路径被悄悄改成保留旧值。
 */
export function pickApiProfileFields(source: ApiConfig | ApiProfile): ApiProfileFields {
  return {
    type: source.type,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    modelName: source.modelName,
    chatPath: source.chatPath,
    modelsPath: source.modelsPath,
    bypassProxy: source.bypassProxy,
    disableReasoning: source.disableReasoning,
    reasoningStrength: source.reasoningStrength,
    forceBasicParams: source.forceBasicParams,
    supportsVision: source.supportsVision,
    supportsAudioInput: source.supportsAudioInput,
  };
}

/** 选择通道：把档案字段整体投影到当前表单，表单专属字段（历史地址等）保持不变。 */
export function applyApiProfileToApi(api: ApiConfig, profile: ApiProfile): ApiConfig {
  return { ...api, ...pickApiProfileFields(profile) };
}

/** “另存”：用当前表单构造一条新档案。 */
export function createApiProfileFromApi(api: ApiConfig, id: string, name: string): ApiProfile {
  return { id, name, ...pickApiProfileFields(api) };
}

/**
 * 表单是否与档案不一致（“未保存”标记与切换确认的唯一判据）。
 *
 * 只比较档案承载的字段；`undefined` 与 `undefined` 相等，因此“刚选中档案”必然为 false。
 */
export function isApiProfileDirty(api: ApiConfig, profile: ApiProfile): boolean {
  const current = pickApiProfileFields(api);
  for (const field of API_PROFILE_FIELDS) {
    if (current[field] !== profile[field]) return true;
  }
  return false;
}
