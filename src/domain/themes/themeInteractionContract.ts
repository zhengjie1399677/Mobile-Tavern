import { z } from "zod";

export const THEME_INTERACTION_LIMITS = {
  maxMedia: 16,
  maxStateFields: 32,
  maxRules: 100,
  maxConditionsPerRule: 8,
  maxActionsPerRule: 8,
  maxPendingTimers: 10,
  maxDelayMs: 60_000,
  minCooldownMs: 100,
} as const;

export const THEME_MEDIA_SURFACES = [
  "main.background",
  "characters.background",
  "chat.background",
] as const;

const identifierSchema = z.string().min(1).max(64)
  .regex(/^[a-z][a-z0-9.-]*$/, "标识符只能使用小写字母、数字、点和连字符");
const stateKeySchema = z.string().min(1).max(40)
  .regex(/^[a-z][a-z0-9-]*$/, "状态名只能使用小写字母、数字和连字符");
const styleTokenSchema = z.string().min(1).max(48)
  .regex(/^[a-z][a-z0-9-]*$/, "主题状态 token 只能使用小写字母、数字和连字符");
const tabIdSchema = z.string().min(1).max(80)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "Tab ID 格式无效");
const resourceReferenceSchema = z.string().refine(
  value => /^tavern-resource:\/\/r_[a-z0-9_-]{1,80}$/.test(value),
  "媒体 src 必须是本地资源引用 tavern-resource://r_...",
);
const preloadSchema = z.enum(["none", "metadata", "auto"]).default("metadata");

const audioMediaSchema = z.object({
  type: z.literal("audio"),
  src: resourceReferenceSchema,
  loop: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(0.5),
  preload: preloadSchema,
}).strict();
const videoMediaSchema = z.object({
  type: z.literal("video"),
  src: resourceReferenceSchema,
  loop: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(true),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  preload: preloadSchema,
}).strict();
export const ThemeMediaDefinitionSchema = z.discriminatedUnion("type", [
  audioMediaSchema,
  videoMediaSchema,
]);

const booleanStateSchema = z.object({
  type: z.literal("boolean"),
  default: z.boolean(),
}).strict();
const enumStateSchema = z.object({
  type: z.literal("enum"),
  values: z.array(styleTokenSchema).min(1).max(16),
  default: styleTokenSchema,
}).strict().superRefine((definition, context) => {
  if (!definition.values.includes(definition.default)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["default"],
      message: "枚举默认值必须包含在 values 中",
    });
  }
});
const counterStateSchema = z.object({
  type: z.literal("counter"),
  default: z.number().int(),
  min: z.number().int(),
  max: z.number().int(),
}).strict().superRefine((definition, context) => {
  if (definition.min > definition.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["min"],
      message: "计数器 min 不能大于 max",
    });
  }
  if (definition.default < definition.min || definition.default > definition.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["default"],
      message: "计数器默认值必须位于 min 与 max 之间",
    });
  }
});
export const ThemeStateDefinitionSchema = z.union([
  booleanStateSchema,
  enumStateSchema,
  counterStateSchema,
]);

export const ThemeInteractionEventTypeSchema = z.enum([
  "theme.activate",
  "theme.deactivate",
  "tab.enter",
  "tab.leave",
  "app.pause",
  "app.resume",
  "orientation.change",
  "ui.tap",
  "media.ended",
]);
const whenSchema = z.object({
  event: ThemeInteractionEventTypeSchema,
  target: identifierSchema.optional(),
  tabId: tabIdSchema.optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  mediaId: identifierSchema.optional(),
}).strict().superRefine((when, context) => {
  if (when.event === "ui.tap" && !when.target) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target"],
      message: "ui.tap 必须指定语义 target",
    });
  }
});
const conditionSchema = z.discriminatedUnion("condition", [
  z.object({
    condition: z.literal("state.equals"),
    key: stateKeySchema,
    value: z.union([z.boolean(), z.string().max(48), z.number().int()]),
  }).strict(),
  z.object({ condition: z.literal("tab.is"), value: tabIdSchema }).strict(),
  z.object({
    condition: z.literal("orientation.is"),
    value: z.enum(["portrait", "landscape"]),
  }).strict(),
  z.object({ condition: z.literal("media.enabled"), value: z.boolean() }).strict(),
  z.object({
    condition: z.literal("accessibility.reducedMotion"),
    value: z.boolean(),
  }).strict(),
]);
const delayMsSchema = z.number().int().min(0)
  .max(THEME_INTERACTION_LIMITS.maxDelayMs).default(0);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("media.play"), target: identifierSchema, delayMs: delayMsSchema }).strict(),
  z.object({ action: z.literal("media.pause"), target: identifierSchema, delayMs: delayMsSchema }).strict(),
  z.object({ action: z.literal("media.stop"), target: identifierSchema, delayMs: delayMsSchema }).strict(),
  z.object({
    action: z.literal("media.setVolume"),
    target: identifierSchema,
    volume: z.number().min(0).max(1),
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("media.setMuted"),
    target: identifierSchema,
    muted: z.boolean(),
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("surface.show"),
    target: z.enum(THEME_MEDIA_SURFACES),
    mediaId: identifierSchema,
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("surface.hide"),
    target: z.enum(THEME_MEDIA_SURFACES),
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("state.set"),
    key: stateKeySchema,
    value: z.union([z.boolean(), styleTokenSchema, z.number().int()]),
    delayMs: delayMsSchema,
  }).strict(),
  z.object({ action: z.literal("state.toggle"), key: stateKeySchema, delayMs: delayMsSchema }).strict(),
  z.object({
    action: z.literal("state.increment"),
    key: stateKeySchema,
    amount: z.number().int().min(-100).max(100).default(1),
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("theme.state.add"),
    value: styleTokenSchema,
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("theme.state.remove"),
    value: styleTokenSchema,
    delayMs: delayMsSchema,
  }).strict(),
  z.object({
    action: z.literal("theme.state.replace"),
    group: styleTokenSchema,
    value: styleTokenSchema,
    delayMs: delayMsSchema,
  }).strict(),
]);
const ruleSchema = z.object({
  id: identifierSchema,
  when: whenSchema,
  if: z.array(conditionSchema).max(THEME_INTERACTION_LIMITS.maxConditionsPerRule).default([]),
  do: z.array(actionSchema).min(1).max(THEME_INTERACTION_LIMITS.maxActionsPerRule),
  cooldownMs: z.number().int().min(THEME_INTERACTION_LIMITS.minCooldownMs).max(60_000)
    .default(THEME_INTERACTION_LIMITS.minCooldownMs),
  once: z.boolean().default(false),
}).strict();
const configBaseSchema = z.object({
  media: z.record(identifierSchema, ThemeMediaDefinitionSchema).default({}),
  state: z.record(stateKeySchema, ThemeStateDefinitionSchema).default({}),
  interactions: z.array(ruleSchema).max(THEME_INTERACTION_LIMITS.maxRules).default([]),
}).strict();

export const ThemeInteractionConfigSchema = configBaseSchema.superRefine((config, context) => {
  if (Object.keys(config.media).length > THEME_INTERACTION_LIMITS.maxMedia) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["media"],
      message: `媒体定义不能超过 ${THEME_INTERACTION_LIMITS.maxMedia} 个`,
    });
  }
  if (Object.keys(config.state).length > THEME_INTERACTION_LIMITS.maxStateFields) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: `主题状态不能超过 ${THEME_INTERACTION_LIMITS.maxStateFields} 个`,
    });
  }

  const ruleIds = new Set<string>();
  config.interactions.forEach((rule, ruleIndex) => {
    if (ruleIds.has(rule.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interactions", ruleIndex, "id"],
        message: `规则 ID 重复：${rule.id}`,
      });
    }
    ruleIds.add(rule.id);

    if (rule.when.event === "media.ended" && rule.when.mediaId && !config.media[rule.when.mediaId]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interactions", ruleIndex, "when", "mediaId"],
        message: `未声明媒体：${rule.when.mediaId}`,
      });
    }

    rule.if.forEach((condition, conditionIndex) => {
      if (condition.condition === "state.equals") {
        const definition = config.state[condition.key];
        if (!definition) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["interactions", ruleIndex, "if", conditionIndex, "key"],
            message: `未声明主题状态：${condition.key}`,
          });
        } else if (!isStateValueValid(definition, condition.value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["interactions", ruleIndex, "if", conditionIndex, "value"],
            message: `状态 ${condition.key} 的条件值不符合声明`,
          });
        }
      }
    });

    rule.do.forEach((action, actionIndex) => {
      const actionPath = ["interactions", ruleIndex, "do", actionIndex];
      if (
        (action.action === "media.play" || action.action === "media.pause" ||
          action.action === "media.stop" || action.action === "media.setVolume" ||
          action.action === "media.setMuted") &&
        !config.media[action.target]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...actionPath, "target"],
          message: `未声明媒体：${action.target}`,
        });
      }
      if (action.action === "surface.show") {
        const media = config.media[action.mediaId];
        if (!media) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "mediaId"],
            message: `未声明媒体：${action.mediaId}`,
          });
        } else if (media.type !== "video") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "mediaId"],
            message: "媒体 Surface 只能显示视频资源",
          });
        }
      }
      if (
        action.action === "media.setMuted" &&
        config.media[action.target] &&
        config.media[action.target].type !== "video"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...actionPath, "target"],
          message: "media.setMuted 只能操作视频媒体",
        });
      }
      if (action.action === "theme.state.replace" && !action.value.startsWith(`${action.group}-`)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...actionPath, "value"],
          message: `theme.state.replace 的 value 必须以 ${action.group}- 开头`,
        });
      }
      if (
        action.action === "state.set" || action.action === "state.toggle" ||
        action.action === "state.increment"
      ) {
        const definition = config.state[action.key];
        if (!definition) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "key"],
            message: `未声明主题状态：${action.key}`,
          });
          return;
        }
        if (action.action === "state.toggle" && definition.type !== "boolean") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "key"],
            message: "state.toggle 只能操作布尔状态",
          });
        }
        if (action.action === "state.increment" && definition.type !== "counter") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "key"],
            message: "state.increment 只能操作计数器状态",
          });
        }
        if (action.action === "state.set" && !isStateValueValid(definition, action.value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...actionPath, "value"],
            message: `状态 ${action.key} 的值不符合声明`,
          });
        }
      }
    });
  });
});

export type ThemeMediaDefinition = z.infer<typeof ThemeMediaDefinitionSchema>;
export type ThemeStateDefinition = z.infer<typeof ThemeStateDefinitionSchema>;
export type ThemeInteractionCondition = z.infer<typeof conditionSchema>;
export type ThemeInteractionAction = z.infer<typeof actionSchema>;
export type ThemeInteractionRule = z.infer<typeof ruleSchema>;
export type ThemeInteractionConfig = z.infer<typeof ThemeInteractionConfigSchema>;
export type ThemeMediaSurface = typeof THEME_MEDIA_SURFACES[number];
export type ThemeInteractionEventType = z.infer<typeof ThemeInteractionEventTypeSchema>;
export type ThemeStateValue = boolean | string | number;

export interface ThemeInteractionParseResult {
  success: boolean;
  errors: string[];
  config?: ThemeInteractionConfig;
}

export function parseThemeInteractionConfig(value: unknown): ThemeInteractionParseResult {
  const result = ThemeInteractionConfigSchema.safeParse(value);
  if (result.success) return { success: true, errors: [], config: result.data };
  return {
    success: false,
    errors: result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}：` : "";
      return `${path}${issue.message}`;
    }),
  };
}

export function createEmptyThemeInteractionConfig(): ThemeInteractionConfig {
  return { media: {}, state: {}, interactions: [] };
}

function isStateValueValid(definition: ThemeStateDefinition, value: ThemeStateValue): boolean {
  if (definition.type === "boolean") return typeof value === "boolean";
  if (definition.type === "enum") return typeof value === "string" && definition.values.includes(value);
  return typeof value === "number" && Number.isInteger(value) &&
    value >= definition.min && value <= definition.max;
}
