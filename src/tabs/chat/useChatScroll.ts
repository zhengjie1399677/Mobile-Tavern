// 滚动引擎 Hook
// 从原 ChatTab.tsx L628-720 抽离
// 管理滚动状态、顶部分页门控与手动归底

import React from "react";
import type { ChatMessageHydrationStatus } from "../../types";

interface UseChatScrollDeps {
  activeSessionId: string | null;
  chatSubTab: string;
  // 顶部触发加载更多历史消息
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
  onLoadMoreMessages?: () => void;
  messageHydrationStatus?: ChatMessageHydrationStatus;
}

export function useChatScroll(deps: UseChatScrollDeps) {
  const { activeSessionId, chatSubTab } = deps;
  // 将可变回调用 ref 镜像，避免 handleScroll 闭包陈旧依赖
  const hasMoreMessagesRef = React.useRef(deps.hasMoreMessages ?? false);
  const isLoadingMoreMessagesRef = React.useRef(deps.isLoadingMoreMessages ?? false);
  const onLoadMoreMessagesRef = React.useRef(deps.onLoadMoreMessages);
  hasMoreMessagesRef.current = deps.hasMoreMessages ?? false;
  isLoadingMoreMessagesRef.current = deps.isLoadingMoreMessages ?? false;
  onLoadMoreMessagesRef.current = deps.onLoadMoreMessages;

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef<boolean>(true);
  const [showScrollButton, setShowScrollButton] = React.useState(false);

  // 顶部触底防抖：避免单次滑动内连续触发多次加载
  const lastLoadMoreTsRef = React.useRef<number>(0);
  const initialPositionReadyRef = React.useRef(false);

  React.useEffect(() => {
    initialPositionReadyRef.current = false;
  }, [activeSessionId, chatSubTab]);

  const markInitialPositionReady = React.useCallback((sessionId: string) => {
    if (sessionId === activeSessionId && deps.messageHydrationStatus === "ready") {
      initialPositionReadyRef.current = true;
    }
  }, [activeSessionId, deps.messageHydrationStatus]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    // If the user is within 60px of the bottom, consider them "at the bottom"
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    isAtBottomRef.current = atBottom;

    // Show scroll button if scrolled up by more than 300px
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollButton(distanceToBottom > 300);

    // 顶部触发加载更多历史消息
    // 仅在接近顶部 80px 且仍有更多历史且当前未在加载时触发，加 500ms 防抖
    if (
      scrollTop < 80 &&
      initialPositionReadyRef.current &&
      hasMoreMessagesRef.current &&
      !isLoadingMoreMessagesRef.current &&
      onLoadMoreMessagesRef.current &&
      Date.now() - lastLoadMoreTsRef.current > 500
    ) {
      lastLoadMoreTsRef.current = Date.now();
      onLoadMoreMessagesRef.current();
    }
  };

  const scrollToBottom = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  return {
    scrollContainerRef,
    handleScroll,
    isAtBottomRef,
    showScrollButton,
    scrollToBottom,
    markInitialPositionReady,
  };
}
