// 立绘/表情 memo 计算逻辑
// 从原 ChatTab.tsx L722-915 抽离
// 计算 hasExpressions / activePortraitUrl / currentEmotionName / glowColors / safeCustomCss / isOriginalBg
//
// P0 重构：情绪/表情图/光晕三者的计算逻辑已抽取为纯函数 computeRenderState
// （见 src/services/characterRender/pipeline.ts），本 hook 调用纯函数保持行为一致，
// 并在 useEffect 中将结果推送给 CharacterRenderService 供 AR / 悬浮助手等消费者订阅。
// hasExpressions / safeCustomCss / isOriginalBg 为 UI 专属逻辑，留在 hook 内。

import React from "react";

import { sanitizeCss } from "../../utils/security";
import { computeRenderState } from "../../services/characterRender/pipeline";
import { globalKernel } from "../../kernel/Kernel";

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

  // 单次 useMemo 计算情绪/表情图/光晕三元组（行为对齐原 activePortraitUrl + currentEmotionName + glowColors）
  const renderState = React.useMemo(() => {
    // 提取最近一条 assistant 消息文本（对齐原 L42-48 逻辑）
    let lastAiText = "";
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        lastAiText = messages[i].content.toLowerCase();
        break;
      }
    }

    return computeRenderState({
      lastAssistantText: lastAiText,
      character: activeCharacter,
      expressionTriggers: settings.expressionTriggers || {},
    });
  }, [activeCharacter, activeSession, settings]);

  // 推送到 CharacterRenderService 供 AR / 悬浮助手等消费者订阅
  // 直接推送已计算的 RenderState，避免在服务内重复计算
  // fire-and-forget：服务不可用（SafeProxy 降级）时静默，不影响聊天主链路
  React.useEffect(() => {
    try {
      const service = globalKernel.getService<any>("characterRender");
      if (service && typeof service.setState === "function") {
        service.setState(renderState);
      }
    } catch {
      // 静默：服务未注册或降级时不影响聊天
    }
  }, [renderState]);

  const safeCustomCss = React.useMemo(() => {
    const css = activeCharacter?.visualSettings?.customCss;
    if (!css) return "";
    return sanitizeCss(css);
  }, [activeCharacter?.visualSettings?.customCss]);

  const isOriginalBg = (settings.chatBackgroundBlur ?? 10) === 0 && (settings.chatBackgroundDim ?? 50) === 0;

  return {
    hasExpressions,
    activePortraitUrl: renderState.portraitBase64,
    currentEmotionName: renderState.emotion,
    glowColors: renderState.glowColors,
    safeCustomCss,
    isOriginalBg,
  };
}
