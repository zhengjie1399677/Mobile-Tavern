import type { ChatSession } from "../../../types";

export function checkPromptAssemblyAborted(...signals: Array<AbortSignal | undefined>): void {
  if (!signals.some((signal) => signal?.aborted)) return;
  if (typeof DOMException !== "undefined") {
    throw new DOMException("Prompt assembly was aborted", "AbortError");
  }
  const error = new Error("Prompt assembly was aborted");
  error.name = "AbortError";
  throw error;
}

export function createLorebookSessionContext(chat: ChatSession): Record<string, unknown> {
  return {
    id: chat.id,
    title: chat.title,
    characterId: chat.characterId,
    messageCount: chat.messages?.length ?? 0,
    parentSessionId: chat.parentSessionId,
  };
}
