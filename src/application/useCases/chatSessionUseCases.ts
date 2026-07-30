import type { IDatabaseService } from "../serviceContracts";
import type { MemoryServiceTyped } from "../services/memory";
import type { CharacterCard, ChatSession, Message, SummaryCard } from "../../types";
import { hydrateNewestFirstMessagePage } from "./chatMessageHydration";

export function mergeSessionPage(
  current: readonly ChatSession[],
  incoming: readonly ChatSession[],
): ChatSession[] {
  const existing = new Set(current.map((session) => session.id));
  return [
    ...current,
    ...incoming.filter((session) => {
      if (existing.has(session.id)) return false;
      existing.add(session.id);
      return true;
    }),
  ];
}

export function createChatSessionUseCases(
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>,
  memoryService: MemoryServiceTyped,
) {
  return {
    async loadInitialSessions(pageSize: number) {
      const [total, sessions] = await Promise.all([
        databaseService.getSessionsCount(),
        databaseService.getSessionsPaginated(1, pageSize),
      ]);
      return {
        sessions: sessions || [],
        total,
        hasMore: total > (sessions?.length || 0),
      };
    },

    async loadSessionPage(page: number, pageSize: number) {
      const sessions = await databaseService.getSessionsPaginated(page, pageSize);
      return {
        sessions: sessions || [],
        hasMore: (sessions?.length || 0) >= pageSize,
      };
    },

    async loadMessagePage(sessionId: string, offset: number, pageSize: number) {
      const messages = await memoryService.getStorage().getMessagesBySession(sessionId, {
        limit: pageSize,
        offset,
        descending: true,
      });
      return {
        messages: hydrateNewestFirstMessagePage(messages),
        loadedCount: messages.length,
        hasMore: messages.length >= pageSize,
      };
    },

    saveSession(session: ChatSession): Promise<void> {
      return databaseService.saveSession(session);
    },

    deleteSession(id: string): Promise<void> {
      return databaseService.deleteSession(id);
    },
  };
}

export type ChatSessionUseCases = ReturnType<typeof createChatSessionUseCases>;
