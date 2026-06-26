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
 * 基于项目生产环境调用数据维护：DeepSeek/Gemini/Claude/GPT/GLM 占 70%+ 调用量。
 */
const KNOWN_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'deepseek-': {
    supportsTopK: true,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
  },
  'gemini-': {
    supportsTopK: true,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
  },
  'claude-': {
    // Claude 不支持 top_k 参数
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
  },
  'gpt-': {
    supportsTopK: false,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
  },
  'glm-': {
    supportsTopK: true,
    supportsTopP: true,
    supportsTemperature: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsStream: true,
    supportsSystemPrompt: true,
  },
};

/**
 * 未知模型保守默认值。
 * 原则：只发几乎都支持的参数（temperature/top_p/stream/system），
 *       保守不发 top_k/json_schema/function_calling，避免 400 错误。
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsTopK: false,
  supportsTopP: true,
  supportsTemperature: true,
  supportsJsonSchema: false,
  supportsFunctionCalling: false,
  supportsStream: true,
  supportsSystemPrompt: true,
};

/** localStorage 持久化键（运行时学到的能力覆盖） */
const RUNTIME_CACHE_STORAGE_KEY = 'mt_model_capability_runtime_cache';

export class ModelCapabilityRegistry {
  /** 运行时缓存：错误自愈学到的模型能力（覆盖已知表） */
  private static runtimeCache: Map<string, ModelCapabilities> = new Map();

  /** 是否已从 localStorage 加载过运行时缓存 */
  private static runtimeCacheLoaded = false;

  /**
   * 获取模型能力。
   * 优先级：运行时缓存 > 已知表 > 默认保守值
   */
  static getCapabilities(modelId: string): ModelCapabilities {
    this.ensureRuntimeCacheLoaded();

    // 1. 查运行时缓存（错误自愈学到的）
    const cached = this.runtimeCache.get(modelId);
    if (cached) {
      return { ...cached };
    }

    // 2. 查已知表（按前缀匹配，大小写不敏感）
    const lowerId = modelId.toLowerCase();
    for (const [prefix, caps] of Object.entries(KNOWN_MODEL_CAPABILITIES)) {
      if (lowerId.startsWith(prefix)) {
        return { ...caps };
      }
    }

    // 3. 默认保守值
    return { ...DEFAULT_CAPABILITIES };
  }

  /**
   * 清洗 LLM 调用参数（防腐层入口）。
   * 移除模型不支持的参数，避免 400 错误或参数被静默忽略。
   */
  static cleanLLMParams(modelId: string, params: LLMParams): LLMParams {
    const caps = this.getCapabilities(modelId);
    const cleaned: LLMParams = { ...params };

    if (!caps.supportsTopK) delete cleaned.top_k;
    if (!caps.supportsTopP) delete cleaned.top_p;
    if (!caps.supportsTemperature) delete cleaned.temperature;
    if (!caps.supportsJsonSchema) delete cleaned.response_format;
    if (!caps.supportsFunctionCalling) delete cleaned.functions;

    return cleaned;
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

    const current = this.getCapabilities(modelId);
    // 仅允许关闭能力，不允许开启
    const next: ModelCapabilities = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === false) {
        (next as any)[key] = false;
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
      const parsed = JSON.parse(raw) as Record<string, ModelCapabilities>;
      for (const [modelId, caps] of Object.entries(parsed)) {
        this.runtimeCache.set(modelId, caps);
      }
    } catch {
      // 解析失败时静默忽略，使用已知表 + 默认值
    }
  }

  private static persistRuntimeCache(): void {
    try {
      const obj: Record<string, ModelCapabilities> = {};
      for (const [modelId, caps] of this.runtimeCache) {
        obj[modelId] = caps;
      }
      localStorage.setItem(RUNTIME_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // localStorage 不可用或写入失败时静默忽略
    }
  }
}
