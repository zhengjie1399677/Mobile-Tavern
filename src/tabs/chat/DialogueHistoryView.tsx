// Sub-tab 1 对话历史容器（背景层 + 滚动区）
// 从原 ChatTab.tsx L1152-1657 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收滚动引擎与立绘计算结果作为 props

import React from "react";
import {
  AlertCircle,
  ChevronUp,
  Brain,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import ChatInputArea from "./ChatInputArea";
import MessageBubble from "./MessageBubble";

interface DialogueHistoryViewProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  glowColors: { light1: string; light2: string };
  isOriginalBg: boolean;
  activePortraitUrl: string;
  isKeyboardOpen: boolean;
  expandedReasoningIds: Record<string, boolean>;
  setExpandedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedReasoningIds: Record<string, boolean>;
  setCopiedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const DialogueHistoryView = ({
  scrollContainerRef,
  handleScroll,
  glowColors,
  isOriginalBg,
  activePortraitUrl,
  isKeyboardOpen,
  expandedReasoningIds,
  setExpandedReasoningIds,
  copiedReasoningIds,
  setCopiedReasoningIds,
}: DialogueHistoryViewProps) => {
  const {
    activeCharacter,
    activeSession,
    settings,
    showFullHistory,
    setShowFullHistory,
    msgMenuId,
    setMsgMenuId,
    isSending,
    isSummarizing,
    chatBottomRef,
  } = useUnifiedApp();

  // 过滤隐藏的野牛静默消息
  const messagesToRender = (activeSession?.messages || []).filter((m: any) => !m.extra?.isBisonSilent);
  let foldedCount = 0;
  let visibleMessages = messagesToRender;
  if (!showFullHistory && messagesToRender.length > 20) {
    const foldIndex = messagesToRender.length - 20;
    foldedCount = foldIndex;
    visibleMessages = messagesToRender.slice(foldIndex);
  }

  // 预计算每条消息的轮次编号
  const roundNums: Record<string, number> = {};
  let roundCount = 0;
  (activeSession?.messages || []).forEach((m: any) => {
    if (m.sender === "user") {
      roundCount++;
    }
    roundNums[m.id] = roundCount;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
      {/* Custom card background layer */}
      {(activeCharacter?.visualSettings?.backgroundImageUrl || settings.globalChatBg) && (
        <>
          {/* 1. 大图背景及动效/模糊层 */}
          <div
            className={`absolute inset-0 z-0 pointer-events-none bg-cover bg-center transition-[opacity,filter] duration-700 ${
              isOriginalBg ? "" : "mask-feather-y"
            } ${
              (settings.enableChatBgAnimation ?? false) ? "animate-bg-pan-zoom" : ""
            }`}
            style={{
              backgroundImage: `url(${activeCharacter?.visualSettings?.backgroundImageUrl || settings.globalChatBg})`,
              opacity: activeCharacter?.visualSettings?.backgroundImageUrl
                ? (activeCharacter.visualSettings.backgroundOpacity ?? (isOriginalBg ? 1.0 : 0.9))
                : (isOriginalBg ? 1.0 : 0.9),
              filter: isOriginalBg
                ? "none"
                : `blur(${
                    activeCharacter?.visualSettings?.backgroundImageUrl && activeCharacter.visualSettings.backgroundBlur !== undefined
                      ? activeCharacter.visualSettings.backgroundBlur
                      : (settings.chatBackgroundBlur ?? 10)
                  }px)`,
            }}
          />
          {/* 2. 主题色变暗融合层 */}
          {!isOriginalBg && (
            <div
              className="absolute inset-0 z-0 pointer-events-none transition-all duration-500"
              style={{
                backgroundColor: "var(--background)",
                opacity: (settings.chatBackgroundDim ?? 50) / 100,
              }}
            />
          )}
          {/* 3. 渐变羽化保护层 */}
          {!isOriginalBg && <div className="absolute inset-0 z-0 pointer-events-none chat-bg-mask" />}
        </>
      )}

      {/* 4. 双光源情绪环境光融合层 */}
      {settings.enableEmotionAmbientGlow && (
        <div
          className="absolute inset-0 pointer-events-none z-0 transition-all duration-1000 ease-in-out overflow-hidden"
          style={{
            background: `
              radial-gradient(circle at 75% 75%, ${glowColors.light1} 0%, transparent 75%),
              radial-gradient(circle at 25% 25%, ${glowColors.light2} 0%, transparent 70%)
            `
          }}
        />
      )}

      {/* Dialog Scroll area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        role="log"
        aria-label="聊天消息记录"
        aria-live="polite"
        aria-relevant="additions"
        className="p-3.5 space-y-4 flex-1 overflow-y-auto custom-scrollbar relative z-10"
        onClick={() => {
          if (msgMenuId) setMsgMenuId(null);
        }}
      >
        {foldedCount > 0 && (
          <div className="flex justify-center mb-2 animate-fadeIn">
            <button
              onClick={() => setShowFullHistory(true)}
              aria-label={`展开更早的 ${foldedCount} 条历史对话`}
              className="bg-muted hover:bg-muted/80 border border-border text-[10px] px-4 py-1.5 rounded-full text-muted-foreground shadow-sm flex items-center gap-1.5 transition"
            >
              <ChevronUp className="w-3 h-3" aria-hidden="true" /> 点击展开更早的{" "}
              {foldedCount} 条历史对话 (节约内存渲染)
            </button>
          </div>
        )}
        {visibleMessages.map((message: any, idx: number) => {
          const isSystem = message.sender === "system";

          if (isSystem) {
            return (
              <div
                key={message.id}
                className="flex items-center justify-center"
              >
                <div
                  role="status"
                  aria-label={`系统提示：${message.content}`}
                  className="bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-lg border border-primary/30 max-w-xs text-center flex items-start gap-1.5 leading-relaxed"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{message.content}</span>
                </div>
              </div>
            );
          }

          return (
            <React.Fragment key={message.id}>
              <MessageBubble
                message={message}
                idx={idx}
                foldedCount={foldedCount}
                roundNum={roundNums[message.id] || 0}
                activePortraitUrl={activePortraitUrl}
                expandedReasoningIds={expandedReasoningIds}
                setExpandedReasoningIds={setExpandedReasoningIds}
                copiedReasoningIds={copiedReasoningIds}
                setCopiedReasoningIds={setCopiedReasoningIds}
                messagesToRenderLength={visibleMessages.length}
              />
            </React.Fragment>
          );
        })}

        {/* Typing Indicator */}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground italic pl-5">
            <div className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              ></span>
              <span
                className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              ></span>
              <span
                className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              ></span>
            </div>
            <span>{activeCharacter?.name} 正在雕琢语气并思索下文...</span>
          </div>
        )}

        {isSummarizing && (
          <div className="flex items-center gap-2 text-xs text-primary italic pl-5 py-1 animate-pulse">
            <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>系统正在整理潜意识碎片...</span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      <ChatInputArea isKeyboardOpen={isKeyboardOpen} />
    </div>
  );
};

export default DialogueHistoryView;
