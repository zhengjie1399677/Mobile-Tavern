// 滚动引擎 Hook
// 从原 ChatTab.tsx L628-720 抽离
// 管理 MutationObserver / ResizeObserver / 归底逻辑

import React from "react";

interface UseChatScrollDeps {
  activeSessionId: string | null;
  chatSubTab: string;
}

export function useChatScroll(deps: UseChatScrollDeps) {
  const { activeSessionId, chatSubTab } = deps;

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef<boolean>(true);
  const [showScrollButton, setShowScrollButton] = React.useState(false);

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
