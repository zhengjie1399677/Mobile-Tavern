import { IMultiMessageService, IKernel, IDatabaseService } from "../types";
import { ChatSession, Message } from "../../types";

export class MultiMessageService implements IMultiMessageService {
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

  async queueUserMessage(session: ChatSession, text: string): Promise<ChatSession> {
    const userMsg: Message = {
      id: "msg_user_" + Math.random().toString(36).substring(2, 9),
      sender: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    const cleanHistory = session.messages.filter(
      (m) => !(m.sender === "assistant" && (m.content === "💭..." || !m.content))
    );
    const updatedMessages = [...cleanHistory, userMsg];
    const updatedSession = { ...session, messages: updatedMessages };

    const databaseService = this.kernel.getService<IDatabaseService>("database");
    await databaseService.saveSession(updatedSession);
    return updatedSession;
  }
}
