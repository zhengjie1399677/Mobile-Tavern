import { z } from "zod";
import type { PromptConfig, RegexScript } from "../../types";
import { MAX_OUTPUT_TOKENS } from "../api/outputTokenLimits";

/**
 * 预设实体 v3 契约。
 *
 * v1/v2 曾同时存在「传统 PromptConfig」与「中立编排快照」两套 Prompt 权威；
 * 编排路径已整体移除，因此 v3 只保留一个权威：`promptConfig`（传统提示词字段），
 * 预设切换即整体替换这些字段。
 */

/** 当前预设实体版本。 */
export const PRESET_BUNDLE_SCHEMA_VERSION = 3 as const;

/**
 * 采样参数的存储形态。
 *
 * 数值字段全部可选：v1 数据与第三方导入长期存在缺字段的记录，运行期一律与出厂默认合并，
 * 因此实体层不允许把「缺省」当成非法（`CHANGE-SAFE`）。`id`/`name` 必填。
 */
export const presetSamplerSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().max(200),
  temperature: z.number().finite().min(0).max(5).optional(),
  topP: z.number().finite().min(0).max(1).optional(),
  topK: z.number().int().min(0).max(1000).optional(),
  repetitionPenalty: z.number().finite().min(0).max(5).optional(),
  frequencyPenalty: z.number().finite().min(-2).max(2).optional(),
  presencePenalty: z.number().finite().min(-2).max(2).optional(),
  minP: z.number().finite().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
}).strict();

export const presetRegexScriptSchema = z.object({
  id: z.string(),
  scriptName: z.string(),
  findRegex: z.string(),
  replaceString: z.string(),
  disabled: z.boolean(),
  placement: z.array(z.number().int()),
  runOnEdit: z.boolean().optional(),
  markdownOnly: z.boolean().optional(),
  promptOnly: z.boolean().optional(),
  substituteRegex: z.number().int().optional(),
  minDepth: z.number().int().nullable().optional(),
  maxDepth: z.number().int().nullable().optional(),
  trimStrings: z.array(z.string()).optional(),
}).strict();

/** 预设 Prompt 字段：形状由导入/导出用例保证，这里只要求是对象。 */
const presetPromptConfigSchema = z.custom<PromptConfig>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "promptConfig 必须是对象" },
);

/** 未识别字段的保真袋；通用代码不得解释其内容（`COMPAT-DATA`）。 */
export const presetExtensionsSchema = z.record(z.string(), z.unknown());

export const presetBundleSchema = z.object({
  schemaVersion: z.literal(PRESET_BUNDLE_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(200),
  isBuiltin: z.boolean().optional(),
  sampler: presetSamplerSchema,
  promptConfig: presetPromptConfigSchema,
  regexScripts: z.array(presetRegexScriptSchema),
  extensions: presetExtensionsSchema.optional(),
}).strict();

export type PresetSampler = z.infer<typeof presetSamplerSchema>;
export type PresetBundle = z.infer<typeof presetBundleSchema>;

export type { RegexScript };
