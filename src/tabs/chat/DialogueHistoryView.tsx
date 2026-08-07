// Sub-tab 1 对话历史容器（背景层 + 滚动区）
// 从原 ChatTab.tsx L1152-1657 抽离
// 通过 selector 订阅所需上下文字段，接收滚动引擎与立绘计算结果作为 props

import React from "react";
import {
  AlertCircle,
  ChevronUp,
  Brain,
  ArrowDown,
  Loader2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

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
    msgMenuId,
    setMsgMenuId,
    isSending,
    isSummarizing,
    chatBottomRef,
    // 单会话消息分页懒加载
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
  } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    settings: state.settings,
    msgMenuId: state.msgMenuId,
    setMsgMenuId: state.setMsgMenuId,
    isSending: state.isSending,
    isSummarizing: state.isSummarizing,
    chatBottomRef: state.chatBottomRef,
    hasMoreMessages: state.hasMoreMessages,
    isLoadingMoreMessages: state.isLoadingMoreMessages,
    loadMoreMessages: state.loadMoreMessages,
  }));

  const [swipedMsgId, setSwipedMsgId] = React.useState<string | null>(null);

  // 过滤隐藏的野牛静默消息
  const rawMessages = (activeSession?.messages || []).filter((m: any) => !m.extra?.isBisonSilent);

  // 性能优化：流式期间 activeSession.messages 每 60ms 触发一次 setSessions，
  // 若直接驱动 visibleMessages.map 渲染会阻塞用户滚动等高优先级交互。
  // useDeferredValue 让 React 把"消息列表变化"降级为低优先级更新，
  // 高优先级更新（滚动、点击、输入）能立即响应，流式文本延迟到下次空闲帧合并提交。
  // 注意：isStreamingThisMsg 判断走 window.TavernHelperStreamingMessageId（同步读取），
  // 不依赖此处的 deferred 值，流式渲染判断逻辑不受影响。
  const messagesToRender = React.useDeferredValue(rawMessages);

  // 消息流不再折叠：历史消息完整性由"故事年表"子页维护（总结卡片与检索入口），
  // 正文渲染只由分页懒加载（内存规模）与虚拟列表（DOM 数量）控制。

  // 预计算每条消息的轮次编号
  const roundNums: Record<string, number> = {};
  let roundCount = 0;
  (activeSession?.messages || []).forEach((m: any) => {
    if (m.sender === "user") {
      roundCount++;
    }
    roundNums[m.id] = roundCount;
  });

  // 虚拟列表：长会话下 messagesToRender 可达数百条，全量渲染会导致
  // React VDOM 协调遍历 1500+ 节点。useVirtualizer 只渲染视口内 + overscan 条目，
  // 协调节点数从 ~1500 降到 ~100，是 50 轮长会话延迟优化的关键。
  // - estimateSize 400px：与原 content-visibility 的 containIntrinsicSize 一致
  // - overscan 5：移动端快速滚动时预渲染 5 条避免空白
  // - measureElement：动态测量实际高度，流式消息高度变化时 ResizeObserver 自动重测
  // - gap strategy: paddingBottom 1rem 模拟原 space-y-4 间距
  const virtualizer = useVirtualizer({
    count: messagesToRender.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 400,
    overscan: 5,
    measureElement: (element) => element.getBoundingClientRect().height,
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
        className="p-3.5 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar relative z-10"
        onClick={() => {
          if (msgMenuId) setMsgMenuId(null);
        }}
      >
        {/* 分页加载更多历史消息指示器。
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
        {/* 虚拟列表容器：占位总高度，子项绝对定位。
            顶部按钮与底部 typing/chatBottomRef 流式布局在虚拟列表之外，
            共享同一滚动容器。 */}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const message = messagesToRender[vi.index];
            const isSystem = message.sender === "system";

            // 预计算 isStreamingThisMsg：只有流式中的消息和末位消息会变，
            // 其余消息此值为 false 且不随 isSending/messagesToRenderLength 变化而变化，
            // 配合 React.memo 可跳过绝大多数 MessageBubble 的重渲染。
            const streamingId = typeof window !== "undefined"
              ? (window as unknown as { TavernHelperStreamingMessageId?: string | undefined })
                  .TavernHelperStreamingMessageId
              : undefined;
            const isStreamingThisMsg = streamingId
              ? streamingId === message.id
              : isSending && vi.index === messagesToRender.length - 1;

            return (
              <div
                key={message.id}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  // translateY 而非 top：避免触发 layout，走合成器层
                  transform: `translateY(${vi.start}px)`,
                  // 模拟原 space-y-4 间距（1rem = 16px）
                  paddingBottom: "1rem",
                }}
              >
                {isSystem ? (
                  <div className="flex items-center justify-center">
                    <div
                      role="status"
                      aria-label={`系统提示：${message.content}`}
                      className="bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-lg border border-primary/30 max-w-xs text-center flex items-start gap-1.5 leading-relaxed"
                    >
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{message.content}</span>
                    </div>
                  </div>
                ) : (
                  <MessageBubble
                    message={message}
                    idx={vi.index}
                    roundNum={roundNums[message.id] || 0}
                    activePortraitUrl={activePortraitUrl}
                    expandedReasoningIds={expandedReasoningIds}
                    setExpandedReasoningIds={setExpandedReasoningIds}
                    copiedReasoningIds={copiedReasoningIds}
                    setCopiedReasoningIds={setCopiedReasoningIds}
                    isStreamingThisMsg={isStreamingThisMsg}
                    swipedMsgId={swipedMsgId}
                    setSwipedMsgId={setSwipedMsgId}
                  />
                )}
              </div>
            );
          })}
        </div>

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
