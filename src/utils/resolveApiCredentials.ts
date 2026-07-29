import type { UserSettings } from "../types";
import { FALLBACK_MODEL, TRIAL_OPENROUTER_KEY } from "./apiClient";
import { getTrialCount } from "../hooks/useChat/helpers";

/** Trial 配额耗尽时抛出；调用方应 catch 后向用户提示并中断流程。 */
export class TrialExhaustedError extends Error {
  constructor(message = "Trial quota exhausted") {
    super(message);
    this.name = "TrialExhaustedError";
    Object.setPrototypeOf(this, TrialExhaustedError.prototype);
  }
}

/** 用户已配置 apiKey 但未选 modelName 时抛出（仅在 requireModel: true 模式下）。 */
export class ModelNotConfiguredError extends Error {
  constructor(message = "Model not configured") {
    super(message);
    this.name = "ModelNotConfiguredError";
    Object.setPrototypeOf(this, ModelNotConfiguredError.prototype);
  }
}

/** 试用 key 动态拉取失败时抛出；调用方应 catch 后提示用户试用服务暂不可用。 */
export class TrialKeyFetchError extends Error {
  constructor(message = "Failed to fetch trial key") {
    super(message);
    this.name = "TrialKeyFetchError";
    Object.setPrototypeOf(this, TrialKeyFetchError.prototype);
  }
}

export interface ResolvedApiCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  chatPath: string | undefined;
  isTrial: boolean;
}

export interface ResolveOptions {
  /**
   * 当用户已配置 apiKey 但未选 modelName 时是否抛 ModelNotConfiguredError。
   * - 交互式调用（如点击发送 / 重发按钮）应传 true，提示用户去配置；
   * - 后台任务（如自动摘要）应传 false 或不传，直接走 FALLBACK_MODEL，
   *   避免后台失败时弹 alert 打扰用户。
   */
  requireModel?: boolean;
}

/** OpenRouter 免 Key 试用端点配置。 */
const TRIAL_BASE_URL = "https://openrouter.ai/api/v1";
const TRIAL_MODEL = "openrouter/free";
/** 免 Key 试用次数上限。 */
const TRIAL_QUOTA = 10;

/**
 * 解析最终 API 调用参数：用户已配置 key 则用用户配置，否则走 OpenRouter 免 key 试用。
 *
 * 行为契约：
 * - 当用户 key 缺失（空或纯空白）且试用次数已耗尽时，抛 TrialExhaustedError；
 *   调用方必须 catch 后向用户提示并中断当前流程。
 * - 当 requireModel=true 且用户已配置 key 但 modelName 缺失时，抛 ModelNotConfiguredError。
 * - 返回值中 isTrial 标记当前是否处于 trial 模式，调用方应在请求成功后调用
 *   incrementTrialCount() 计数。
 *
 * 该 helper 用于收口 useSendMessage / useRerollMessage / AutoSummaryService /
 * MemorySummary 四处重复的 trial 解析逻辑，统一行为避免漏改。
 */
export function resolveApiCredentials(
  settings: UserSettings,
  options: ResolveOptions = {}
): ResolvedApiCredentials {
  const finalModel = settings.api.modelName || FALLBACK_MODEL;
  const finalChatPath = settings.api.chatPath;

  if (settings.api.apiKey && settings.api.apiKey.trim()) {
    if (options.requireModel && !settings.api.modelName) {
      throw new ModelNotConfiguredError();
    }
    return {
      apiKey: settings.api.apiKey,
      baseUrl: settings.api.baseUrl,
      model: finalModel,
      chatPath: finalChatPath,
      isTrial: false,
    };
  }

  // Trial 模式：先检查配额
  if (getTrialCount() >= TRIAL_QUOTA) {
    throw new TrialExhaustedError();
  }

  return {
    apiKey: TRIAL_OPENROUTER_KEY,
    baseUrl: TRIAL_BASE_URL,
    model: TRIAL_MODEL,
    chatPath: undefined,
    isTrial: true,
  };
}
