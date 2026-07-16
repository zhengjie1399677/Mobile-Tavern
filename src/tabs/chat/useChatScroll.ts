// 滚动引擎 Hook
// 从原 ChatTab.tsx L628-720 抽离
// 管理 MutationObserver / ResizeObserver / 归底逻辑

import React from "react";

interface UseChatScrollDeps {
  activeSessionId: string | null;
  chatSubTab: string;
  // TODO-4: 顶部触发加载更多历史消息
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
  onLoadMoreMessages?: () => void;
}

export function useChatScroll(deps: UseChatScrollDeps) {
  const { activeSessionId, chatSubTab } = deps;
  // TODO-4: 将可变回调用 ref 镜像，避免 handleScroll 闭包陈旧依赖
  const hasMoreMessagesRef = React.useRef(deps.hasMoreMessages ?? false);
  const isLoadingMoreMessagesRef = React.useRef(deps.isLoadingMoreMessages ?? false);
  const onLoadMoreMessagesRef = React.useRef(deps.onLoadMoreMessages);
  hasMoreMessagesRef.current = deps.hasMoreMessages ?? false;
  isLoadingMoreMessagesRef.current = deps.isLoadingMoreMessages ?? false;
  onLoadMoreMessagesRef.current = deps.onLoadMoreMessages;

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef<boolean>(true);
  const [showScrollButton, setShowScrollButton] = React.useState(false);

  // TODO-4: 滚动位置保持
  // 在触发 loadMoreMessages 前记录 scrollHeight，加载完成后在 useEffect 中补偿 scrollTop，
  // 使新 prepend 的历史消息位于视口上方，用户视觉锚点（当前可见消息）保持不动。
  const pendingScrollPreserveRef = React.useRef<{ heightBefore: number } | null>(null);
  // 顶部触底防抖：避免单次滑动内连续触发多次加载
  const lastLoadMoreTsRef = React.useRef<number>(0);

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

    // TODO-4: 顶部触发加载更多历史消息
    // 仅在接近顶部 80px 且仍有更多历史且当前未在加载时触发，加 500ms 防抖
    if (
      scrollTop < 80 &&
      hasMoreMessagesRef.current &&
      !isLoadingMoreMessagesRef.current &&
      onLoadMoreMessagesRef.current &&
      Date.now() - lastLoadMoreTsRef.current > 500
    ) {
      lastLoadMoreTsRef.current = Date.now();
      pendingScrollPreserveRef.current = { heightBefore: scrollHeight };
      onLoadMoreMessagesRef.current();
    }
  };

  // TODO-4: 加载更多完成后，若 pendingScrollPreserveRef 有值，补偿 scrollTop 保持视觉锚点
  // 通过监听 container 的 scrollHeight 变化来感知加载完成（isLoadingMoreMessages 由 true→false）
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !pendingScrollPreserveRef.current) return;
    if (deps.isLoadingMoreMessages) return; // 仍在加载中，等下一次变化
    const { heightBefore } = pendingScrollPreserveRef.current;
    pendingScrollPreserveRef.current = null;
    const newHeight = container.scrollHeight;
    const delta = newHeight - heightBefore;
    if (delta > 0) {
      // 新增的历史消息在顶部，向下补偿 delta 像素，使用户仍看到原先可见的消息
      container.scrollTop = container.scrollTop + delta;
    }
  }, [deps.isLoadingMoreMessages, activeSessionId, chatSubTab]);

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

  // Auto-scroll logic utilizing MutationObserver to track any DOM/style updates
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollToBottom = (label: string = "?") => {
      const before = container.scrollTop;
      container.scrollTop = container.scrollHeight;
      // 强制触发 reflow，解决 Webkit 滚动渲染与合成图层不同步的 bug
      const _unused = container.offsetHeight;

      // 微调 0.5 像素重新激活 Compositor 滚动检测，消除 WebView 合成滞后
      requestAnimationFrame(() => {
        if (container.scrollTop > 0) {
          container.scrollTop += 0.5;
          container.scrollTop -= 0.5;
        }
      });
      console.log(`[scroll][${label}] scrollH=${container.scrollHeight} clientH=${container.clientHeight} before=${Math.round(before)} after=${Math.round(container.scrollTop)}`);
    };

    // 初始稳定化标志：在组件挂载后 600ms 内，ResizeObserver 无条件强制归底
    // 覆盖以下异步布局抖动链：
    //   1. Android WebView 首次 paint 异步完成（scrollHeight 延迟撑开）
    //   2. visualViewport.resize 触发 250ms 延迟内的 setIsKeyboardOpen 更新
    //   3. safeAreas 从 AndroidThemeBridge 异步读取（最快 150ms，导致 paddingBottom 变化）
    let isInInitialWindow = true;
    const initialWindowTimer = setTimeout(() => {
      isInInitialWindow = false;
    }, 600);

    // 同步调一次（对已稳定布局的场景有效）
    scrollToBottom("sync");
    let rafId: number;
    let timeoutId: ReturnType<typeof setTimeout>;
    rafId = requestAnimationFrame(() => {
      scrollToBottom("rAF"); // 等首帧绘制后再试一次
      timeoutId = setTimeout(() => {
        scrollToBottom("350ms"); // 350ms 后最终兜底
      }, 350);
    });

    const mutationObserver = new MutationObserver(() => {
      // TODO-4: 若正在保持滚动位置（加载更多后），跳过自动归底，避免跳到底部
      if (pendingScrollPreserveRef.current) return;
      if (isAtBottomRef.current) {
        scrollToBottom("mutation");
      }
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    // ResizeObserver：监听容器自身高度变化
    // 初始化窗口内无条件归底（覆盖 safeAreas/visualViewport 等异步布局抖动）
    // 初始化窗口结束后，仅在用户处于底部时才自动跟随
    const resizeObserver = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height ?? -1;
      console.log(`[scroll][resize] newH=${Math.round(h)} scrollH=${container.scrollHeight} clientH=${container.clientHeight} isInitWin=${isInInitialWindow} isAtBottom=${isAtBottomRef.current}`);
      // TODO-4: 正在保持滚动位置时跳过归底
      if (pendingScrollPreserveRef.current) return;
      if (isInInitialWindow || isAtBottomRef.current) {
        scrollToBottom("resize-sync");
        requestAnimationFrame(() => {
          scrollToBottom("resize-raf");
          setTimeout(() => {
            scrollToBottom("resize-timeout");
          }, 100);
        });
      }
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(initialWindowTimer);
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [activeSessionId, chatSubTab]);

  return {
    scrollContainerRef,
    handleScroll,
    isAtBottomRef,
    showScrollButton,
    scrollToBottom,
  };
}
