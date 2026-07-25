// 角色渲染管线纯函数模块
// 从 useCharacterPortrait.ts 抽取的"文本 + 角色卡 → 渲染状态"状态机，
// 供 WebView 聊天立绘、应用内悬浮助手、AR Activity 等多消费者共用。
//
// 设计要点：
//   - 纯函数，无 React 依赖，无副作用，可在任何环境调用
//   - 消除原 useCharacterPortrait 中 activePortraitUrl 与 currentEmotionName 的重复遍历：
//     合并为单次 matchExpression，一次匹配同时得到 { name, image }

import { isSafeRegex } from "../../tabs/chat/utils";

// ─── 类型契约 ─────────────────────────────────────────────────────────────────

export interface RenderState {
  /** 当前情绪名，如 "joy"、"anger"、"默认" */
  emotion: string;
  /** 当前应显示的表情图（base64 data URL 或普通 URL），无表情时回退 avatar */
  portraitBase64: string;
  /** 环境光晕双色，驱动渲染层光源配色 */
  glowColors: {
    light1: string;
    light2: string;
  };
}

export interface PipelineInput {
  /** 最近一条 assistant 消息文本（小写），无则空串 */
  lastAssistantText: string;
  /** 角色卡（含 expressions + visualSettings + extensions） */
  character: any;
  /** 全局表情触发词配置（settings.expressionTriggers） */
  expressionTriggers: Record<string, string>;
}

// ─── 核心纯函数 ───────────────────────────────────────────────────────────────

/**
 * 文本 + 角色卡 → 渲染状态。
 *
 * 行为对齐 useCharacterPortrait.ts L30-198 的原始逻辑：
 *   - 数组式 expressions：遍历 rule.triggers 正则匹配
 *   - 字典式 expressions：按 key 查 expressionTriggers 预设触发词
 *   - 匹配失败回退 default/neutral/normal/首项/avatar
 *   - glowColors 由 emotion 关键词驱动（joy/sad/anger/blush 四类 + 默认紫青）
 */
export function computeRenderState(input: PipelineInput): RenderState {
  const { lastAssistantText, character, expressionTriggers } = input;
  const text = lastAssistantText;

  const ext = character?.extensions || {};
  const rawStyle = ext.style || ext.character_style || {};
  const expressions =
    character?.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};

  const hasExpressions =
    (Array.isArray(expressions) && expressions.length > 0) ||
    (!Array.isArray(expressions) &&
      expressions &&
      typeof expressions === "object" &&
      Object.keys(expressions).length > 0);

  // 单次匹配同时得到情绪名与表情图，消除原 hook 的重复遍历
  const matched = hasExpressions ? matchExpression(text, expressions, expressionTriggers) : null;

  const emotion = matched?.name ?? "默认";
  const portraitBase64 = matched?.image ?? character?.avatar ?? "";
  const glowColors = resolveGlowColors(emotion);

  return { emotion, portraitBase64, glowColors };
}

// ─── 内部辅助 ─────────────────────────────────────────────────────────────────

interface ExpressionMatch {
  name: string;
  image: string;
}

/**
 * 单次遍历 expressions，同时解析情绪名与对应表情图。
 * 合并自原 useCharacterPortrait 的 activePortraitUrl (L30-106) 与 currentEmotionName (L108-174)。
 */
function matchExpression(
  text: string,
  expressions: any,
  presetTriggers: Record<string, string>
): ExpressionMatch | null {
  if (Array.isArray(expressions)) {
    // 数组式：每条 rule 含 { name, image, triggers }
    if (!text) {
      // 无文本时回退 default/neutral/首项
      const def = expressions.find(
        (r: any) => r && (r.name === "default" || r.name === "neutral")
      );
      if (def?.image) return { name: def.name, image: def.image };
      const first = expressions[0];
      return first?.image ? { name: first.name ?? "默认", image: first.image } : null;
    }

    for (const rule of expressions) {
      if (!rule || typeof rule !== "object" || !rule.name || !rule.image || !rule.triggers) {
        continue;
      }
      if (tryTrigger(text, rule.triggers)) {
        return { name: rule.name, image: rule.image };
      }
    }

    // 匹配失败回退
    const def = expressions.find((r: any) => r && (r.name === "default" || r.name === "neutral"));
    if (def?.image) return { name: def.name, image: def.image };
    const first = expressions[0];
    return first?.image ? { name: first.name ?? "默认", image: first.image } : null;
  }

  if (expressions && typeof expressions === "object") {
    // 字典式：key 为情绪名，value 为图片；触发词来自 presetTriggers
    const keys = Object.keys(expressions);
    if (!text) {
      const fallbackKey =
        ["default", "neutral", "normal"].find((k) => expressions[k]) || keys[0];
      return fallbackKey ? { name: fallbackKey, image: expressions[fallbackKey] } : null;
    }

    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      const triggerPattern = presetTriggers[lowerKey];
      if (!triggerPattern) continue;
      if (tryTrigger(text, triggerPattern)) {
        return { name: key, image: expressions[key] };
      }
    }

    // 匹配失败回退
    const fallbackKey =
      ["default", "neutral", "normal"].find((k) => expressions[k]) || keys[0];
    return fallbackKey ? { name: fallbackKey, image: expressions[fallbackKey] } : null;
  }

  return null;
}

/** 安全执行触发词匹配：安全正则 → 正则匹配；不安全 → 包含匹配 */
function tryTrigger(text: string, trigger: string): boolean {
  if (!trigger) return false;
  try {
    if (isSafeRegex(trigger)) {
      return new RegExp(trigger, "i").test(text);
    }
    // 不安全正则降级为子串包含
    console.warn("Potential ReDoS pattern bypassed in triggers matching:", trigger);
    return text.includes(trigger.toLowerCase());
  } catch (err) {
    console.warn("Invalid triggers RegExp in card:", trigger, err);
    return false;
  }
}

/** 情绪 → 光晕配色（对齐原 useCharacterPortrait L176-198） */
function resolveGlowColors(emotion: string): { light1: string; light2: string } {
  const key = (emotion || "默认").toLowerCase();

  // Light 1 (Bottom Right) is reactive, Light 2 (Top Left) is neutral atmosphere
  let light1 = "rgba(167, 139, 250, 0.28)"; // default purple
  let light2 = "rgba(34, 211, 238, 0.16)"; // default light cyan

  if (key.includes("joy") || key.includes("happy") || key.includes("smile")) {
    light1 = "rgba(244, 63, 94, 0.48)"; // Rose/Pink
    light2 = "rgba(251, 191, 36, 0.24)"; // Warm Gold
  } else if (
    key.includes("sad") ||
    key.includes("cry") ||
    key.includes("grief") ||
    key.includes("sleepy") ||
    key.includes("sleep")
  ) {
    light1 = "rgba(59, 130, 246, 0.48)"; // Cold Blue
    light2 = "rgba(167, 139, 250, 0.22)"; // Soft Lavender
  } else if (key.includes("anger") || key.includes("angry") || key.includes("rage")) {
    light1 = "rgba(239, 68, 68, 0.48)"; // Crimson/Red
    light2 = "rgba(251, 191, 36, 0.22)"; // Warm Gold
  } else if (key.includes("blush") || key.includes("shy")) {
    light1 = "rgba(236, 72, 153, 0.48)"; // Deep Magenta/Pink
    light2 = "rgba(167, 139, 250, 0.22)"; // Soft Lavender
  }

  return { light1, light2 };
}
