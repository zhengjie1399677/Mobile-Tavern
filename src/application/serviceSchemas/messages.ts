/**
 * 消息总线 Schema（zod 运行时校验）
 *
 * 设计原则（详见 docs/agents/zod-l2-probe-report.md）：
 *   1. 顶层 IMessage 结构所有 topic 都校验
 *   2. 静态 topic（仅 2 个）有 payload schema
 *   3. 动态 topic 前缀（tavern_helper:*）显式 skip payload 校验，符合 SillyTavern 兼容契约
 *   4. 未在 STATIC_TOPIC_SCHEMAS 中的静态 topic → 仅顶层结构校验，payload 宽松
 *
 * 探测阶段确认的实际 topic 分布：
 *   - 静态字面量：script:destroyed, catbot:event
 *   - 动态模板：tavern_helper:${event}（由用户脚本决定 event 名）
 *   - KernelEvents 枚举已清理（死代码）
 */

import { z } from "zod";

// ─── 顶层 IMessage 结构 schema（所有 topic 都校验） ───────────────────────────
export const KernelMessageSchema = z.object({
  topic: z.string().min(1),
  // payload 类型由 topic schema 决定；此处宽松校验，由 validateMessage 按需收紧
  payload: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── 静态 topic → payload schema（仅 2 个真实业务 topic） ─────────────────────
export const STATIC_TOPIC_SCHEMAS: Record<string, z.ZodType> = {
  // ScriptService 销毁时通知（ScriptService.ts:154）
  "script:destroyed": z.object({
    reason: z.string(),
  }),
  // catbot 事件总线（catbotEventBus.ts:27）
  // 探测阶段未触发，payload 形状待手动 smoke 确认，先用 unknown 兜底
  "catbot:event": z.unknown(),
};

// ─── 动态 topic 前缀黑名单（显式 skip payload 校验） ──────────────────────────
// tavern_helper:${event} 由用户 SillyTavern 脚本决定 event 名与 payload 形状
// 强行加 schema 会破坏脚本兼容性（违反 AGENTS.md 准则二）
export const DYNAMIC_TOPIC_PREFIXES: readonly string[] = [
  "tavern_helper:",
] as const;

/**
 * 判断 topic 是否为动态 topic（应跳过 payload 校验）
 */
export const isDynamicTopic = (topic: string): boolean => {
  return DYNAMIC_TOPIC_PREFIXES.some((prefix) => topic.startsWith(prefix));
};

/**
 * 获取静态 topic 的 payload schema；非静态 topic 返回 null
 */
export const getStaticTopicSchema = (topic: string): z.ZodType | null => {
  return STATIC_TOPIC_SCHEMAS[topic] ?? null;
};
