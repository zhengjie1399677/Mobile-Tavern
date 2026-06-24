import { useCallback } from "react";
import React from "react";
import FormattedText from "../../components/FormattedText";
import { CharacterCard, UserSettings } from "../../types";

/**
 * 提供 renderDialogueBubble 渲染函数，将 FormattedText 组件依赖封装在此模块，
 * 避免在 useChat 主体中直接引入 JSX/React 组件。
 */
export function useDialogueBubble(params: {
  activeCharacter: CharacterCard | null;
  settings: UserSettings;
}) {
  const { activeCharacter, settings } = params;

  const renderDialogueBubble = useCallback((text: string, messageIndex?: number) => {
    return (
      <FormattedText
        text={text}
        charName={activeCharacter?.name || ""}
        userName={settings.userName}
        messageIndex={messageIndex}
      />
    );
  }, [activeCharacter, settings]);

  return { renderDialogueBubble };
}
