import { z } from "zod";
import { parsePromptComposition } from "../prompt-composition";
import type { PromptComposition } from "../prompt-composition";
import type { PresetPromptConfig, RegexScript } from "../../types";

/**
 * 预设实体 v2 契约。
 *
 * v1 的预设是异构包：采样参数、传统 Prompt 字段、中立编排快照、废弃的
 * `composition`/`usePromptComposition` 混在一个对象里，且运行时同时存在
 * 「传统 PromptConfig」与「中立编排」两套权威（`types.ts` 的 `SavedPresetBundle`）。
 *
 * v2 只保留一个 Prompt 权威：`prompt` 快照（模式 + 中立编排）。传统 Prompt 字段降级为
 * `legacyPromptConfig` 只读兼容块——它只服务 SillyTavern 导出与传统运行期投影，
 * 不再作为权威来源，也不再由预设切换直接改写。
 */

/** 当前预设实体版本。 */
export const PRESET_BUNDLE_SCHEMA_VERSION = 2 as const;

export const presetPromptModeSchema = z.enum(["legacy", "composition"]);
export const presetPromptSourceSchema = z.enum(["mobile-tavern", "sillytavern", "native"]);

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
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
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

/**
 * 编排快照：内容校验复用领域唯一入口 `parsePromptComposition`，并让类型保持 `PromptComposition`。
 */
const promptCompositionSchema = z.custom<PromptComposition>(
  (value) => {
    try {
      parsePromptComposition(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "编排快照未通过领域校验" },
);

/**
 * 预设拥有的 Prompt 快照（唯一权威）。
 *
 * `mode` 明确决定加载预设后使用传统路径还是自由编排，避免旧预设缺字段时继承别的预设的
 * 运行模式。
 */
export const presetPromptSnapshotSchema = z.object({
  version: z.literal(PRESET_BUNDLE_SCHEMA_VERSION),
  mode: presetPromptModeSchema,
  source: presetPromptSourceSchema,
  composition: promptCompositionSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.mode === "composition" && snapshot.composition === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["composition"],
      message: "自由编排模式必须携带编排快照",
    });
  }
});

/** 传统 Prompt 字段的只读兼容块：形状由导入/导出用例保证，这里只要求是对象。 */
const legacyPromptConfigSchema = z.custom<PresetPromptConfig>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "legacyPromptConfig 必须是对象" },
);

/** 未识别字段的保真袋；通用代码不得解释其内容（`COMPAT-DATA`）。 */
export const presetExtensionsSchema = z.record(z.unknown());

export const presetBundleV2Schema = z.object({
  schemaVersion: z.literal(PRESET_BUNDLE_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(200),
  isBuiltin: z.boolean().optional(),
  sampler: presetSamplerSchema,
  prompt: presetPromptSnapshotSchema,
  regexScripts: z.array(presetRegexScriptSchema),
  legacyPromptConfig: legacyPromptConfigSchema.optional(),
  extensions: presetExtensionsSchema.optional(),
}).strict();

export type PresetSamplerV2 = z.infer<typeof presetSamplerSchema>;
export type PresetPromptSnapshotV2 = z.infer<typeof presetPromptSnapshotSchema>;
export type PresetBundleV2 = z.infer<typeof presetBundleV2Schema>;

/** 预设实体中属于 Prompt 的字段（迁移与投影共用的读取面）。 */
export interface PresetPromptCarrier {
  prompt: Pick<PresetPromptSnapshotV2, "mode" | "source" | "composition">;
}

export type { PromptComposition, RegexScript };
