import React, { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Message, ChatSession } from "../../../types";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import type { IDatabaseService } from "@/src/application/serviceContracts";
import { readSwipeCandidates } from "../../../domain/chat/messageSwipes";

interface MessageSwiperProps {
  message: Message;
  sessionId: string;
  isSending: boolean;
}

/**
 * 末尾消息候选分支翻页器 (Message Swiper)
 *
 * 遵循策略：
 * 1. 仅在当前会话最新一条 AI 消息（末尾回复）且拥有多个候选版本时展示；
 * 2. 上限 5 条，支持 ◀ 和 ▶ 切换不同版本；
 * 3. 翻页时同步更新 content、reasoningContent 与持久化，确保下游上下文准确；
 * 4. 下一轮对话发送后自动由 MultiMessageService 固化并释放空间。
 */
export const MessageSwiper: React.FC<MessageSwiperProps> = React.memo(({
  message,
  sessionId,
  isSending,
}) => {
  const { setSessionViews, getKernelService } = useUnifiedApp((state) => ({
    setSessionViews: state.setSessionViews,
    getKernelService: state.getKernelService,
  }));

  const swipes = message.swipes ?? [];
  const totalCount = swipes.length;
  const currentIndex = Math.max(
    0,
    Math.min(
      totalCount - 1,
      typeof message.swipeIndex === "number"
        ? message.swipeIndex
        : (typeof message.swipe_id === "number" ? message.swipe_id : totalCount - 1)
    )
  );

  const handleSelectSwipe = useCallback(
    async (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= totalCount || targetIndex === currentIndex || isSending) {
        return;
      }

      const targetContent = swipes[targetIndex];
      // 历史记录可能缺少逐条推理：以统一归一化结果取值，避免把当前推理错配到别的版本。
      const targetReasoning = readSwipeCandidates(message).reasonings[targetIndex] ?? "";

      const updatedMsg: Message = {
        ...message,
        content: targetContent,
        reasoningContent: targetReasoning || undefined,
        swipeIndex: targetIndex,
        swipe_id: targetIndex,
      };

      setSessionViews((prev: ChatSession[]) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) => (m.id === message.id ? updatedMsg : m)),
              }
            : s
        )
      );

      try {
        const dbService = getKernelService<IDatabaseService<ChatSession, unknown, unknown, Message>>("database");
        if (dbService && typeof dbService.updateSessionMessage === "function") {
          await dbService.updateSessionMessage(sessionId, updatedMsg, {});
        }
      } catch {
        // 静默保存失败兜底，界面仍保持激活状态
      }
    },
    [swipes, totalCount, currentIndex, isSending, message, sessionId, setSessionViews, getKernelService]
  );

  // 所有 Hook 都已调用完毕后再早退，避免条件调用 Hook 破坏渲染顺序。
  if (totalCount <= 1) {
    return null;
  }

  return (
    <div
      className="mt-1 flex items-center gap-1 text-[11px] font-mono text-muted-foreground/75 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => handleSelectSwipe(currentIndex - 1)}
        disabled={currentIndex <= 0 || isSending}
        className="flex h-5 w-5 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-foreground transition-all active:scale-90 hover:bg-muted/80 disabled:opacity-25 disabled:pointer-events-none"
        title="上一候选版本"
        aria-label="Previous swipe"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>

      <span className="px-1 text-[10px] tabular-nums font-medium text-foreground/80">
        {currentIndex + 1} / {totalCount}
      </span>

      <button
        type="button"
        onClick={() => handleSelectSwipe(currentIndex + 1)}
        disabled={currentIndex >= totalCount - 1 || isSending}
        className="flex h-5 w-5 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-foreground transition-all active:scale-90 hover:bg-muted/80 disabled:opacity-25 disabled:pointer-events-none"
        title="下一候选版本"
        aria-label="Next swipe"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
});

MessageSwiper.displayName = "MessageSwiper";
