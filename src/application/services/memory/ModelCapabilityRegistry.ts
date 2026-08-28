/**
 * 模型能力注册表 + LLM 参数防腐层
 *
 * 设计立场（AGENTS.md 准则二豁免条款）：
 * 模型能力表硬编码在底层，属于必要的技术基础设施元数据（类似驱动兼容表），
 * 不视为"业务逻辑硬编码"。豁免仅限模型能力识别相关数据，不得扩展到其他业务逻辑。
 *
 * 三层降级机制：
 *   1. 已知模型硬编码能力表（按模型 ID 前缀匹配）
 *   2. 未知模型保守默认值（只发几乎都支持的参数）
 *   3. 运行时错误自愈（缓存学习到的能力到 localStorage）
 */

import type { LLMParams, ModelCapabilities } from './types';

/**
 * 已知模型能力表（按模型 ID 前缀匹配）。
 * 基于项目生产环境调用数据 + 各厂商官方文档（2026-08 核对）维护。
 *
 * 注意前缀匹配顺序：长前缀/具体前缀必须排在短前缀之前
 * （如 'gpt-4.1' 在 'gpt-4' 之前，否则 'gpt-4o' 会先命中 'gpt-4'）。
 */
const KNOWN_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // OpenAI GPT-5.6 系列（官方 models 页 2026-08：1.05M 上下文、reasoning 支持 none~max）
  'gpt-5.6': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1050000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-5.5 系列（官方 2026-08 当前旗舰主力：1.05M 上下文）
  'gpt-5.5': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1050000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-5.4 mini/nano（官方入门模型线：400K 上下文，须放 gpt-5.4 之前）
  'gpt-5.4-mini': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 400000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  'gpt-5.4-nano': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 400000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-5.4（官方 2026-03 发布：1.05M 上下文，性能/成本平衡）
  'gpt-5.4': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1050000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-5.3（含 gpt-5.3-codex，官方 400K 上下文）
  'gpt-5.3': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 400000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-5 原版（2026-02 已退役，仅兼容旧配置）
  'gpt-5': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 400000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // OpenAI GPT-4.1（官方标记弃用，API 兼容期保留）
  'gpt-4.1': {
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1000000,
    preferredFormat: 'xml',
  },
  // OpenAI GPT-4o（官方标记弃用，API 兼容期保留）
  'gpt-4o': {
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 128000,
    preferredFormat: 'xml',
  },
  // OpenAI o 系列（reasoning models）：必须用 max_completion_tokens
  'o1': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 200000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  'o3': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 200000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  'o4': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 200000,
    preferredFormat: 'xml',
    usesMaxCompletionTokens: true,
  },
  // Gemini 3.x：官方废弃 temperature/top_p/top_k（当前忽略、未来 400），不发送采样参数
  'gemini-3': {
    supportsTopK: false,
    supportsTopP: false,
    supportsTemperature: false,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: false,
    contextWindow: 1000000,
    preferredFormat: 'xml',
  },
  'gemini-': {
    supportsTopK: true,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: false,
    contextWindow: 1000000,
    preferredFormat: 'xml',
  },
  'deepseek-': {
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1000000,
    preferredFormat: 'xml',
  },
  'claude-': {
    // Anthropic 官方 OpenAI 兼容层（2026-08 文档）：无 top_k；temperature 上限 1（超限被 cap）；
    // response_format 被忽略（JSON 输出需原生 Structured Outputs）；stream_options 完全支持。
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: false,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 1000000,
    preferredFormat: 'xml',
    maxTemperature: 1.0,
  },
  'glm-': {
    // 智谱官方 OpenAI 兼容接口无 top_k 参数（2026-08 文档核对）；temperature 上限 1.0
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: false,
    contextWindow: 200000,
    preferredFormat: 'xml',
    maxTemperature: 1.0,
  },
  // 阿里百炼 Qwen（dashscope OpenAI 兼容模式）：支持 function calling / JSON mode / stream_options
  'qwen-': {
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
    supportsMinP: false,
    supportsRepetitionPenalty: false,
    supportsStreamOptions: true,
    contextWindow: 128000,
    preferredFormat: 'xml',
  },
};

/**
 * 未知模型保守默认值。
 * 原则：只发几乎都支持的参数（temperature/top_p/stream/system），
 *       保守不发 top_k/json_schema/function_calling/min_p/repetition_penalty/stream_options，避免 400 错误。
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsTopK: false,
  supportsTopP: true,
  supportsTemperature: true,
  supportsJsonSchema: false,
  supportsFunctionCalling: false,
  supportsStream: true,
  supportsSystemPrompt: true,
  supportsMinP: false,
  supportsRepetitionPenalty: false,
  supportsStreamOptions: false,
  contextWindow: 200000,
  preferredFormat: 'markdown',
};

/** v2 只保存运行时确认“不支持”的能力，旧完整快照不再覆盖官方能力表。 */
const RUNTIME_CACHE_STORAGE_KEY = 'mt_model_capability_runtime_cache_v2';

/** 官方提供商族，用于 disableReasoning 按厂商方言注入推理控制参数。 */
export type ProviderFamily = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'glm' | 'qwen' | 'other';

export class ModelCapabilityRegistry {
  /** 运行时缓存只允许记录 false，防止缓存重新开启已被官方移除的参数。 */
  private static runtimeCache: Map<string, Partial<ModelCapabilities>> = new Map();

  /** 是否已从 localStorage 加载过运行时缓存 */
  private static runtimeCacheLoaded = false;

  /**
   * 已知标准提供商/官方域名列表。
   * 当 baseUrl 包含这些域名时，允许根据 Model ID 启用高级参数。
   * 否则（未知第三方中转站），自动走最保守降级模式，仅发送绝大多数中转站都能解析的基础参数（temperature/top_p/stream/system）。
   */
  private static readonly KNOWN_STANDARD_PROVIDERS = [
    "api.openai.com",
    "openrouter.ai",
    "api.deepseek.com",
    "api.siliconflow.cn",
    "siliconflow.cn",         // 硅基流动
    "api.groq.com",
    "groq.com",               // Groq
    "googleapis.com",         // Google Gemini / Vertex
    "api.together.xyz",
    "together.xyz",           // Together.AI
    "api.anthropic.com",
    "anthropic.com",          // Anthropic
    "dashscope.aliyuncs.com", // 阿里云百炼
    "spark-api.xf-yun.com",   // 讯飞星火
    "open.bigmodel.cn",       // 智谱 GLM
    "api.moonshot.cn",        // 月之暗面 Kimi
    "aip.baidubce.com",       // 百度千帆
    "baidubce.com",           // 百度智能云
    "api.mistral.ai",         // Mistral
    "api.lingyiwanwu.com",    // 零一万物
    "api.perplexity.ai",      // Perplexity
    "tencentcloudapi.com",    // 腾讯云混元
    "qcloud.com",             // 腾讯云
    "volces.com",             // 字节跳动火山引擎 (Ark)
    "deepinfra.com",          // DeepInfra
    "fireworks.ai",           // Fireworks AI
    "novita.ai",              // Novita AI
    "cloudflare.com",         // Cloudflare Workers AI
    "nebius.ai",              // Nebius GPU
    "lepton.ai",              // Lepton AI
    "newapi",                 // New API 聚合器
    "oneapi",                 // One API 聚合器
    "one-api",                // One-API 聚合器
  ];

  /**
   * 判断域名是否为知名标准服务商或官方域名
   */
  private static isStandardProvider(baseUrl?: string): boolean {
    if (!baseUrl) return false;
    const lowerUrl = baseUrl.toLowerCase();
    return this.KNOWN_STANDARD_PROVIDERS.some((domain) => lowerUrl.includes(domain));
  }

  /**
   * 获取模型能力。
   * 先解析官方/保守能力表，再叠加运行时确认的“不支持”结果。
   */
  static getCapabilities(modelId: string, baseUrl?: string): ModelCapabilities {
    this.ensureRuntimeCacheLoaded();

    // 只有当未指定 baseUrl（默认调试）或匹配知名标准服务商时，才尝试匹配特定模型能力表
    //    对于任意第三方中转站，默认走最保守降级模式
    const isStandard = !baseUrl || this.isStandardProvider(baseUrl);

    let caps: ModelCapabilities | null = null;

    if (isStandard) {
      // 剥离厂商前缀（例如 "anthropic/claude-3-5-sonnet" -> "claude-3-5-sonnet", "deepseek-ai/DeepSeek-V3" -> "deepseek-v3"）
      const rawModelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
      const lowerId = rawModelName.toLowerCase();

      for (const [prefix, knownCaps] of Object.entries(KNOWN_MODEL_CAPABILITIES)) {
        if (lowerId.startsWith(prefix)) {
          caps = { ...knownCaps };
          break;
        }
      }
    }

    if (!caps) {
      caps = { ...DEFAULT_CAPABILITIES };
    }

    // stream_options 兜底：能力表未显式声明时，仅官方 OpenAI / OpenRouter / DeepSeek 判定为 true
    if (caps.supportsStreamOptions === undefined) {
      if (baseUrl && (
        baseUrl.toLowerCase().includes("api.openai.com")
        || baseUrl.toLowerCase().includes("openrouter.ai")
        || baseUrl.toLowerCase().includes("api.deepseek.com")
      )) {
        caps.supportsStreamOptions = true;
      } else {
        caps.supportsStreamOptions = false;
      }
    }

    const cached = this.runtimeCache.get(modelId);
    if (cached) {
      for (const [key, value] of Object.entries(cached)) {
        if (value === false) {
          (caps as unknown as Record<string, unknown>)[key] = false;
        }
      }
    }
    return caps;
  }

  static cleanLLMParams(
    modelId: string,
    params: LLMParams,
    baseUrl?: string,
    forceBasicParams?: boolean
  ): LLMParams {
    const caps = forceBasicParams ? { ...DEFAULT_CAPABILITIES } : this.getCapabilities(modelId, baseUrl);
    const cleaned: LLMParams = { ...params };

    if (!caps.supportsTopK) delete cleaned.top_k;
    if (!caps.supportsTopP) delete cleaned.top_p;
    if (!caps.supportsTemperature) delete cleaned.temperature;
    if (!caps.supportsJsonSchema) delete cleaned.response_format;
    if (!caps.supportsFunctionCalling) delete cleaned.functions;
    if (!caps.supportsMinP) delete cleaned.min_p;
    if (!caps.supportsRepetitionPenalty) delete cleaned.repetition_penalty;
    if (caps.supportsStreamOptions === false) delete cleaned.stream_options;

    // 采样温度越界收敛：严格 API（如 GLM 上限 1.0）对越界值报 400
    if (
      caps.maxTemperature !== undefined
      && typeof cleaned.temperature === "number"
      && !Number.isNaN(cleaned.temperature)
    ) {
      cleaned.temperature = Math.min(Math.max(cleaned.temperature, 0), caps.maxTemperature);
    }

    // OpenAI reasoning 模型（GPT-5 / o 系列）拒绝 max_tokens，必须改写为 max_completion_tokens
    if (
      caps.usesMaxCompletionTokens
      && typeof cleaned.max_tokens === "number"
      && cleaned.max_completion_tokens === undefined
    ) {
      cleaned.max_completion_tokens = cleaned.max_tokens;
      delete cleaned.max_tokens;
    }

    return cleaned;
  }

  /**
   * 按 baseUrl 域名识别官方提供商族（用于推理控制参数分派）。
   */
  static resolveProviderFamily(baseUrl?: string): ProviderFamily {
    if (!baseUrl) return 'other';
    const lower = baseUrl.toLowerCase();
    if (lower.includes("api.anthropic.com") || lower.includes("anthropic.com")) return 'anthropic';
    if (lower.includes("api.openai.com")) return 'openai';
    if (lower.includes("googleapis.com")) return 'gemini';
    if (lower.includes("api.deepseek.com")) return 'deepseek';
    if (lower.includes("open.bigmodel.cn") || lower.includes("api.z.ai")) return 'glm';
    if (lower.includes("dashscope") || lower.includes("maas.aliyuncs.com") || lower.includes("aliyuncs.com")) return 'qwen';
    return 'other';
  }

  /**
   * 返回“关闭推理”时应注入的厂商方言参数。
   *
   * 各厂商推理控制协议不一致（2026-08 官方文档核对）：
   * - OpenAI：reasoning_effort（GPT-5 系支持 minimal，o 系最低 low）
   * - Anthropic / DeepSeek / 智谱 GLM：thinking: { type: "disabled" }
   * - Gemini 2.5：reasoning_effort: "none"（3.x 无法关闭思考，忽略）
   * - Qwen：enable_thinking: false（OpenAI 兼容模式 extra_body 字段）
   * - 其他/中转站：不注入，避免未知字段被严格网关 400 拒绝
   */
  static getReasoningDisableParams(
    modelId: string,
    baseUrl?: string
  ): Record<string, unknown> {
    const family = this.resolveProviderFamily(baseUrl);
    const rawModelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    const lowerId = rawModelName.toLowerCase();

    switch (family) {
      case 'openai':
        // GPT-5.1~5.6 全系列（含 mini/nano/codex）支持 none（可完全关闭思考）
        if (/^gpt-5\.\d/.test(lowerId)) return { reasoning_effort: 'none' };
        // GPT-5 原版/mini/nano 仅支持 minimal
        if (lowerId.startsWith('gpt-5')) return { reasoning_effort: 'minimal' };
        if (lowerId.startsWith('o1') || lowerId.startsWith('o3') || lowerId.startsWith('o4')) {
          return { reasoning_effort: 'low' };
        }
        // gpt-4o 等传统模型不识别 reasoning_effort，不发
        return {};
      case 'anthropic':
        return { thinking: { type: 'disabled' } };
      case 'deepseek':
        return { thinking: { type: 'disabled' } };
      case 'glm':
        // GLM-5.3/5.3-Flash 官方强制开启思考（thinking 不可 disabled），不注入
        if (lowerId.startsWith('glm-5.3')) return {};
        return { thinking: { type: 'disabled' } };
      case 'gemini':
        // Gemini 3.x 无法关闭思考；仅 2.5 系列支持 reasoning_effort: "none"
        if (lowerId.startsWith('gemini-2.5')) return { reasoning_effort: 'none' };
        return {};
      case 'qwen':
        return { enable_thinking: false };
      default:
        return {};
    }
  }

  /**
   * 运行时更新模型能力（错误自愈后调用）。
   * 仅允许"关闭"能力（false），不允许"开启"能力（true），避免误判。
   */
  static updateCapabilities(
    modelId: string,
    patch: Partial<ModelCapabilities>
  ): void {
    this.ensureRuntimeCacheLoaded();

    // 仅允许关闭能力，不允许开启
    const next: Partial<ModelCapabilities> = { ...(this.runtimeCache.get(modelId) ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === false) {
        (next as unknown as Record<string, unknown>)[key] = false;
      }
    }

    this.runtimeCache.set(modelId, next);
    this.persistRuntimeCache();
  }

  /**
   * 识别"参数不支持"错误。
   * 通过错误信息关键词匹配，判断是否为参数兼容性问题。
   * @returns 不支持时返回 { param }，否则返回 null
   */
  static isUnsupportedParamError(
    error: any
  ): { param: keyof ModelCapabilities } | null {
    const errorMsg = String(error?.message || error?.statusText || error || '');
    if (!errorMsg) return null;

    const paramPatterns: Array<{
      param: keyof ModelCapabilities;
      pattern: RegExp;
    }> = [
      { param: 'supportsTopK', pattern: /top_k|topK/i },
      { param: 'supportsTopP', pattern: /top_p|topP/i },
      { param: 'supportsJsonSchema', pattern: /response_format|json_schema/i },
      { param: 'supportsFunctionCalling', pattern: /function_call|tools\b/i },
      { param: 'supportsMinP', pattern: /min_p|minP/i },
      { param: 'supportsRepetitionPenalty', pattern: /repetition_penalty|repetitionPenalty|rep_pen/i },
      { param: 'supportsStreamOptions', pattern: /stream_options|include_usage/i },
    ];

    for (const { param, pattern } of paramPatterns) {
      if (pattern.test(errorMsg)) {
        return { param };
      }
    }
    return null;
  }

  /**
   * 重置运行时缓存（仅供测试使用）。
   */
  static resetRuntimeCacheForTesting(): void {
    this.runtimeCache.clear();
    this.runtimeCacheLoaded = true;
    try {
      localStorage.removeItem(RUNTIME_CACHE_STORAGE_KEY);
    } catch {
      // localStorage 不可用时静默忽略
    }
  }

  // ===== 内部方法 =====

  private static ensureRuntimeCacheLoaded(): void {
    if (this.runtimeCacheLoaded) return;
    this.runtimeCacheLoaded = true;

    try {
      const raw = localStorage.getItem(RUNTIME_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Partial<ModelCapabilities>>;
      for (const [modelId, caps] of Object.entries(parsed)) {
        this.runtimeCache.set(modelId, caps);
      }
    } catch {
      // 解析失败时静默忽略，使用已知表 + 默认值
    }
  }

  private static persistRuntimeCache(): void {
    try {
      const obj: Record<string, Partial<ModelCapabilities>> = {};
      for (const [modelId, caps] of this.runtimeCache) {
        obj[modelId] = caps;
      }
      localStorage.setItem(RUNTIME_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // localStorage 不可用或写入失败时静默忽略
    }
  }
}
