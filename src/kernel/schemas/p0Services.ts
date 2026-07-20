/**
 * P0 服务契约 Schema（zod 运行时校验）
 *
 * 设计原则（详见 docs/agents/zod-l2-probe-report.md）：
 *   1. 仅校验"接口声明的方法在实现中存在且是 function"
 *   2. 不校验"实现不能有额外方法"（容忍 LLM.buildHeaders / Prompt.escapeRegExp 等内部辅助方法）
 *   3. P0 = 数据流入边界服务（ChatStream/Script/Database/Memory/LLM）
 *   4. P1 = 其余 12 个服务仅校验 IKernelService 基础结构
 *
 * 维护约定：types.ts 中 IXxxService 接口变更时，对应 schema 必须同步修改。
 */

import { z } from "zod";
import { KernelServices } from "../types";

// ─── 工具：函数字段 schema ────────────────────────────────────────────────────
// 仅校验 typeof === "function"，不校验签名（签名匹配留给 TS 编译期）
const fnSchema = z.custom<Function>(
  (val) => typeof val === "function",
  { message: "expected a function" }
);

// ─── IKernelService 基础结构 schema（所有服务必须满足） ────────────────────────
export const KernelServiceBaseSchema = z.object({
  name: z.string().min(1),
  isCritical: z.boolean().optional(),
  dependencies: z.array(z.string()).optional(),
  optionalDependencies: z.array(z.string()).optional(),
  init: fnSchema,
  destroy: fnSchema.optional(),
});

// ─── P0 服务完整 schema（5 个，按数据流入边界分级） ───────────────────────────

/**
 * ChatStream：LLM SSE 流式响应入口，不可信数据第一道关。
 * 接口方法：streamLlmResponse
 */
export const ChatStreamServiceSchema = KernelServiceBaseSchema.extend({
  streamLlmResponse: fnSchema,
});

/**
 * Script：parseMvuMessage 输出写入 session.variables 持久化，LLM 文本→数据库转换点。
 * 接口方法：initializeMvuFromCharacter, parseMvuMessage, executeMvuScript, registerBridge
 */
export const ScriptServiceSchema = KernelServiceBaseSchema.extend({
  initializeMvuFromCharacter: fnSchema,
  parseMvuMessage: fnSchema,
  executeMvuScript: fnSchema,
  registerBridge: fnSchema,
});

/**
 * Database：IndexedDB 持久化边界，所有数据反序列化入口。
 * 接口方法：15 个（详见 IDatabaseService）
 */
export const DatabaseServiceSchema = KernelServiceBaseSchema.extend({
  getAllSessions: fnSchema,
  getSessionById: fnSchema,
  getSessionsCount: fnSchema,
  getSessionsPaginated: fnSchema,
  saveSession: fnSchema,
  appendSessionMessage: fnSchema,
  deleteMessageById: fnSchema,
  replaceSessionBranch: fnSchema,
  syncSessionMessages: fnSchema,
  deleteSession: fnSchema,
  bulkSaveSessions: fnSchema,
  createNewSession: fnSchema,
  createEmptyBranch: fnSchema,
  createBacktrackBranch: fnSchema,
  createBacktrackFromTimeline: fnSchema,
  getCharacterById: fnSchema,
});

/**
 * Memory：记忆系统数据流入边界。
 * 接口方法：getStorage, getExtractor, getRecall, getStateTable, getSummary
 */
export const MemoryServiceSchema = KernelServiceBaseSchema.extend({
  getStorage: fnSchema,
  getExtractor: fnSchema,
  getRecall: fnSchema,
  getStateTable: fnSchema,
  getSummary: fnSchema,
});

/**
 * LLM：外部 LLM API 调用边界。
 * 接口方法：universalFetch, isClientMode, sendCatbotRequest
 * 注：实现暴露的 buildHeaders/validateBaseUrl 不在接口声明，schema 不校验
 */
export const LLMServiceSchema = KernelServiceBaseSchema.extend({
  universalFetch: fnSchema,
  isClientMode: fnSchema,
  sendCatbotRequest: fnSchema,
});

// ─── P0 服务名 → schema 映射 ──────────────────────────────────────────────────
export const P0_SERVICE_SCHEMAS: Record<string, z.ZodType> = {
  [KernelServices.ChatStream]: ChatStreamServiceSchema,
  [KernelServices.Script]: ScriptServiceSchema,
  [KernelServices.Database]: DatabaseServiceSchema,
  [KernelServices.Memory]: MemoryServiceSchema,
  [KernelServices.LLM]: LLMServiceSchema,
};

// ─── P1 服务名清单（仅校验基础结构） ──────────────────────────────────────────
export const P1_SERVICE_NAMES: readonly string[] = [
  KernelServices.Prompt,
  KernelServices.Settings,
  KernelServices.Preset,
  KernelServices.Character,
  KernelServices.Worldbook,
  KernelServices.Telemetry,
  KernelServices.UpdateCheck,
  KernelServices.ImageGen,
  KernelServices.Tts,
  KernelServices.Asr,
  KernelServices.Bgm,
  KernelServices.MultiMessage,
] as const;

/**
 * 判断服务名是否为 P0（数据流入边界服务）
 */
export const isP0Service = (name: string): boolean => name in P0_SERVICE_SCHEMAS;

/**
 * 获取 P0 服务的 schema；非 P0 服务返回 null
 */
export const getP0ServiceSchema = (name: string): z.ZodType | null => {
  return P0_SERVICE_SCHEMAS[name] ?? null;
};
