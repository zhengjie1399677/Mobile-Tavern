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

  React.useEffect(() => {
    hasMoreMessagesRef.current = deps.hasMoreMessages ?? false;
    isLoadingMoreMessagesRef.current = deps.isLoadingMoreMessages ?? false;
    onLoadMoreMessagesRef.current = deps.onLoadMoreMessages;
  }, [deps.hasMoreMessages, deps.isLoadingMoreMessages, deps.onLoadMoreMessages]);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef<boolean>(true);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const showScrollButtonRef = React.useRef(false);
  const scrollFrameRef = React.useRef<number | null>(null);

  // 顶部触底防抖：避免单次滑动内连续触发多次加载
  const lastLoadMoreTsRef = React.useRef<number>(0);
  const initialPositionReadyRef = React.useRef(false);

  React.useEffect(() => {
    initialPositionReadyRef.current = false;
  }, [activeSessionId, chatSubTab]);

  React.useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const markInitialPositionReady = React.useCallback((sessionId: string) => {
    if (sessionId === activeSessionId && deps.messageHydrationStatus === "ready") {
      initialPositionReadyRef.current = true;
    }
  }, [activeSessionId, deps.messageHydrationStatus]);

  const handleScroll = React.useCallback(() => {
    // WebView 惯性滚动会在一帧内派发多次 scroll。只在下一帧读取最后位置，
    // 避免按钮状态与顶部分页检查反复触发 React 渲染，放大虚拟列表测量抖动。
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;
      isAtBottomRef.current = distanceToBottom < 60;

      const shouldShowScrollButton = distanceToBottom > 300;
      if (showScrollButtonRef.current !== shouldShowScrollButton) {
        showScrollButtonRef.current = shouldShowScrollButton;
        setShowScrollButton(shouldShowScrollButton);
      }

      // 顶部分页在帧合并之外再保留 500ms 时间门控，防止加载状态提交前重复请求。
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
    });
  }, []);

  const scrollToBottom = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    isAtBottomRef.current = true;
    showScrollButtonRef.current = false;
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
