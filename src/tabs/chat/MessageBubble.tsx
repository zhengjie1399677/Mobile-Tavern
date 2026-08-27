// 单条消息气泡（思维链 + 主对白 + 时间戳）
// 从原 ChatTab.tsx L1275-1618 抽离
// 通过 selector 订阅所需上下文字段，接收消息相关数据与本地状态作为 props

import React from "react";
import {
  Check,
  X,
  Edit2,
  Palette,
  Volume2,
  VolumeX,
} from "lucide-react";

import { useUnifiedApp, unifiedAppStore } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { filterAsteriskActions } from "../../components/formattedTextUtils";
import { handleGenerateImageForMessage } from "./imageGenerationHandler";
import TypingIndicator from "./TypingIndicator";
import QuickDialogueOptions from "./QuickDialogueOptions";
import CloudLoader from "../../components/CloudLoader";
import type { Message } from "../../types";
import { ITtsService } from "@/src/application/serviceContracts";
import { MessageAvatar } from "./message-bubble/MessageAvatar";
import { ReasoningBlock } from "./message-bubble/ReasoningBlock";
import { GeneratedImageBlock } from "./message-bubble/GeneratedImageBlock";
import { MessageTimestamp } from "./message-bubble/MessageTimestamp";
import { MessageAttachmentParts } from "./message-bubble/MessageAttachmentParts";
import { ToolCallBlock } from "./message-bubble/ToolCallBlock";

interface MessageBubbleProps {
  message: Message;
  idx: number;
  roundNum: number;
  activePortraitUrl: string;
  expandedReasoningIds: Record<string, boolean>;
  setExpandedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedReasoningIds: Record<string, boolean>;
  setCopiedReasoningIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isStreamingThisMsg: boolean;
  swipedMsgId: string | null;
  setSwipedMsgId: (id: string | null) => void;
}

const MessageBubble = ({
  message,
  idx,
  roundNum,
  activePortraitUrl,
  expandedReasoningIds,
  setExpandedReasoningIds,
  copiedReasoningIds,
  setCopiedReasoningIds,
  isStreamingThisMsg,
  swipedMsgId,
  setSwipedMsgId,
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
    setSessionViews,
    showCustomAlert,
    showCustomConfirm,
    getKernelService,
    showCustomPrompt,
  } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    settings: state.settings,
    isSending: state.isSending,
    editingMsgId: state.editingMsgId,
    setEditingMsgId: state.setEditingMsgId,
    editingMsgContent: state.editingMsgContent,
    setEditingMsgContent: state.setEditingMsgContent,
    msgMenuId: state.msgMenuId,
    setMsgMenuId: state.setMsgMenuId,
    renderDialogueBubble: state.renderDialogueBubble,
    saveSessionWithMvu: state.saveSessionWithMvu,
    setSessionViews: state.setSessionViews,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    getKernelService: state.getKernelService,
    showCustomPrompt: state.showCustomPrompt,
  }));

  const { t } = useTranslation();

  const isUser = message.sender === "user";
  const hasAttachmentParts = message.parts?.some(part => part.type !== "text") === true;

  // isStreamingThisMsg 由父组件 DialogueHistoryView 预计算后传入，
  // 判断逻辑由上层 Compatibility Host 生成状态优先，并以 React isSending 兜底末位消息。
  // 统一收敛到父组件，避免每条消息都订阅 isSending 和 messagesToRenderLength。
  // 此处直接使用 prop 值，无需重复计算。

  // --- 修复1：所有 Refs 必须先于任何 useEffect 声明 ---
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const isScrollingOrMoving = React.useRef(false);
  const hasTriggeredMenuThisTurn = React.useRef(false);
  const hasVibratedRef = React.useRef(false);
  const isDraggingRef = React.useRef(false);
  const touchStartXRef = React.useRef<number>(0);
  const touchStartYRef = React.useRef<number>(0);
  const touchEndXRef = React.useRef<number>(0);
  const touchEndYRef = React.useRef<number>(0);
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const bubbleTextRef = React.useRef<HTMLDivElement>(null);
  const swipeMenuRef = React.useRef<HTMLDivElement>(null);
  const dragOffsetRef = React.useRef(0);
  const swipeLockedRef = React.useRef<'none' | 'swipe' | 'scroll'>('none');

  const isOpen = swipedMsgId === message.id;
  const [dragOffset, setDragOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isSpeakingThis, setIsSpeakingThis] = React.useState(false);

  const dragDirection = isUser ? 1 : -1;
  const SWIPE_MENU_WIDTH = 46;

  // 侧滑面板中三个按钮的相关可用性
  const showDraw = settings?.imageGenApi?.enabled && !isUser;
  const showTts = settings?.ttsConfig?.enabled;
  const buttonsCount = 1 + (showDraw ? 1 : 0) + (showTts ? 1 : 0);
  const swipeMenuHeight = buttonsCount * 32 + (buttonsCount - 1) * 6;

  // --- 修复4/5：提取共享 DOM 归位工具，显式写入 display，杜绝单帧裸奔 ---
  const forceResetDomStyles = React.useCallback((targetOffset: number) => {
    if (bubbleTextRef.current) {
      bubbleTextRef.current.style.transform = targetOffset > 0
        ? `translateX(${-targetOffset * dragDirection}px)`
        : '';
      bubbleTextRef.current.style.transition = '';
    }
    if (swipeMenuRef.current) {
      swipeMenuRef.current.style.display = targetOffset > 0 ? 'flex' : 'none';
      swipeMenuRef.current.style.opacity = '';
      swipeMenuRef.current.style.transform = '';
      swipeMenuRef.current.style.transition = '';
      swipeMenuRef.current.style.pointerEvents = '';
    }
  }, [dragDirection]);

  // 当其他消息被滑动展开或选中关闭时，自动将本条消息重置并收回（修复1：Refs 已先行声明）
  React.useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      dragOffsetRef.current = 0;
      forceResetDomStyles(0);
    }
  }, [isOpen, forceResetDomStyles]);

  // 轮询检测 TTS 状态：仅当本条消息正在朗读时才启动轮询，检测到停止后自动清理
  // 同一时刻最多只有 1 个定时器在运行，避免消息多时 N 个定时器同时轮询
  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const checkSpeaking = () => {
      const ttsService = getKernelService<ITtsService>("tts");
      if (!ttsService || !active) return;
      const speakingId = ttsService.getSpeakingMessageId();
      const speaking = ttsService.isSpeaking() && speakingId === message.id;
      if (active) {
        setIsSpeakingThis(speaking);
        if (!speaking && timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    };

    // 挂载时同步一次状态（恢复朗读指示）
    checkSpeaking();

    // 仅当本条消息正在朗读时才启动轮询
    if (isSpeakingThis) {
      timer = setInterval(checkSpeaking, 1000);
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [message.id, getKernelService, isSpeakingThis]);

  // 点击外部自动收起侧滑菜单
  React.useEffect(() => {
    if (!isOpen) return;
    const handleGlobalClick = (e: MouseEvent) => {
      if (bubbleRef.current && bubbleRef.current.contains(e.target as Node)) {
        return;
      }
      setSwipedMsgId(null);
      setDragOffset(0);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
    };
  }, [isOpen, setSwipedMsgId]);

  const startLongPress = React.useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if ("button" in e && e.button !== 0) return;
    isScrollingOrMoving.current = false;
    hasTriggeredMenuThisTurn.current = false;
    hasVibratedRef.current = false;
    swipeLockedRef.current = 'none';

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
    isDraggingRef.current = true;
    setIsDragging(true); // 仍需触发 CSS transition 切换，但后续可进一步优化

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
      const rawDiffX = touchStartXRef.current - clientX;
      const diffX = rawDiffX * dragDirection;
      const diffY = Math.abs(touchStartYRef.current - clientY);
      const absDiffX = Math.abs(rawDiffX);

      // 手势识别方向锁逻辑
      if (swipeLockedRef.current === 'none') {
        if (diffY > 8 && diffY > absDiffX) {
          swipeLockedRef.current = 'scroll';
        } else if (absDiffX > 8 && absDiffX > diffY) {
          swipeLockedRef.current = 'swipe';
        }
      }

      // 如果已经锁定为滚动，直接退出
      if (swipeLockedRef.current === 'scroll') {
        return;
      }

      // 如果尚未决定，不处理滑动效果
      if (swipeLockedRef.current === 'none') {
        return;
      }

      // 修复3：垂直滚动超阈值时，如果已经有 DOM 残留（拖了一小段又往上滑），立即清理
      if (diffY > 35) {
        if (dragOffsetRef.current > 0 && !isOpen) {
          dragOffsetRef.current = 0;
          if (bubbleTextRef.current) {
            bubbleTextRef.current.style.transform = '';
            bubbleTextRef.current.style.transition = '';
          }
          if (swipeMenuRef.current) {
            swipeMenuRef.current.style.display = 'none';
            swipeMenuRef.current.style.opacity = '';
            swipeMenuRef.current.style.transform = '';
            swipeMenuRef.current.style.transition = '';
            swipeMenuRef.current.style.pointerEvents = '';
          }
        }
        return;
      }

      // 往中心滑动（展开菜单）
      if (diffX > 0 && diffY < 30) {
        let offset = isOpen ? SWIPE_MENU_WIDTH + diffX : diffX;
        if (offset < 0) offset = 0;

        // 阻尼系数
        if (offset > SWIPE_MENU_WIDTH) {
          offset = SWIPE_MENU_WIDTH + (offset - SWIPE_MENU_WIDTH) * 0.4;
        }

        // 性能优化：直接操作 DOM 节点 style，避免 React 120Hz State 频繁更新卡顿
        if (bubbleTextRef.current) {
          bubbleTextRef.current.style.transform = `translateX(${-offset * dragDirection}px)`;
          bubbleTextRef.current.style.transition = 'none';
        }
        if (swipeMenuRef.current) {
          swipeMenuRef.current.style.display = 'flex';
          swipeMenuRef.current.style.opacity = String(Math.min(1, offset / SWIPE_MENU_WIDTH));
          swipeMenuRef.current.style.transform = `scale(${0.9 + (Math.min(SWIPE_MENU_WIDTH, offset) / SWIPE_MENU_WIDTH) * 0.1})`;
          swipeMenuRef.current.style.transition = 'none';
          swipeMenuRef.current.style.pointerEvents = 'auto';
        }
        dragOffsetRef.current = offset;

        // 震动反馈
        if (offset >= SWIPE_MENU_WIDTH && !hasVibratedRef.current) {
          hasVibratedRef.current = true;
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try {
              navigator.vibrate(15);
            } catch (_) {}
          }
        }
      }
      // 往边缘滑动（收起菜单）
      else if (diffX < 0 && diffY < 30) {
        let offset = isOpen ? SWIPE_MENU_WIDTH + diffX : 0;
        if (offset < 0) offset = 0;

        if (bubbleTextRef.current) {
          bubbleTextRef.current.style.transform = offset > 0 ? `translateX(${-offset * dragDirection}px)` : '';
          bubbleTextRef.current.style.transition = 'none';
        }
        if (swipeMenuRef.current) {
          swipeMenuRef.current.style.display = offset > 0 ? 'flex' : 'none';
          swipeMenuRef.current.style.opacity = String(Math.min(1, offset / SWIPE_MENU_WIDTH));
          swipeMenuRef.current.style.transform = `scale(${0.9 + (Math.min(SWIPE_MENU_WIDTH, offset) / SWIPE_MENU_WIDTH) * 0.1})`;
          swipeMenuRef.current.style.transition = 'none';
          swipeMenuRef.current.style.pointerEvents = offset > 0 ? 'auto' : 'none';
        }
        dragOffsetRef.current = offset;
      }
    }
  }, [cancelLongPress, isOpen, dragDirection]);

  const endTouch = React.useCallback(() => {
    cancelLongPress();
    isDraggingRef.current = false;
    setIsDragging(false);

    const isLockedToScroll = swipeLockedRef.current === 'scroll';
    swipeLockedRef.current = 'none';

    if (isLockedToScroll) {
      touchStartXRef.current = 0;
      return;
    }

    const rawDiffX = touchStartXRef.current - touchEndXRef.current;
    const diffX = rawDiffX * dragDirection;
    const diffY = Math.abs(touchStartYRef.current - touchEndYRef.current);

    let finalSwipedOpen = isOpen;
    let finalOffset = isOpen ? SWIPE_MENU_WIDTH : 0;

    if (diffY < 35 && editingMsgId !== message.id) {
      if (isOpen) {
        if (diffX < -25) {
          finalSwipedOpen = false;
          finalOffset = 0;
        }
      } else {
        if (diffX > 30) {
          finalSwipedOpen = true;
          finalOffset = SWIPE_MENU_WIDTH;
        }
      }
    }

    // 提交最终状态，并用 forceResetDomStyles 显式写入最终 display，杜绝单帧裸奔闪烁
    setSwipedMsgId(finalSwipedOpen ? message.id : null);
    setDragOffset(finalOffset);
    dragOffsetRef.current = finalOffset;
    forceResetDomStyles(finalOffset);

    touchStartXRef.current = 0;
  }, [cancelLongPress, editingMsgId, isOpen, message.id, dragDirection, setSwipedMsgId, forceResetDomStyles]);

  // 修复2：独立的 cancelTouch，不依赖旧坐标，直接维持 isOpen 当前语义状态，只清理 DOM 残留
  const cancelTouch = React.useCallback(() => {
    cancelLongPress();
    isDraggingRef.current = false;
    setIsDragging(false);
    swipeLockedRef.current = 'none';
    // 不读取 diffX/diffY 旧坐标，直接维持 isOpen 当前语义状态，只清理 DOM 残留
    const stableOffset = isOpen ? SWIPE_MENU_WIDTH : 0;
    setDragOffset(stableOffset);
    dragOffsetRef.current = stableOffset;
    forceResetDomStyles(stableOffset);
    touchStartXRef.current = 0;
  }, [cancelLongPress, isOpen, forceResetDomStyles]);

  return (
    <div
      ref={bubbleRef}
      role="article"
      aria-label={`${isUser ? t("message_bubble.user_said") : (activeCharacter?.name || t("message_bubble.role")) + t("message_bubble.char_said")}：${message.content}`}
      className={`flex items-start gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <MessageAvatar
        isUser={isUser}
        userAvatar={settings?.userAvatar}
        activePortraitUrl={activePortraitUrl}
        activeCharacter={activeCharacter}
      />

      {/* Speech Bubble */}
      <div
        className="max-w-[78%] group relative select-none w-full touch-pan-y"
        style={{
          minHeight: (isOpen || dragOffset > 0) ? `${swipeMenuHeight}px` : undefined,
        }}
        onTouchStart={startLongPress}
        onTouchMove={moveTouch}
        onTouchEnd={endTouch}
        onTouchCancel={cancelTouch}
        onMouseDown={startLongPress}
        onMouseMove={moveTouch}
        onMouseUp={endTouch}
        onMouseLeave={endTouch}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            setSwipedMsgId(null);
            setDragOffset(0);
            return;
          }
          if (hasTriggeredMenuThisTurn.current) {
            hasTriggeredMenuThisTurn.current = false;
            return;
          }
          if (msgMenuId === message.id) {
            setMsgMenuId(null);
          }
        }}
      >
        {/* 侧滑操作菜单 (Swipe Actions Menu) */}
        {editingMsgId !== message.id && (
          <div
            ref={swipeMenuRef}
            className={`absolute ${isUser ? "right-0" : "left-0"} top-0 bottom-0 flex flex-col items-center justify-center gap-1.5 z-0 pr-1`}
            style={{
              width: `${SWIPE_MENU_WIDTH}px`,
              opacity: isOpen || dragOffset > 0 ? Math.min(1, dragOffset / SWIPE_MENU_WIDTH) : 0,
              transform: `scale(${0.9 + (Math.min(SWIPE_MENU_WIDTH, dragOffset) / SWIPE_MENU_WIDTH) * 0.1})`,
              transition: isDragging ? "none" : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease",
              pointerEvents: isOpen || dragOffset > 0 ? "auto" : "none",
              display: isOpen || dragOffset > 0 ? "flex" : "none",
            }}
          >
            {/* 编辑 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingMsgId(message.id);
                setEditingMsgContent(message.content);
                setSwipedMsgId(null);
                setDragOffset(0);
              }}
              disabled={isSending}
              className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow active:scale-90 transition-transform disabled:opacity-40"
              title={t("message_bubble.swipe_edit")}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>

            {/* 生图 */}
            {showDraw && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setSwipedMsgId(null);
                  setDragOffset(0);

                  await handleGenerateImageForMessage({
                    message,
                    activeSession: unifiedAppStore.getState().activeSession,
                    settings,
                    activeCharacter,
                    setSessionViews,
                    showCustomAlert,
                    showCustomPrompt,
                    getKernelService,
                  });
                }}
                disabled={isSending}
                className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow active:scale-90 transition-transform disabled:opacity-40"
                title={t("message_bubble.swipe_draw")}
              >
                <Palette className="w-3.5 h-3.5" />
              </button>
            )}

            {/* 朗读 */}
            {showTts && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setSwipedMsgId(null);
                  setDragOffset(0);
                  const ttsService = getKernelService<ITtsService>("tts");
                  if (!ttsService) return;

                  if (isSpeakingThis) {
                    ttsService.stop();
                    setIsSpeakingThis(false);
                  } else {
                    setIsSpeakingThis(true);
                    let textToSpeak = message.content;
                    if (settings.ttsConfig?.readMode === "dialogue_only") {
                      const filtered = filterAsteriskActions(message.content);
                      if (filtered.trim().length > 0) {
                        textToSpeak = filtered;
                      }
                    }
                    ttsService.speak(textToSpeak, {
                      ...settings.ttsConfig,
                      messageId: message.id
                    }).finally(() => {
                      setIsSpeakingThis(false);
                    });
                  }
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center shadow active:scale-90 transition-transform ${
                  isSpeakingThis ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"
                }`}
                title={isSpeakingThis ? t("message_bubble.swipe_tts_stop") : t("message_bubble.swipe_tts_read")}
              >
                {isSpeakingThis ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            )}
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
                fontSize: settings?.chatFontSize ? `${settings.chatFontSize}px` : undefined,
                lineHeight: settings?.chatLineHeight ? `${settings.chatLineHeight}` : undefined,
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
                  const currentSession = unifiedAppStore.getState().activeSession;
                  if (!currentSession) return;
                  const nextMsgs = (currentSession.messages || []).map(
                    (currentMessage) =>
                      currentMessage.id === message.id
                        ? { ...currentMessage, content: editingMsgContent }
                        : currentMessage,
                  );
                  const updated = {
                    ...currentSession,
                    messages: nextMsgs,
                  };
                  const editedMessage = updated.messages.find((item) => item.id === message.id);
                  if (!editedMessage) return;
                  const persistedSession = await saveSessionWithMvu(updated, editedMessage);
                  setSessionViews((previous) =>
                    previous.map((session) =>
                      session.id === persistedSession.id ? persistedSession : session,
                    ),
                  );
                  setEditingMsgId(null);
                }}
                disabled={isSending}
                className="bg-emerald-600 hover:bg-emerald-500 text-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" /> {t("message_bubble.edit_save")}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingMsgId(null);
                }}
                disabled={isSending}
                className="bg-muted active:scale-[0.98] text-muted-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 border border-border shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" /> {t("message_bubble.edit_cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={bubbleTextRef}
            className="w-full relative z-10"
            style={{
              transform: dragOffset > 0 ? `translateX(${-dragOffset * dragDirection}px)` : undefined,
              transition: isDragging ? "none" : "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <div className="space-y-1 max-w-full">
              {!isUser &&
                message.reasoningContent &&
                settings.enableReasoningContentDisplay !== false && (
                  <ReasoningBlock
                    message={message}
                    isStreaming={isStreamingThisMsg}
                    isSending={isSending}
                    expandedIds={expandedReasoningIds}
                    setExpandedIds={setExpandedReasoningIds}
                    copiedIds={copiedReasoningIds}
                    setCopiedIds={setCopiedReasoningIds}
                  />
                )}

              <ToolCallBlock events={message.extra?.journalEvents} />

              <MessageAttachmentParts parts={message.parts ?? []} />

              {/* 主对白内容气泡：仅在思维链且正文还在准备时，暂不显示空气泡 */}
              {!(message.content === "💭..." && message.reasoningContent)
                && (!hasAttachmentParts || Boolean(message.content?.trim()) || isStreamingThisMsg)
                && (
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
                    fontSize: settings?.chatFontSize ? `${settings.chatFontSize}px` : undefined,
                    lineHeight: settings?.chatLineHeight ? `${settings.chatLineHeight}` : undefined,
                  }}
                >
                  {(message.content === "💭..." || (isStreamingThisMsg && !message.content?.trim())) ? (
                    <div className="flex items-center gap-2.5 py-0.5 select-none animate-pulse">
                      <CloudLoader size={26} />
                      <span className="text-xs text-muted-foreground/80 font-light">{t("message_bubble.ai_composing")}</span>
                    </div>
                  ) : !message.content?.trim() ? (
                    <span className="text-xs text-muted-foreground/60 italic select-none">{t("message_bubble.no_content")}</span>
                  ) : (
                    renderDialogueBubble(
                      message.content,
                      idx,
                      isStreamingThisMsg
                    )
                  )}
                </div>
              )}

              <GeneratedImageBlock
                image={message.extra?.image}
                isDrawing={message.extra?.isDrawing}
                showCustomAlert={showCustomAlert}
                showCustomConfirm={showCustomConfirm}
              />
            </div>

            <MessageTimestamp
              message={message}
              roundNum={roundNum}
              isUser={isUser}
            />
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

export default React.memo(MessageBubble);
