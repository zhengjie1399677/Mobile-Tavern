/**
 * 推理强度控制：把统一档位意图映射为各厂商方言。
 *
 * 兼容立场（属于模型能力表豁免范围）：
 * - 统一档位只有一套（auto/off/low/medium/high/max），设置与 UI 只保存其中一个；
 * - 各模型家族在这里声明"可选择档位 + 编码方式"，厂商差异不泄漏到调用方；
 * - 请求了该模型不支持的档位时收敛到最近可用档位，只支持开关的模型把低/中/高/极高折叠为"开"；
 * - 未识别的端点/模型不注入任何字段，避免严格网关 400；
 * - 旧布尔 disableReasoning 归一化为 off，与既有行为保持逐字段一致。
 */
import type { ReasoningStrength } from "../../../types";
import type { ProviderFamily } from "./types";
import { resolveProviderIdentity } from "./providerIdentity";

/** 厂商侧编码方式：枚举值、开关、token 预算或不可控制。 */
export type ReasoningDialect = "effort" | "switch" | "budget" | "none";

export interface ReasoningControlSupport {
  dialect: ReasoningDialect;
  /** 可显式选择的档位（不含始终可用的 auto）；空数组代表该模型没有强度控制。 */
  selectableLevels: ReasoningStrength[];
}

export interface ReasoningRequestContext {
  /** 请求体中的输出上限；预算式方言据此夹取（Anthropic budget_tokens 必须小于 max_tokens）。 */
  maxTokens?: number;
}

export interface ReasoningRequestPlan {
  /** 需要合并进请求体的厂商字段；不可用或无需注入时为空对象。 */
  params: Record<string, unknown>;
  /** Anthropic 开启思考时要求 temperature=1，且不能同时携带 top_p/top_k。 */
  anthropicThinkingEnabled: boolean;
}

type ExplicitLevel = Exclude<ReasoningStrength, "auto">;

const NO_PLAN: ReasoningRequestPlan = { params: {}, anthropicThinkingEnabled: false };

const LEVEL_ORDER: readonly ReasoningStrength[] = ["auto", "off", "low", "medium", "high", "max"];

/** 通用 reasoning_effort 取值；max 在未声明支持的模型上折叠为 high。 */
const EFFORT_VALUE: Record<ExplicitLevel, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  max: "high",
};

/** Anthropic 思考预算（token）；发送前按输出上限与最小预算夹取。 */
const ANTHROPIC_BUDGET_TOKENS: Record<Exclude<ExplicitLevel, "off">, number> = {
  low: 2048,
  medium: 8192,
  high: 24576,
  max: 32768,
};
const ANTHROPIC_MIN_BUDGET_TOKENS = 1024;

interface ReasoningProfile {
  dialect: ReasoningDialect;
  selectable: readonly ExplicitLevel[];
  build: (level: ExplicitLevel, context: ReasoningRequestContext) => ReasoningRequestPlan | null;
}

const NONE_PROFILE: ReasoningProfile = {
  dialect: "none",
  selectable: [],
  build: () => null,
};

/** thinking: { type: "enabled" | "disabled" } 方言（DeepSeek / GLM）。 */
const THINKING_SWITCH_PROFILE: ReasoningProfile = {
  dialect: "switch",
  selectable: ["off", "low", "medium", "high", "max"],
  build: (level) => ({
    params: { thinking: { type: level === "off" ? "disabled" : "enabled" } },
    anthropicThinkingEnabled: false,
  }),
};

export function isReasoningStrength(value: unknown): value is ReasoningStrength {
  return typeof value === "string" && (LEVEL_ORDER as readonly string[]).includes(value);
}

/**
 * 归一化设置来源：优先显式推理强度，其次旧的布尔开关。
 * 旧字段 true 等价于 off，false/缺省等价于 auto（不注入任何字段）。
 */
export function normalizeReasoningStrength(input: {
  reasoningStrength?: unknown;
  disableReasoning?: unknown;
}): ReasoningStrength {
  if (isReasoningStrength(input.reasoningStrength)) return input.reasoningStrength;
  if (input.disableReasoning === true) return "off";
  return "auto";
}

/** 解析该端点/模型可选择的强度档位，供设置界面与诊断使用。 */
export function resolveReasoningControl(modelId: string, baseUrl?: string): ReasoningControlSupport {
  const profile = resolveProfile(baseUrl, modelId);
  return { dialect: profile.dialect, selectableLevels: [...profile.selectable] };
}

/**
 * 生成某档位对应的厂商请求字段。
 * 不支持的档位收敛到最近可用档位；无控制能力或预算无法满足时返回空计划。
 */
export function buildReasoningRequestPlan(
  strength: ReasoningStrength,
  modelId: string,
  baseUrl?: string,
  context: ReasoningRequestContext = {},
): ReasoningRequestPlan {
  if (strength === "auto") return NO_PLAN;
  const profile = resolveProfile(baseUrl, modelId);
  if (profile.selectable.length === 0) return NO_PLAN;
  const level = clampReasoningLevel(strength, profile.selectable);
  return profile.build(level, context) ?? NO_PLAN;
}

/** 兼容入口：旧"关闭推理"开关等价于 off 档位。 */
export function buildReasoningDisableParams(modelId: string, baseUrl?: string): Record<string, unknown> {
  return buildReasoningRequestPlan("off", modelId, baseUrl).params;
}

function resolveProfile(baseUrl: string | undefined, modelId: string): ReasoningProfile {
  const family = resolveProviderIdentity(baseUrl, modelId).family;
  const leaf = leafModelId(modelId);
  switch (family) {
    case "openai":
      return resolveOpenAiProfile(leaf);
    case "anthropic":
      return resolveAnthropicProfile(leaf);
    case "deepseek":
      return resolveDeepSeekProfile(leaf);
    case "glm":
      return leaf.startsWith("glm-5.3") ? NONE_PROFILE : THINKING_SWITCH_PROFILE;
    case "gemini":
      return resolveGeminiProfile(leaf);
    case "qwen":
      return resolveQwenProfile(leaf);
    default:
      return NONE_PROFILE;
  }
}

function resolveOpenAiProfile(leaf: string): ReasoningProfile {
  // GPT-5.1+ 全系列支持 none（可完全关闭思考）；5.6 起额外支持 max。
  if (/^gpt-5\.\d/.test(leaf)) {
    const supportsMax = /^gpt-5\.(?:[6-9]|\d{2,})/.test(leaf);
    return {
      dialect: "effort",
      selectable: supportsMax
        ? ["off", "low", "medium", "high", "max"]
        : ["off", "low", "medium", "high"],
      build: (level) => ({
        params: { reasoning_effort: supportsMax && level === "max" ? "max" : EFFORT_VALUE[level] },
        anthropicThinkingEnabled: false,
      }),
    };
  }
  // 原版 GPT-5 / mini / nano 最低只到 minimal，无法完全关闭。
  if (leaf.startsWith("gpt-5")) {
    return {
      dialect: "effort",
      selectable: ["off", "low", "medium", "high"],
      build: (level) => ({
        params: { reasoning_effort: level === "off" ? "minimal" : EFFORT_VALUE[level] },
        anthropicThinkingEnabled: false,
      }),
    };
  }
  // o 系列最低 low，同样不能关闭思考。
  if (/^o\d/.test(leaf)) {
    return {
      dialect: "effort",
      selectable: ["low", "medium", "high"],
      build: (level) => ({
        params: { reasoning_effort: EFFORT_VALUE[level] },
        anthropicThinkingEnabled: false,
      }),
    };
  }
  return NONE_PROFILE;
}

function resolveAnthropicProfile(leaf: string): ReasoningProfile {
  // 这些型号官方强制开启思考且不接受关闭/预算字段（2026-08 核对），与既有降级行为一致。
  if (leaf.startsWith("claude-fable-5") || leaf.startsWith("claude-mythos-5")) return NONE_PROFILE;
  return {
    dialect: "budget",
    selectable: ["off", "low", "medium", "high", "max"],
    build: (level, context) => {
      if (level === "off") {
        return { params: { thinking: { type: "disabled" } }, anthropicThinkingEnabled: false };
      }
      const budget = clampAnthropicBudget(ANTHROPIC_BUDGET_TOKENS[level], context.maxTokens);
      if (budget === null) return null;
      return {
        params: { thinking: { type: "enabled", budget_tokens: budget } },
        anthropicThinkingEnabled: true,
      };
    },
  };
}

function resolveDeepSeekProfile(leaf: string): ReasoningProfile {
  // reasoner/R1 只能思考，无法关闭或降档。
  if (leaf.includes("reasoner") || /(^|[-_/])r1([-/]|$)/.test(leaf)) return NONE_PROFILE;
  return THINKING_SWITCH_PROFILE;
}

function resolveGeminiProfile(leaf: string): ReasoningProfile {
  if (leaf.startsWith("gemini-2.5")) {
    return {
      dialect: "effort",
      selectable: ["off", "low", "medium", "high"],
      build: (level) => ({
        params: { reasoning_effort: EFFORT_VALUE[level] },
        anthropicThinkingEnabled: false,
      }),
    };
  }
  // Gemini 3.x 无法关闭思考，且强度方言未经核对；按现状不注入任何字段。
  return NONE_PROFILE;
}

function resolveQwenProfile(leaf: string): ReasoningProfile {
  if (/(^|[-_/])thinking([-/]|$)/.test(leaf)) return NONE_PROFILE;
  return {
    dialect: "switch",
    selectable: ["off", "low", "medium", "high", "max"],
    build: (level) => ({
      params: { enable_thinking: level !== "off" },
      anthropicThinkingEnabled: false,
    }),
  };
}

function clampReasoningLevel(
  requested: ExplicitLevel,
  selectable: readonly ExplicitLevel[],
): ExplicitLevel {
  if ((selectable as readonly string[]).includes(requested)) return requested;
  const requestedIndex = LEVEL_ORDER.indexOf(requested);
  const lower = [...selectable].reverse().find((level) => LEVEL_ORDER.indexOf(level) < requestedIndex);
  // 低于全部可选项时升到最低档（例如 o 系列的 off → low）。
  return lower ?? selectable[0];
}

function clampAnthropicBudget(desired: number, maxTokens?: number): number | null {
  if (maxTokens === undefined || !Number.isFinite(maxTokens) || maxTokens <= 0) return desired;
  const budget = Math.min(desired, Math.floor(maxTokens) - 1);
  return budget >= ANTHROPIC_MIN_BUDGET_TOKENS ? budget : null;
}

function leafModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  return normalized.includes("/") ? normalized.split("/").pop() ?? normalized : normalized;
}
