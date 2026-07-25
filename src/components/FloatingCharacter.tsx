// 应用内悬浮角色助手
//
// 与现有 FloatingCat（雪团助手，独立本地 AI）并存，但定位不同：
//   - FloatingCat：独立 AI 助手，有自己的表情和对话系统
//   - FloatingCharacter：当前角色卡的"桌面宠物"模式，共用 CharacterRenderService
//     显示当前角色立绘 + 情绪徽章 + 最近 assistant 消息气泡
//
// 交互：
//   - 单击：跳转到聊天 Tab
//   - 长按 500ms：展开角色快捷操作菜单（切换表情、跳转角色卡）
//   - 拖拽：自由移动 + 边缘吸附
//
// 显示条件：有活跃角色且 CharacterRenderService 有 portraitBase64 时才显示。

import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquare, X, ChevronRight } from "lucide-react";

import { useUnifiedApp } from "../UnifiedAppContext";
import { useKernel } from "../contexts/KernelContext";
import { globalKernel } from "../kernel";

interface RenderStateSnapshot {
  portraitBase64: string;
  emotion: string;
  glowColors: { light1: string; light2: string };
}

interface FloatingCharacterProps {
  /** 是否启用（受设置控制，默认 false 避免与 FloatingCat 冲突）。 */
  enabled: boolean;
}

/**
 * 应用内悬浮角色助手。
 *
 * @param enabled 是否启用，由设置面板控制。未启用时返回 null。
 */
export function FloatingCharacter({ enabled }: FloatingCharacterProps) {
  const kernel = useKernel();
  const { activeCharacter, activeSession, setActiveTab } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    setActiveTab: state.setActiveTab,
  }));

  const [renderState, setRenderState] = useState<RenderStateSnapshot | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // 拖拽状态
  const [position, setPosition] = useState(() => {
    if (typeof window !== "undefined") {
      return { x: 16, y: window.innerHeight * 0.5 };
    }
    return { x: 16, y: 400 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isTucked, setIsTucked] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const elementStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressed = useRef(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 订阅 CharacterRenderService
  useEffect(() => {
    if (!enabled) {
      setRenderState(null);
      return;
    }
    let unsubscribe: (() => void) | null = null;
    try {
      const service = kernel.getService<any>("characterRender");
      if (service && typeof service.subscribe === "function") {
        unsubscribe = service.subscribe((state: RenderStateSnapshot) => {
          setRenderState(state);
        });
      }
    } catch {
      // 服务未注册时静默
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [enabled, kernel]);

  // 最近一条 assistant 消息（作为聊天气泡）
  const lastAssistantText = React.useMemo(() => {
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.sender === "assistant" && msg.content) {
        const text = String(msg.content).trim();
        return text.length > 120 ? text.slice(0, 120) + "…" : text;
      }
    }
    return "";
  }, [activeSession]);

  // 新消息到达时显示气泡，8 秒后自动隐藏
  useEffect(() => {
    if (!enabled || !lastAssistantText) return;
    setBubbleVisible(true);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubbleVisible(false), 8000);
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    };
  }, [lastAssistantText, enabled]);

  // 窗口大小变化时重定位
  useEffect(() => {
    if (!enabled) return;
    let lastWidth = window.innerWidth;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
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
  }, [enabled]);

  // 清理长按定时器
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // 拖拽 + 长按逻辑
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".fc-no-drag")) return;
    setIsDragging(true);
    hasMoved.current = false;
    isLongPressed.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    elementStart.current = { x: position.x, y: position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setMenuOpen(true);
      isLongPressed.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(50); } catch { /* ignore */ }
      }
    }, 500);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasMoved.current = true;
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
  }, [isDragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (isLongPressed.current) return;

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
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    };

    if (!hasMoved.current) {
      // 单击：跳转到聊天 Tab
      setActiveTab("chat");
    } else {
      // 拖拽结束：边缘吸附
      const middleX = window.innerWidth / 2;
      let targetX = 12;
      let shouldTuck = false;
      if (position.x < middleX) {
        if (position.x <= 16) {
          targetX = -40;
          shouldTuck = true;
        } else {
          targetX = 12;
        }
      } else {
        if (position.x >= window.innerWidth - 56 - 16) {
          targetX = window.innerWidth - 16;
          shouldTuck = true;
        } else {
          targetX = window.innerWidth - 56 - 12;
        }
      }
      setIsTucked(shouldTuck);
      animateToX(targetX);
    }
  }, [isDragging, position, setActiveTab]);

  // 未启用或无角色立绘时不渲染
  if (!enabled || !activeCharacter || !renderState?.portraitBase64) return null;

  return (
    <>
      <style>{`
        @keyframes fcFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        .fc-animate-idle { animation: fcFloat 3s ease-in-out infinite; }
      `}</style>

      {/* 悬浮角色立绘 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9998,
          touchAction: "none",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        className={`flex items-center justify-center transition-opacity duration-300 select-none ${
          isTucked ? "opacity-60 hover:opacity-100" : "opacity-100"
        } ${!isDragging ? "fc-animate-idle" : ""}`}
      >
        {/* 圆形立绘容器 */}
        <div
          style={{
            backgroundColor: "var(--card)",
            borderColor: "var(--primary)",
            boxShadow: `0 0 12px color-mix(in oklch, var(--primary) 50%, transparent)`,
          }}
          className="w-[56px] h-[56px] rounded-full overflow-hidden border-2 flex items-center justify-center relative"
        >
          <img
            src={renderState.portraitBase64}
            alt={activeCharacter.name || "Character"}
            className="w-full h-full object-cover pointer-events-none"
          />
          {/* 情绪徽章 */}
          <div className="absolute bottom-0.5 right-0.5 bg-background/80 backdrop-blur-sm border border-border text-[8px] font-bold px-1 py-0.5 rounded-sm shadow-sm max-w-[48px] truncate">
            {renderState.emotion}
          </div>
        </div>

        {/* 聊天气泡 */}
        {bubbleVisible && lastAssistantText && !isTucked && (
          <div
            className="fc-no-drag absolute bottom-[68px] w-[200px] bg-card/80 backdrop-blur-md border border-border rounded-xl shadow-lg p-2.5 text-xs text-foreground pointer-events-none animate-fade-in"
            style={{
              right: position.x > window.innerWidth / 2 ? "0" : "auto",
              left: position.x <= window.innerWidth / 2 ? "0" : "auto",
            }}
          >
            <div className="flex items-start gap-1.5">
              <div className="flex-1 leading-relaxed font-medium max-h-[80px] overflow-hidden">
                {lastAssistantText}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setBubbleVisible(false);
                }}
                className="fc-no-drag shrink-0 text-muted-foreground hover:text-foreground pointer-events-auto"
                aria-label="关闭气泡"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {/* 尾尖 */}
            <div
              className={`absolute bottom-[-5px] w-0 h-0 border-t-[6px] border-x-[6px] border-x-transparent ${
                position.x > window.innerWidth / 2 ? "right-[20px]" : "left-[20px]"
              }`}
              style={{ borderTopColor: "var(--card)" }}
            />
          </div>
        )}
      </div>

      {/* 长按菜单 */}
      {menuOpen && (
        <div
          className="fc-no-drag fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9997 }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="fc-no-drag w-full max-w-[280px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 角色信息头 */}
            <div className="p-3 border-b border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border border-border">
                <img
                  src={renderState.portraitBase64}
                  alt={activeCharacter.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">
                  {activeCharacter.name || "未命名角色"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  当前情绪：{renderState.emotion}
                </p>
              </div>
            </div>
            {/* 菜单项 */}
            <button
              onClick={() => {
                setActiveTab("chat");
                setMenuOpen(false);
              }}
              className="w-full px-4 py-3 flex items-center justify-between text-sm text-foreground hover:bg-muted/50 transition"
            >
              <span className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                继续对话
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                setActiveTab("characters");
                setMenuOpen(false);
              }}
              className="w-full px-4 py-3 flex items-center justify-between text-sm text-foreground hover:bg-muted/50 transition border-t border-border"
            >
              <span className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 rotate-45" />
                切换角色
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              className="w-full px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition border-t border-border"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}
