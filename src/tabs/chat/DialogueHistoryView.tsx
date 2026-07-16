// Sub-tab 1 对话历史容器（背景层 + 滚动区）
// 从原 ChatTab.tsx L1152-1657 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收滚动引擎与立绘计算结果作为 props

import React from "react";
import {
  AlertCircle,
  ChevronUp,
  Brain,
  ArrowDown,
  Loader2,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import ChatInputArea from "./ChatInputArea";
import MessageBubble from "./MessageBubble";

interface DialogueHistoryViewProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  showScrollButton: boolean;
  scrollToBottom: () => void;
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
  showScrollButton,
  scrollToBottom,
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
    // TODO-4: 消息分页懒加载
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
  } = useUnifiedApp();

  const [swipedMsgId, setSwipedMsgId] = React.useState<string | null>(null);

  // 过滤隐藏的野牛静默消息
  const messagesToRender = (activeSession?.messages || []).filter((m: any) => !m.extra?.isBisonSilent);

  // TODO-3: 历史消息截断与总结归档。
  // 当 session.lastSummarizedMessageId 存在时，将其之前的消息视为已归档（已生成 SummaryCard），
  // 默认从渲染流中折叠，用户可通过"查看故事年表"按钮在时间轴抽屉中检索。
  // 若未设置 lastSummarizedMessageId，退回原 20 条折叠逻辑。
  let foldedCount = 0;
  let visibleMessages = messagesToRender;
  const lastSummarizedId = activeSession?.lastSummarizedMessageId;
  if (!showFullHistory && lastSummarizedId) {
    const archiveIndex = messagesToRender.findIndex((m: any) => m.id === lastSummarizedId);
    if (archiveIndex >= 0 && archiveIndex + 1 < messagesToRender.length) {
      foldedCount = archiveIndex + 1;
      visibleMessages = messagesToRender.slice(foldedCount);
    }
  } else if (!showFullHistory && messagesToRender.length > 20) {
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
        className="p-3.5 space-y-4 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar relative z-10"
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
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
              {lastSummarizedId
                ? `已归档 ${foldedCount} 条至故事年表，点击展开`
                : `点击展开更早的 ${foldedCount} 条历史对话 (节约内存渲染)`}
            </button>
          </div>
        )}
        {/* TODO-4: 分页加载更多历史消息指示器。
            1. isLoadingMoreMessages=true：显示加载中旋转图标
            2. hasMoreMessages=true 且未在加载：显示可点击的"加载更早消息"按钮（备用入口，正常情况下由顶部滚动自动触发）
            3. 两者皆否：不渲染 */}
        {(isLoadingMoreMessages || hasMoreMessages) && (
          <div className="flex justify-center mb-2">
            {isLoadingMoreMessages ? (
              <div
                className="text-[10px] px-4 py-1.5 rounded-full text-muted-foreground bg-muted/60 border border-border flex items-center gap-1.5"
                aria-live="polite"
                aria-label="正在加载更早的历史消息"
              >
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                正在加载更早的消息...
              </div>
            ) : (
              <button
                onClick={() => loadMoreMessages()}
                aria-label="加载更早的历史消息"
                className="bg-muted hover:bg-muted/80 border border-border text-[10px] px-4 py-1.5 rounded-full text-muted-foreground shadow-sm flex items-center gap-1.5 transition"
              >
                <ChevronUp className="w-3 h-3" aria-hidden="true" /> 加载更早的消息
              </button>
            )}
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
                swipedMsgId={swipedMsgId}
                setSwipedMsgId={setSwipedMsgId}
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

      {/* Floating Scroll to Bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          aria-label="回到底部"
          title="回到底部"
          className="absolute bottom-24 right-4 p-2.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 active:scale-95 transition-all z-20 flex items-center justify-center border border-primary/20 cursor-pointer animate-in fade-in zoom-in duration-200"
        >
          <ArrowDown className="w-4.5 h-4.5" />
        </button>
      )}

      <ChatInputArea isKeyboardOpen={isKeyboardOpen} />
    </div>
  );
};

export default DialogueHistoryView;
