import { IScriptService, IKernel } from "../types";
import { CharacterCard, ChatSession } from "../../types";
import { initializeMvuFromCharacter, parseMvuMessage, notifyVariablesUpdated } from "../../utils/tavernHelperBridge";

export class ScriptService implements IScriptService {
  name = "script";
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  initializeMvuFromCharacter(character: CharacterCard): Record<string, any> {
    return initializeMvuFromCharacter(character);
  }

  parseMvuMessage(messageContent: string, currentVariables: Record<string, any>): Record<string, any> {
    return parseMvuMessage(messageContent, currentVariables);
  }

  async executeMvuScript(session: ChatSession, messageContent: string): Promise<ChatSession> {
    try {
      console.log("[ScriptService] Parsing message...", { messageContent });
      const parsedVariables = parseMvuMessage(messageContent, session.variables || {});
      console.log("[ScriptService] Parsed variables:", parsedVariables);
      
      let updatedMessages = session.messages;
      if (updatedMessages.length > 0) {
        const lastMsg = { ...updatedMessages[updatedMessages.length - 1] } as any;
        const swipeId = lastMsg.swipe_id !== undefined ? lastMsg.swipe_id : 0;
        const extra = { ...lastMsg.extra };
        if (!extra.variables) extra.variables = {};
        extra.variables = {
          ...extra.variables,
          [swipeId]: parsedVariables,
        };
        lastMsg.extra = extra;
        lastMsg.variables = extra.variables;
        updatedMessages = [
          ...session.messages.slice(0, -1),
          lastMsg,
        ];
        console.log(`[ScriptService] Synced parsed variables to last message (swipeId: ${swipeId})`);
      }

      const updatedSession = {
        ...session,
        variables: parsedVariables,
        messages: updatedMessages,
      };

      notifyVariablesUpdated(updatedSession);
      return updatedSession;
    } catch (e) {
      console.warn("Failed to parse MVU message:", e);
      return session;
    }
  }
}
