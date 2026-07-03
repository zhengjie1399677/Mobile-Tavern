import React, { useState, useEffect, useRef, useCallback } from "react";
import { useCatbot, CatExpression } from "../hooks/useCatbot";
import { MessageSquare, Send, Trash2, X } from "lucide-react";

// 全局图像去底与缩放缓存，避免多次计算
const processedImageCache: Record<string, string> = {};

const processImageForWeb = (src: string): Promise<string> => {
  if (processedImageCache[src]) {
    return Promise.resolve(processedImageCache[src]);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.src = src;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // 压缩并降维到 128x128 像素，保证极小显存占用与丝滑解码性能
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0, 128, 128);
      const dataUrl = canvas.toDataURL("image/png");
      processedImageCache[src] = dataUrl;
      resolve(dataUrl);
    };
    img.onerror = () => {
      resolve(src);
    };
  });
};

export function FloatingCat() {
  const {
    expression,
    messages,
    bubbleText,
    showBubble,
    isLoading,
    triggerEvent,
    sendMessage,
    clearChatHistory,
    resetExpression,
  } = useCatbot();

  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [position, setPosition] = useState(() => {
    if (typeof window !== "undefined") {
      return { x: window.innerWidth - 16, y: window.innerHeight * 0.6 };
    }
    return { x: 300, y: 400 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isTucked, setIsTucked] = useState(true);

  const handleClose = () => {
    setIsOpen(false);
    resetExpression();
  };
  const [processedImages, setProcessedImages] = useState<Record<CatExpression, string>>({
    idle: "",
    thinking: "",
    relax: "",
    sleepy: "",
    sleep: "",
  });

  const dragStart = useRef({ x: 0, y: 0 });
  const elementStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPressed = useRef(false);

  // 卸载组件时清理长按定时器以防内存泄露
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  // 键盘弹出时隐藏挂件，避免遮挡输入框（CR-09）
  useEffect(() => {
    const vvp = window.visualViewport;
    if (!vvp) return;
    const handleResize = () => {
      const threshold = Math.min(window.innerHeight * 0.15, 100);
      setIsKeyboardOpen(window.innerHeight - vvp.height > threshold);
    };
    vvp.addEventListener("resize", handleResize);
    handleResize();
    return () => vvp.removeEventListener("resize", handleResize);
  }, []);

  // 异步预加载并处理 4 张大表情图
  useEffect(() => {
    const rawPaths: Record<CatExpression, string> = {
      idle: "/assets/cat/idle.png?v=1.4.4",
      thinking: "/assets/cat/thinking.png?v=1.4.4",
      relax: "/assets/cat/relax.png?v=1.4.4",
      sleepy: "/assets/cat/sleepy.png?v=1.4.4",
      sleep: "/assets/cat/sleep.png?v=1.4.4",
    };

    Promise.all(
      Object.entries(rawPaths).map(([key, path]) =>
        processImageForWeb(path).then((url) => [key, url])
      )
    ).then((results) => {
      const newImages = Object.fromEntries(results) as Record<CatExpression, string>;
      setProcessedImages(newImages);
    });
  }, []);

  // 初始化位置至右侧边缘中部，且默认折叠收纳进边框
  useEffect(() => {
    const initialX = window.innerWidth - 16;
    const initialY = window.innerHeight * 0.6;
    setPosition({ x: initialX, y: initialY });
  }, []);

  // 窗口大小变化时重定位（排除仅键盘弹出导致的高度变化，防止对话框抖动）
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      // 宽度未变说明是键盘弹出/收回，跳过 Y 轴重计算
      if (currentWidth !== lastWidth) {
        lastWidth = currentWidth;
        setPosition((prev) => {
          const x = Math.min(prev.x, window.innerWidth - 64);
          const y = Math.min(prev.y, window.innerHeight - 64);
          return { x, y };
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 对话框打开时自动滚动到底部
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, isLoading]);

  // 鼠标 / 触屏拖拽逻辑
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".bubble-click-prevent")) return;
    
    setIsDragging(true);
    hasMoved.current = false;
    isLongPressed.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    elementStart.current = { x: position.x, y: position.y };
    
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // 开启 500ms 长按定时器
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = setTimeout(() => {
      setIsOpen(true);
      isLongPressed.current = true;
      // 轻微震动反馈以提升大拇指侧重交互体验
      if (typeof window !== "undefined" && window.navigator && window.navigator.vibrate) {
        try {
          window.navigator.vibrate(50);
        } catch (err) {}
      }
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasMoved.current = true;
      // 产生拖拽位移后，立即取消长按定时器，以防拖动时误开启问答模式
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
    
    let newX = elementStart.current.x + dx;
    let newY = elementStart.current.y + dy;
    
    newX = Math.max(-40, Math.min(newX, window.innerWidth - 16));
    newY = Math.max(8, Math.min(newY, window.innerHeight - 64));
    
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    
    // 指针释放时清理定时器
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (isLongPressed.current) {
      return;
    }

    const animateToX = (targetX: number) => {
      const duration = 220;
      const startTime = performance.now();
      const startX = position.x;
      
      const animate = (time: number) => {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress * (2 - progress);
        const currentX = startX + (targetX - startX) * ease;
        
        setPosition((prev) => ({ ...prev, x: currentX }));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    };
    
    if (!hasMoved.current) {
      // 没拖动且没达到长按时间，则视为单击
      if (isTucked) {
        setIsTucked(false);
        const targetX = position.x < window.innerWidth / 2 ? 12 : window.innerWidth - 56 - 12;
        animateToX(targetX);
      } else {
        triggerEvent("idle_click");
      }
    } else {
      const middleX = window.innerWidth / 2;
      let targetX = 12;
      let shouldTuck = false;

      if (position.x < middleX) {
        // 左半屏
        if (position.x <= 16) {
          targetX = -40; // 靠最左边，收缩仅露16px
          shouldTuck = true;
        } else {
          targetX = 12;
          shouldTuck = false;
        }
      } else {
        // 右半屏
        if (position.x >= window.innerWidth - 56 - 16) {
          targetX = window.innerWidth - 16; // 靠最右边，收缩仅露16px
          shouldTuck = true;
        } else {
          targetX = window.innerWidth - 56 - 12;
          shouldTuck = false;
        }
      }

      setIsTucked(shouldTuck);
      animateToX(targetX);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isLoading) return;
    
    const textToSend = inputText;
    setInputText("");
    await sendMessage(textToSend);
  };

  const getCatAnimationClass = (expr: CatExpression) => {
    const activeExpr = (isOpen && (expr === "sleepy" || expr === "sleep")) ? "idle" : expr;
    switch (activeExpr) {
      case "thinking":
        return "animate-cat-thinking";
      case "relax":
        return "animate-cat-talking";
      case "sleepy":
        return "animate-cat-sleep";
      case "sleep":
        return "animate-cat-sleep";
      case "idle":
      default:
        return "animate-cat-idle";
    }
  };

  const activeExpression: CatExpression = (isOpen && (expression === "sleepy" || expression === "sleep")) ? "idle" : expression;
  const currentProcessedSrc = processedImages[activeExpression] || processedImages.idle || "";

  // 键盘弹出且挂件面板未打开时，隐藏挂件避免遮挡输入框（CR-09）
  if (isKeyboardOpen && !isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes catFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        @keyframes catThinking {
          0%, 100% { transform: rotate(-3deg) translateY(0); }
          50% { transform: rotate(3deg) translateY(-2px); }
        }
        @keyframes catTalking {
          0%, 100% { transform: scale(1) translateY(0); }
          50% { transform: scale(1.04) translateY(-1px); }
        }
        @keyframes catSad {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-1px) rotate(-1deg); }
          75% { transform: translateX(1px) rotate(1deg); }
        }
        @keyframes catSleep {
          0%, 100% { transform: scale(1) translateY(0); opacity: 0.95; }
          50% { transform: scale(0.97) translateY(1px); opacity: 0.8; }
        }
        
        .animate-cat-idle {
          animation: catFloat 3s ease-in-out infinite;
        }
        .animate-cat-thinking {
          animation: catThinking 2s ease-in-out infinite;
        }
        .animate-cat-talking {
          animation: catTalking 0.85s ease-in-out infinite;
        }
        .animate-cat-sad {
          animation: catSad 0.4s ease-in-out infinite;
        }
        .animate-cat-sleep {
          animation: catSleep 4.5s ease-in-out infinite;
        }
        
        .cat-scroll-hide::-webkit-scrollbar {
          display: none;
        }
        .cat-scroll-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* 1. 悬浮桌宠挂件 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9999,
          touchAction: "none",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        className={`flex items-center justify-center transition-shadow transition-opacity duration-300 select-none ${isTucked ? "opacity-60 hover:opacity-100" : "opacity-100"} ${!isDragging ? getCatAnimationClass(activeExpression) : ""}`}
      >
        {/* 圆形霓虹容器 */}
        <div 
          style={{
            backgroundColor: "var(--card)",
            borderColor: "var(--primary)",
            boxShadow: "0 0 12px color-mix(in oklch, var(--primary) 50%, transparent)",
          }}
          className="w-[56px] h-[56px] rounded-full overflow-hidden border-2 flex items-center justify-center relative"
        >
          {currentProcessedSrc ? (
            <img
              src={currentProcessedSrc}
              alt="Cat mascot"
              className="w-[110%] h-[110%] object-cover pointer-events-none"
            />
          ) : (
            // 未处理完时显示的精致加载微动画
            <div className="w-5 h-5 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* 2. 吐槽气泡 (被动弹出) */}
        {showBubble && bubbleText && !isTucked && (
          <div
            style={{
              position: "absolute",
              bottom: "68px",
              right: position.x > window.innerWidth / 2 ? "0" : "auto",
              left: position.x <= window.innerWidth / 2 ? "0" : "auto",
              width: "180px",
              backgroundColor: "color-mix(in oklch, var(--card) 50%, transparent)",
              border: "1px solid color-mix(in oklch, var(--border) 60%, transparent)",
              color: "var(--foreground)",
            }}
            className="bubble-click-prevent backdrop-blur-[16px] text-xs p-2.5 rounded-xl shadow-lg animate-fade-in pointer-events-none"
          >
            <div className="leading-relaxed font-medium">{bubbleText}</div>
            <div
              style={{
                borderTopColor: "color-mix(in oklch, var(--border) 60%, transparent)",
              }}
              className={`absolute bottom-[-5px] w-0 h-0 border-t-[6px] border-x-[6px] border-x-transparent ${
                position.x > window.innerWidth / 2 ? "right-[20px]" : "left-[20px]"
              }`}
            />
          </div>
        )}
      </div>

      {/* 3. "Tavern Assistant" 会话面板 */}
      {isOpen && (
        <div 
          onClick={handleClose}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9990 }}
          className="bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[420px] sm:h-[600px] bg-[#0c1324dc] sm:rounded-2xl border-t sm:border border-[#3b494b] shadow-[0_4px_30px_rgba(0,0,0,0.5)] flex flex-col backdrop-blur-[16px] overflow-hidden"
            style={{ borderImage: "linear-gradient(to bottom, #3b494b, #00dbe940) 1", height: "85dvh" }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#3b494b] flex items-center justify-between bg-[#151b2dd9]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full overflow-hidden bg-[#0e1626] border border-[#00f0ff] flex items-center justify-center">
                  {processedImages.idle ? (
                    <img
                      src={processedImages.idle}
                      alt="Cat avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-2.5 h-2.5 border border-[#00f0ff] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-[#dbfcff]">雪团助手</h3>
                  <p className="text-[10px] text-[#849495] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14] animate-pulse" />
                    本地系统已就绪
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearChatHistory}
                  title="清空聊天记录"
                  className="p-1.5 rounded-lg text-[#849495] active:text-[#ff5d4e] active:bg-[#23293c] transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-lg text-[#849495] active:text-[#dce1fb] active:bg-[#23293c] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 对话消息流 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 cat-scroll-hide">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-xl relative leading-relaxed text-xs shadow-md border ${
                      msg.role === "user"
                        ? "bg-[#191f3180] text-[#dce1fb] border-[#3b494b] rounded-tr-none border-r-2 border-r-[#ddb7ff]"
                        : "bg-[#0e162680] text-[#dbfcff] border-[#00f0ff40] rounded-tl-none border-l-2 border-l-[#00dbe9]"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-[#0e162680] text-[#dbfcff] border border-[#00f0ff40] rounded-xl rounded-tl-none border-l-2 border-l-[#00dbe9] max-w-[80%] p-3 shadow-md flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#00dbe9] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-[#00dbe9] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-[#00dbe9] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Footer / 输入框 */}
            <form
              onSubmit={handleSend}
              className="p-3 border-t border-[#3b494b] bg-[#151b2d] flex items-center gap-2"
            >
              <input
                type="text"
                inputMode="text"
                enterKeyHint="send"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                maxLength={200}
                placeholder="向雪团助手提问 (最多200字)..."
                disabled={isLoading}
                className="flex-1 h-10 px-4 rounded-full bg-[#070d1f] border border-[#3b494b] focus:border-[#00dbe9] focus:outline-none text-xs text-[#dce1fb] placeholder-[#849495] focus:shadow-[0_0_8px_rgba(0,240,255,0.2)] disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="h-10 w-10 rounded-full bg-[#00dbe9] active:bg-[#00f0ff] active:scale-95 text-[#00363a] flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-[0_0_8px_rgba(0,240,255,0.25)]"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            {/* 适配全面屏的物理安全区保底占位块，键盘弹起时会自动压缩，且背景为固体深色物尽其用 */}
            <div className="h-[env(safe-area-inset-bottom)] bg-[#151b2d] shrink-0" />
          </div>
        </div>
      )}
    </>
  );
}
