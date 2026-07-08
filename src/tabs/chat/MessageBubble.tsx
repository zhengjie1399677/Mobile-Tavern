// 单条消息气泡（思维链 + 主对白 + 时间戳）
// 从原 ChatTab.tsx L1275-1618 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收消息相关数据与本地状态作为 props

import React from "react";
import {
  Check,
  X,
  Brain,
  Clock,
  Cpu,
  Copy,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import TypingIndicator from "./TypingIndicator";
import QuickDialogueOptions from "./QuickDialogueOptions";
import CloudLoader from "../../components/CloudLoader";

interface MessageBubbleProps {
  message: any;
  idx: number;
  foldedCount: number;
  roundNum: number;
  activePortraitUrl: string;
  expandedReasoningIds: Record<string, boolean>;
  setExpandedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedReasoningIds: Record<string, boolean>;
  setCopiedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  messagesToRenderLength: number;
}

const MessageBubble = ({
  message,
  idx,
  foldedCount,
  roundNum,
  activePortraitUrl,
  expandedReasoningIds,
  setExpandedReasoningIds,
  copiedReasoningIds,
  setCopiedReasoningIds,
  messagesToRenderLength,
}: MessageBubbleProps): React.JSX.Element => {
  const {
    activeCharacter,
    settings,
    isSending,
    editingMsgId,
    setEditingMsgId,
    editingMsgContent,
    setEditingMsgContent,
    msgMenuId,
    setMsgMenuId,
    renderDialogueBubble,
    saveSessionWithMvu,
    setSessions,
    activeSession,
    showCustomAlert,
    showCustomConfirm,
  } = useUnifiedApp();

  const isUser = message.sender === "user";

  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const isScrollingOrMoving = React.useRef(false);
  const hasTriggeredMenuThisTurn = React.useRef(false);

  const [dragOffset, setDragOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const hasVibratedRef = React.useRef(false);

  // 记录滑动位置的 Refs
  const touchStartXRef = React.useRef<number>(0);
  const touchStartYRef = React.useRef<number>(0);
  const touchEndXRef = React.useRef<number>(0);
  const touchEndYRef = React.useRef<number>(0);

  const startLongPress = React.useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if ("button" in e && e.button !== 0) return;
    isScrollingOrMoving.current = false;
    hasTriggeredMenuThisTurn.current = false;
    hasVibratedRef.current = false;

    // 记录初始触摸坐标
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ("clientX" in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    touchStartXRef.current = clientX;
    touchStartYRef.current = clientY;
    touchEndXRef.current = clientX;
    touchEndYRef.current = clientY;
    setIsDragging(true);

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = setTimeout(() => {
      if (!isScrollingOrMoving.current && editingMsgId !== message.id) {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(35);
          } catch (_) {}
        }
        setMsgMenuId(msgMenuId === message.id ? null : message.id);
        hasTriggeredMenuThisTurn.current = true;
      }
      longPressTimer.current = null;
    }, 300);
  }, [editingMsgId, message.id, msgMenuId, setMsgMenuId]);

  const cancelLongPress = React.useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const moveTouch = React.useCallback((e: React.TouchEvent | React.MouseEvent) => {
    isScrollingOrMoving.current = true;
    cancelLongPress();

    // 更新当前触摸坐标
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ("clientX" in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    touchEndXRef.current = clientX;
    touchEndYRef.current = clientY;

    if (touchStartXRef.current !== 0) {
      const diffX = touchStartXRef.current - clientX;
      const diffY = Math.abs(touchStartYRef.current - clientY);

      // 横向滑动主导时触发位移，防纵向页面滚动抖动
      if (diffX > 0 && diffY < 30) {
        let offset = diffX;
        // 阈值后添加弹性阻尼系数
        if (offset > 60) {
          offset = 60 + (offset - 60) * 0.4;
        }
        setDragOffset(offset);

        // 越过 60px 阈值瞬间震动反馈一次
        if (offset >= 60 && !hasVibratedRef.current) {
          hasVibratedRef.current = true;
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try {
              navigator.vibrate(15);
            } catch (_) {}
          }
        }
      } else {
        setDragOffset(0);
      }
    }
  }, [cancelLongPress]);

  const endTouch = React.useCallback(() => {
    cancelLongPress();
    setIsDragging(false);

    const diffX = touchStartXRef.current - touchEndXRef.current;
    const diffY = Math.abs(touchStartYRef.current - touchEndYRef.current);

    // 水平向左滑动触发菜单：位移超过 60px，且垂直偏离小于 35px
    if (diffX > 60 && diffY < 35 && editingMsgId !== message.id) {
      if (!hasVibratedRef.current && typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch (_) {}
      }
      setMsgMenuId(message.id);
      hasTriggeredMenuThisTurn.current = true;
    }
    // 水平向右滑动：预留给其它未来功能，目前静默记录日志
    else if (diffX < -60 && diffY < 35) {
      console.log("[Swipe Action] Swipe Right gesture detected (reserved for future use)");
    }

    setDragOffset(0);
    touchStartXRef.current = 0;
  }, [cancelLongPress, editingMsgId, message.id, setMsgMenuId]);

  return (
    <div
      key={message.id}
      role="article"
      aria-label={`${isUser ? "我说" : (activeCharacter?.name || "角色") + "说"}：${message.content}`}
      className={`flex items-start gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        aria-hidden="true"
        className={`w-8 h-8 rounded-[11px] bg-gradient-to-br flex items-center justify-center font-bold text-xs shadow-sm border flex-shrink-0 overflow-hidden ${
          isUser
            ? "from-secondary to-muted border-border text-foreground transition-colors duration-300"
            : "from-card to-muted border-border text-foreground font-serif transition-colors duration-300"
        }`}
      >
        {isUser ? (
          settings.userAvatar ? (
            <img
              src={settings.userAvatar}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            "我"
          )
        ) : (activePortraitUrl || activeCharacter?.avatar) ? (
          <img
            src={activePortraitUrl || activeCharacter.avatar}
            alt=""
            className="w-full h-full object-cover animate-fadeIn"
          />
        ) : (
          activeCharacter?.name?.[0] || "AI"
        )}
      </div>

      {/* Speech Bubble */}
      <div
        className="max-w-[78%] group relative select-none"
        onTouchStart={startLongPress}
        onTouchMove={moveTouch}
        onTouchEnd={endTouch}
        onMouseDown={startLongPress}
        onMouseMove={moveTouch}
        onMouseUp={endTouch}
        onMouseLeave={endTouch}
        onClick={(e) => {
          e.stopPropagation();
          if (hasTriggeredMenuThisTurn.current) {
            hasTriggeredMenuThisTurn.current = false;
            return;
          }
          if (msgMenuId === message.id) {
            setMsgMenuId(null);
          }
        }}
      >
        {/* 滑动指示器 (Swipe Indicator) */}
        {editingMsgId !== message.id && dragOffset > 0 && (
          <div
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-0"
            style={{
              opacity: Math.min(1, dragOffset / 60),
              transform: `translateY(-50%) scale(${dragOffset >= 60 ? 1.15 : 0.85 + (dragOffset / 60) * 0.15})`,
              transition: isDragging ? "none" : "transform 0.2s ease, opacity 0.2s ease",
            }}
          >
            <div
              className={`w-7.5 h-7.5 rounded-full flex items-center justify-center border shadow-sm transition-colors ${
                dragOffset >= 60
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </div>
          </div>
        )}

        {editingMsgId === message.id ? (
          <div
            className={`rounded-xl p-3 shadow-sm text-sm border transition-all ${
              isUser
                ? "bg-primary/10 border-primary/50"
                : "bg-input border-border"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              value={editingMsgContent}
              onChange={(e) =>
                setEditingMsgContent(e.target.value)
              }
              className="w-full text-sm bg-muted border border-border rounded-lg p-2.5 text-foreground outline-none leading-relaxed resize-y font-light mb-2 focus:border-primary/50"
              style={{
                fontSize: settings.chatFontSize ? `${settings.chatFontSize}px` : undefined,
                lineHeight: settings.chatLineHeight ? `${settings.chatLineHeight}` : undefined,
              }}
              rows={Math.max(
                3,
                editingMsgContent.split("\n").length,
              )}
              autoFocus
              onFocus={(e) => {
                setTimeout(() => {
                  e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }, 300);
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!activeSession) return;
                  const nextMsgs = (activeSession.messages || []).map(
                    (m: any) =>
                      m.id === message.id
                        ? { ...m, content: editingMsgContent }
                        : m,
                  );
                  const updated = {
                    ...activeSession,
                    messages: nextMsgs,
                  };
                  setSessions((prev: any) =>
                    prev.map((s: any) =>
                      s.id === updated.id ? updated : s,
                    ),
                  );
                  await saveSessionWithMvu(updated, editingMsgContent);
                  setEditingMsgId(null);
                }}
                disabled={isSending}
                className="bg-emerald-600 hover:bg-emerald-500 text-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" /> 保存
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingMsgId(null);
                }}
                disabled={isSending}
                className="bg-muted active:scale-[0.98] text-muted-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 border border-border shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" /> 取消
              </button>
            </div>
          </div>
        ) : (
          <div
            className="w-full relative z-10"
            style={{
              transform: dragOffset > 0 ? `translateX(-${dragOffset}px)` : undefined,
              transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)",
            }}
          >
            <div className="space-y-1 max-w-full">
              {/* 思维链渲染模块 */}
              {!isUser && message.reasoningContent && settings.enableReasoningContentDisplay !== false && (
                <div className="mb-2 text-xs max-w-sm">
                  <div
                    onClick={() => {
                      setExpandedReasoningIds((prev) => ({
                        ...prev,
                        [message.id]: !prev[message.id],
                      }));
                    }}
                    className="bg-muted/40 hover:bg-muted/60 border-border/30 text-muted-foreground cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-semibold select-none transition-all active:scale-95 w-fit"
                  >
                    <Brain className={`w-3.5 h-3.5 ${isSending && idx === messagesToRenderLength - 1 ? "animate-pulse text-primary" : "opacity-75"}`} />
                    <span>
                      {expandedReasoningIds[message.id]
                        ? "收起思考过程"
                        : isSending && idx === messagesToRenderLength - 1
                        ? "AI 正在思考中 (点击查看)..."
                        : "查看思考过程"}
                    </span>
                    {!isSending && message.reasoningContent && (
                      <span className="text-muted-foreground/60 font-normal">
                        · {message.reasoningContent.length}字
                      </span>
                    )}
                    <ChevronDown
                      className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${
                        expandedReasoningIds[message.id] ? "rotate-180" : ""
                      }`}
                    />
                  </div>

                  {expandedReasoningIds[message.id] && (
                    <div className="mt-1.5 relative">
                      <div className="p-3 pr-8 rounded-xl glass-panel border border-border/20 text-muted-foreground font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar animate-in fade-in duration-300">
                        {message.reasoningContent}
                        {isSending && idx === messagesToRenderLength - 1 && (
                          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary/70 animate-pulse" />
                        )}
                      </div>
                      {!isSending && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const textToCopy = message.reasoningContent || "";
                            if (navigator.clipboard?.writeText) {
                              navigator.clipboard.writeText(textToCopy);
                            }
                            setCopiedReasoningIds((prev) => ({ ...prev, [message.id]: true }));
                            setTimeout(() => {
                              setCopiedReasoningIds((prev) => ({ ...prev, [message.id]: false }));
                            }, 1500);
                          }}
                          className="absolute top-1.5 right-1.5 p-1 rounded-md hover:bg-muted/80 text-muted-foreground/60 hover:text-foreground transition-colors"
                          title="复制思维链内容"
                        >
                          {copiedReasoningIds[message.id] ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 主对白内容气泡：当仅有思维链且正文还在准备时，或者在非生成状态下正文彻底为空且存在思考过程时，暂不显示空气泡 */}
              {!(message.content === "💭..." && message.reasoningContent) &&
               !(!isSending && !message.content?.trim() && message.reasoningContent) && (
                <div
                  className={`px-3.5 py-2.5 shadow-sm text-sm border font-light tracking-wide transition-all cursor-pointer relative overflow-hidden ${
                    isUser
                      ? activeCharacter?.visualSettings?.userBubbleColor
                        ? "border-transparent bubble-user"
                        : "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground border-primary/40 bubble-user hover:from-primary/95 hover:to-primary/80"
                      : activeCharacter?.visualSettings?.bubbleColor
                        ? "border-transparent bubble-ai pl-4"
                        : "glass-panel text-foreground shadow-sm bubble-ai pl-4 border-l-4 border-l-primary"
                  }`}
                  style={{
                    backgroundColor: isUser
                      ? activeCharacter?.visualSettings?.userBubbleColor || undefined
                      : activeCharacter?.visualSettings?.bubbleColor || undefined,
                    color: isUser
                      ? activeCharacter?.visualSettings?.userBubbleTextColor || undefined
                      : activeCharacter?.visualSettings?.bubbleTextColor || undefined,
                    fontSize: settings.chatFontSize ? `${settings.chatFontSize}px` : undefined,
                    lineHeight: settings.chatLineHeight ? `${settings.chatLineHeight}` : undefined,
                  }}
                >
                  {message.content === "💭..." ? (
                    <div className="flex items-center gap-2.5 py-0.5 select-none animate-pulse">
                      <CloudLoader size={26} />
                      <span className="text-xs text-muted-foreground/80 font-light">AI 正在斟酌字句...</span>
                    </div>
                  ) : !message.content?.trim() ? (
                    <span className="text-xs text-muted-foreground/60 italic select-none">*(未生成任何内容)*</span>
                  ) : (
                    renderDialogueBubble(message.content, foldedCount + idx)
                  )}
                </div>
              )}

              {/* Generated Image & Drawing Loader */}
              {message.extra?.isDrawing && (
                <div className="mt-2 p-3 bg-muted/40 border border-dashed border-border rounded-xl flex items-center justify-center gap-2.5 text-xs text-muted-foreground animate-pulse">
                  <CloudLoader size={30} />
                  <span>AI 正在为您绘制场景中...</span>
                </div>
              )}

              {message.extra?.image && (
                <div className="mt-2 rounded-xl overflow-hidden border border-border/80 bg-muted/30 shadow-md max-w-full group/image relative select-none">
                  <img
                    src={message.extra.image}
                    alt="Generated Scene"
                    className="w-full object-cover max-h-60 cursor-pointer hover:opacity-95 transition-opacity"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await showCustomConfirm("是否保存此生成的图片？");
                      if (!ok) return;

                      const filename = `draw_${Date.now()}.png`;
                      if ((window as any).AndroidThemeBridge) {
                        try {
                          let path = null;
                          const isDataUrl = message.extra.image.startsWith("data:");
                          if (isDataUrl && typeof (window as any).AndroidThemeBridge.saveFileBase64 === "function") {
                            const commaIdx = message.extra.image.indexOf(",");
                            const mimeType = message.extra.image.slice(5, commaIdx).split(";")[0] || "image/png";
                            const base64Data = message.extra.image.slice(commaIdx + 1);
                            path = (window as any).AndroidThemeBridge.saveFileBase64(filename, base64Data, mimeType);
                          } else if (typeof (window as any).AndroidThemeBridge.saveFile === "function") {
                            path = (window as any).AndroidThemeBridge.saveFile(filename, message.extra.image);
                          }

                          if (path && !path.startsWith("error:")) {
                            await showCustomAlert(`📂 图片保存成功！\n文件已保存至手机 /Download 文件夹下，绝对路径为：\n${path}`, "保存成功");
                          } else {
                            await showCustomAlert(`❌ 图片保存失败：${path || "未知错误"}`, "保存失败");
                          }
                          return;
                        } catch (err: any) {
                          console.error("AndroidThemeBridge download failed:", err);
                          await showCustomAlert(`❌ 保存出错: ${err.message || String(err)}`, "保存失败");
                        }
                      }

                      const link = document.createElement("a");
                      link.href = message.extra.image;
                      link.download = filename;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      await showCustomAlert(`图片已成功导出！\n文件已触发浏览器或客户端下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${filename}`, "导出成功");
                    }}
                  />
                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[8px] font-mono pointer-events-none opacity-0 group-hover/image:opacity-100 transition-opacity">
                    点击保存图片
                  </div>
                </div>
              )}
            </div>

            {/* Bubble timestamp */}
            <div
              className={`text-[10px] text-muted-foreground font-mono mt-1 ${isUser ? "text-right" : "text-left"} flex gap-2 ${isUser ? "justify-end" : "justify-start"} flex-wrap`}
            >
              {roundNum > 0 && (
                <span className="flex items-center gap-1 opacity-70 text-primary font-medium">
                  第 {roundNum} 轮对话
                </span>
              )}
              <span className={roundNum > 0 ? "border-l border-border pl-2" : ""}>
                {new Date(message.timestamp).toLocaleTimeString(
                  undefined,
                  { hour: "2-digit", minute: "2-digit" },
                )}
              </span>
              {message.generationTime !== undefined && (
                <span className="flex items-center gap-1 opacity-70 border-l border-border pl-2">
                  <Clock className="w-2.5 h-2.5" />
                  {message.generationTime.toFixed(1)}s
                </span>
              )}
              {message.tokenCount !== undefined &&
                message.tokenCount > 0 && (
                  <span
                    className="flex items-center gap-1 opacity-70 border-l border-border pl-2"
                    title={`提示词Tokens: ${message.promptTokenCount || 0}`}
                  >
                    <Cpu className="w-2.5 h-2.5" />
                    {message.tokenCount} Token
                  </span>
                )}
            </div>
          </div>
        )}

        {/* Quick Dialogue Options popup banner */}
        {msgMenuId === message.id && (
          <QuickDialogueOptions message={message} isUser={isUser} />
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
