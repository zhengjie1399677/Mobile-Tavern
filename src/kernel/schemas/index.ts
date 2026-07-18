/**
 * Kernel Schema 校验工具函数（Phase B 产出）
 *
 * 设计原则：
 *   1. 纯函数，不耦合 Kernel 内部状态，不抛错
 *   2. 返回 result 对象（{success, error?}），由调用方决定如何处理
 *   3. SAFE_PROXY_SYMBOL 是 Kernel.createSafeProxy 与本模块的契约标记
 *
 * Phase C 集成方式（待用户决策后实施）：
 *   - registerService: 调用 validateService，按 validationMode 决定 throw/warn/skip
 *   - publish: 调用 validateMessage，按 validationMode 决定 throw/warn/skip
 *   - getService: 调用 validateServiceRetrieval，按 validationMode 决定 warn/skip
 *
 * 维护约定：types.ts 中 IXxxService 接口变更时，对应 schema 必须同步修改（见 p0Services.ts）。
 */

import { z } from "zod";
import {
  KernelServiceBaseSchema,
  getP0ServiceSchema,
  isP0Service,
} from "./p0Services";
import {
  KernelMessageSchema,
  getStaticTopicSchema,
  isDynamicTopic,
} from "./messages";

/**
 * SafeProxy 契约标记。
 * Kernel.createSafeProxy 产出的降级对象会带此标记，
 * validateServiceRetrieval 检测到此标记后跳过 P0 schema 校验（已知是降级返回）。
 *
 * 用 Symbol 而非字符串 key，避免与业务字段冲突；Symbol 属性不会被 Proxy `get` trap 拦截到不存在路径。
 */
export const SAFE_PROXY_SYMBOL = Symbol("kernel.safeProxy");

/**
 * 校验结果类型。
 * - success: 校验通过（或主动 skip）
 * - failure: 校验失败，携带原始 ZodError 与人类可读摘要（便于遥测上报与日志输出）
 */
export type ValidationResult =
  | { success: true }
  | { success: false; error: z.ZodError; summary: string };

/**
 * 判断对象是否携带 SafeProxy 标记。
 * 兼容 null / 非对象输入，避免运行时抛错。
 */
const isSafeProxy = (service: unknown): boolean => {
  return (
    service !== null &&
    typeof service === "object" &&
    SAFE_PROXY_SYMBOL in (service as object)
  );
};

/**
 * 校验服务实例结构（registerService 入口用）。
 *
 * 分级策略：
 *   - P0 服务（ChatStream/Script/Database/Memory/LLM）：用完整 schema 校验所有声明方法存在且为 function
 *   - P1 服务（其余 12 个）及未知名服务：仅校验 IKernelService 基础结构（name/init/destroy）
 *
 * 未知服务名按 P1 基础结构校验（保守默认，避免自定义服务名漏校验）。
 */
export const validateService = (
  name: string,
  service: unknown
): ValidationResult => {
  // P0 服务走完整 schema
  if (isP0Service(name)) {
    const schema = getP0ServiceSchema(name);
    if (schema !== null) {
      const result = schema.safeParse(service);
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          summary: `P0 service "${name}" schema validation failed`,
        };
      }
      return { success: true };
    }
    // 理论不可达（isP0Service 为 true 时 schema 必存在），防御性兜底
  }

  // P1 服务（及未知名）走基础结构校验
  const result = KernelServiceBaseSchema.safeParse(service);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      summary: `Service "${name}" base structure validation failed`,
    };
  }
  return { success: true };
};

/**
 * 校验消息（publish 入口用）。
 *
 * 分级策略：
 *   1. 所有 topic：顶层 IMessage 结构校验（topic 非空字符串 / payload 任意 / metadata 可选 record）
 *   2. 动态 topic（命中 DYNAMIC_TOPIC_PREFIXES，如 `tavern_helper:*`）：跳过 payload 校验
 *      —— 符合 SillyTavern 兼容契约（AGENTS.md 准则二），用户脚本决定的 payload 形状不可枚举
 *   3. 静态 topic（在 STATIC_TOPIC_SCHEMAS 中）：额外用 payload schema 校验
 *   4. 未登记的静态 topic：仅顶层结构校验通过即可，payload 宽松
 */
export const validateMessage = (message: unknown): ValidationResult => {
  // 1. 顶层结构校验
  const topResult = KernelMessageSchema.safeParse(message);
  if (!topResult.success) {
    return {
      success: false,
      error: topResult.error,
      summary: "Message top-level structure invalid",
    };
  }

  const msg = message as { topic: string; payload: unknown };

  // 2. 动态 topic 跳过 payload 校验
  if (isDynamicTopic(msg.topic)) {
    return { success: true };
  }

  // 3. 静态 topic payload 校验
  const payloadSchema = getStaticTopicSchema(msg.topic);
  if (payloadSchema === null) {
    // 4. 未登记的静态 topic：仅顶层结构校验通过即可
    return { success: true };
  }

  const payloadResult = payloadSchema.safeParse(msg.payload);
  if (!payloadResult.success) {
    return {
      success: false,
      error: payloadResult.error,
      summary: `Payload schema validation failed for topic "${msg.topic}"`,
    };
  }
  return { success: true };
};

/**
 * 校验服务获取（getService 入口用）。
 *
 * 分级策略：
 *   - SafeProxy（带 SAFE_PROXY_SYMBOL 标记）：直接通过，已知是 Kernel 对"非关键服务缺失"的降级返回
 *     —— SafeProxy 假装有方法（每个方法返回 no-op），但缺真实方法实现，P0 schema 会失败，
 *        因此必须显式 skip
 *   - 真实服务：与 validateService 相同的分级校验（P0 完整 schema / P1 基础结构）
 */
export const validateServiceRetrieval = (
  name: string,
  service: unknown
): ValidationResult => {
  // SafeProxy 标记 → 跳过 P0 schema（已知是降级）
  if (isSafeProxy(service)) {
    return { success: true };
  }
  // 真实服务走与 registerService 相同的校验
  return validateService(name, service);
};