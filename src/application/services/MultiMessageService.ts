import { IMultiMessageService, IKernel, IDatabaseService } from "../serviceContracts";
import { ChatSession, Message } from "../../types";
import {
  getMessageContentText,
  normalizeMessageContentParts,
  type MessageContentPart,
} from "../../domain/messages/messageContent";
import { hasSwipeCandidates, stripSwipeCandidates } from "../../domain/chat/messageSwipes";

export class MultiMessageService implements IMultiMessageService<ChatSession> {
  name = "multiMessage";
  dependencies = ["database"] as const;
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController（纯计算服务，契约一致性）
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async queueUserMessage(
    session: ChatSession,
    text: string,
    additionalParts: readonly MessageContentPart[] = [],
  ): Promise<ChatSession> {
    const trimmedText = text.trim();
    const parts = normalizeMessageContentParts([
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      ...additionalParts.filter(part => part.type !== "text"),
    ]);
    const userMsg: Message = {
      id: "msg_user_" + Math.random().toString(36).substring(2, 9),
      sender: "user",
      content: getMessageContentText(parts),
      contentVersion: 2,
      parts,
      timestamp: Date.now(),
    };

    const cleanHistory = session.messages.filter(
      (m) => !(m.sender === "assistant" && (m.content === "💭..." || !m.content))
    );

    // 固化前置 assistant 消息的候选分支：只维护最新一条，下一轮对话开始时默认固定并释放空间。
    // 固化不改正文，因此 updateSessionMessage 的内容比较会跳过记忆片段/事实与记忆字典的失效，
    // 只落库字段变化（见 sessionMessageUpdateRepository）。
    let solidHistory = cleanHistory;
    let solidifiedPrevMsg: Message | null = null;
    const lastAssistantIdx = cleanHistory.length - 1;
    if (lastAssistantIdx >= 0) {
      const prevMsg = cleanHistory[lastAssistantIdx];
      if (prevMsg.sender === "assistant" && hasSwipeCandidates(prevMsg)) {
        const solidified = stripSwipeCandidates(prevMsg);
        solidHistory = [...cleanHistory];
        solidHistory[lastAssistantIdx] = solidified;
        solidifiedPrevMsg = solidified;
      }
    }

    const updatedMessages = [...solidHistory, userMsg];
    const updatedSession = { ...session, messages: updatedMessages };

    const databaseService = this.kernel.getService<IDatabaseService<ChatSession, unknown, unknown, Message>>("database");
    if (solidifiedPrevMsg && typeof databaseService.updateSessionMessage === "function") {
      try {
        await databaseService.updateSessionMessage(updatedSession.id, solidifiedPrevMsg, {});
      } catch {
        // 静默固化兜底
      }
    }
    await databaseService.appendSessionMessage(updatedSession.id, userMsg);
    return updatedSession;
  }
}
