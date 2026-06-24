import { IMultiMessageService, IKernel, IDatabaseService } from "../types";
import { ChatSession, Message } from "../../types";

export class MultiMessageService implements IMultiMessageService {
  name = "multiMessage";
  dependencies = ["database"] as const;
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
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
