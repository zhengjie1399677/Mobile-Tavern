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
  const pluginState = chat.runtimePluginState?.["mobile-tavern.sillytavern-compat"];
  const timedWorldInfo = pluginState && typeof pluginState === "object" && !Array.isArray(pluginState)
    ? (pluginState as Record<string, unknown>).timedWorldInfo
    : undefined;

  return {
    id: chat.id,
    title: chat.title,
    characterId: chat.characterId,
    messageCount: chat.messages?.length ?? 0,
    parentSessionId: chat.parentSessionId,
    timedWorldInfo,
  };
}
