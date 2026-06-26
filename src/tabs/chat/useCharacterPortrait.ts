// 立绘/表情 memo 计算逻辑
// 从原 ChatTab.tsx L722-915 抽离
// 计算 hasExpressions / activePortraitUrl / currentEmotionName / glowColors / safeCustomCss / isOriginalBg

import React from "react";

import { sanitizeCss } from "../../utils/security";
import { isSafeRegex } from "./utils";

interface UseCharacterPortraitDeps {
  activeCharacter: any;
  activeSession: any;
  settings: any;
}

export function useCharacterPortrait(deps: UseCharacterPortraitDeps) {
  const { activeCharacter, activeSession, settings } = deps;

  const hasExpressions = React.useMemo(() => {
    if (!activeCharacter) return false;
    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions;
    if (!expressions) return false;
    if (Array.isArray(expressions) && expressions.length > 0) return true;
    if (typeof expressions === "object" && Object.keys(expressions).length > 0) return true;
    return false;
  }, [activeCharacter]);

  const activePortraitUrl = React.useMemo(() => {
    if (!activeCharacter) return "";

    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};

    if (!expressions || (Array.isArray(expressions) && expressions.length === 0) || (typeof expressions === "object" && Object.keys(expressions).length === 0)) {
      return activeCharacter.avatar || "";
    }

    let lastAiText = "";
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        lastAiText = messages[i].content.toLowerCase();
        break;
      }
    }

    if (Array.isArray(expressions)) {
      for (const rule of expressions) {
        if (rule && typeof rule === "object" && rule.name && rule.image) {
          if (rule.triggers && lastAiText) {
            try {
              if (isSafeRegex(rule.triggers)) {
                const regex = new RegExp(rule.triggers, "i");
                if (regex.test(lastAiText)) {
                  return rule.image;
                }
              } else {
                console.warn("Potential ReDoS pattern bypassed in triggers matching:", rule.triggers);
                if (lastAiText.includes(rule.triggers.toLowerCase())) {
                  return rule.image;
                }
              }
            } catch (err) {
              console.warn("Invalid triggers RegExp in card:", rule.triggers, err);
            }
          }
        }
      }
      const defaultRule = expressions.find((r: any) => r && (r.name === "default" || r.name === "neutral"));
      if (defaultRule && defaultRule.image) {
        return defaultRule.image;
      }
      return expressions[0]?.image || activeCharacter.avatar || "";
    }

    if (typeof expressions === "object") {
      const presetTriggers: Record<string, string> = settings.expressionTriggers || {};

      if (lastAiText) {
        for (const key of Object.keys(expressions)) {
          const lowerKey = key.toLowerCase();
          const triggerPattern = presetTriggers[lowerKey];
          if (triggerPattern) {
            try {
              if (isSafeRegex(triggerPattern)) {
                const regex = new RegExp(triggerPattern, "i");
                if (regex.test(lastAiText)) {
                  return expressions[key];
                }
              } else {
                if (lastAiText.includes(triggerPattern.toLowerCase())) {
                  return expressions[key];
                }
              }
            } catch (err) {}
          }
        }
      }
      return expressions["default"] || expressions["neutral"] || expressions["normal"] || Object.values(expressions)[0] || activeCharacter.avatar || "";
    }

    return activeCharacter.avatar || "";
  }, [activeCharacter, activeSession, settings]);

  const currentEmotionName = React.useMemo(() => {
    if (!activeCharacter) return "默认";

    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};

    if (!expressions || (Array.isArray(expressions) && expressions.length === 0) || (typeof expressions === "object" && Object.keys(expressions).length === 0)) {
      return "默认";
    }

    let lastAiText = "";
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        lastAiText = messages[i].content.toLowerCase();
        break;
      }
    }

    if (!lastAiText) return "默认";

    if (Array.isArray(expressions)) {
      for (const rule of expressions) {
        if (rule && rule.name && rule.triggers && lastAiText) {
          try {
            if (isSafeRegex(rule.triggers)) {
              const regex = new RegExp(rule.triggers, "i");
              if (regex.test(lastAiText)) {
                return rule.name;
              }
            } else {
              if (lastAiText.includes(rule.triggers.toLowerCase())) {
                return rule.name;
              }
            }
          } catch (err) {}
        }
      }
      return "默认";
    }

    if (typeof expressions === "object") {
      const presetTriggers: Record<string, string> = settings.expressionTriggers || {};

      for (const key of Object.keys(expressions)) {
        const lowerKey = key.toLowerCase();
        const triggerPattern = presetTriggers[lowerKey];
        if (triggerPattern) {
          try {
            if (isSafeRegex(triggerPattern)) {
              const regex = new RegExp(triggerPattern, "i");
              if (regex.test(lastAiText)) {
                return key;
              }
            } else {
              if (lastAiText.includes(triggerPattern.toLowerCase())) {
                return key;
              }
            }
          } catch (err) {}
        }
      }
    }

    return "默认";
  }, [activeCharacter, activeSession, settings]);

  const glowColors = React.useMemo(() => {
    const emotionKey = (currentEmotionName || "默认").toLowerCase();

    // Light 1 (Bottom Right) is reactive, Light 2 (Top Left) is neutral atmosphere
    let light1 = "rgba(167, 139, 250, 0.28)"; // default purple
    let light2 = "rgba(34, 211, 238, 0.16)";   // default light cyan

    if (emotionKey.includes("joy") || emotionKey.includes("happy") || emotionKey.includes("smile")) {
      light1 = "rgba(244, 63, 94, 0.48)"; // Rose/Pink
      light2 = "rgba(251, 191, 36, 0.24)"; // Warm Gold
    } else if (emotionKey.includes("sad") || emotionKey.includes("cry") || emotionKey.includes("grief") || emotionKey.includes("sleepy") || emotionKey.includes("sleep")) {
      light1 = "rgba(59, 130, 246, 0.48)"; // Cold Blue
      light2 = "rgba(167, 139, 250, 0.22)"; // Soft Lavender
    } else if (emotionKey.includes("anger") || emotionKey.includes("angry") || emotionKey.includes("rage")) {
      light1 = "rgba(239, 68, 68, 0.48)"; // Crimson/Red
      light2 = "rgba(251, 191, 36, 0.22)"; // Warm Gold
    } else if (emotionKey.includes("blush") || emotionKey.includes("shy")) {
      light1 = "rgba(236, 72, 153, 0.48)"; // Deep Magenta/Pink
      light2 = "rgba(167, 139, 250, 0.22)"; // Soft Lavender
    }

    return { light1, light2 };
  }, [currentEmotionName]);

  const safeCustomCss = React.useMemo(() => {
    const css = activeCharacter?.visualSettings?.customCss;
    if (!css) return "";
    return sanitizeCss(css);
  }, [activeCharacter?.visualSettings?.customCss]);

  const isOriginalBg = (settings.chatBackgroundBlur ?? 10) === 0 && (settings.chatBackgroundDim ?? 50) === 0;

  return {
    hasExpressions,
    activePortraitUrl,
    currentEmotionName,
    glowColors,
    safeCustomCss,
    isOriginalBg,
  };
}
