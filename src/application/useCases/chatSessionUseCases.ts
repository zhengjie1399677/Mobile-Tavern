import type { IDatabaseService } from "../serviceContracts";
import type { CharacterCard, ChatSession, ChatSessionMetadataPatch, Message, SummaryCard } from "../../types";

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
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>,
) {
  return {
    async loadInitialSessions(pageSize: number) {
      const [total, countsByCharacter, sessions] = await Promise.all([
        databaseService.getSessionsCount(),
        databaseService.getSessionCountsByCharacter(),
        databaseService.getSessionsPage({ pageSize }),
      ]);
      const page = sessions;
      return {
        sessions: page.sessions || [],
        total,
        countsByCharacter,
        hasMore: page.hasMore,
      };
    },

    async loadSessionStatistics() {
      const [total, countsByCharacter] = await Promise.all([
        databaseService.getSessionsCount(),
        databaseService.getSessionCountsByCharacter(),
      ]);
      return { total, countsByCharacter };
    },

    async loadSessionPage(
      pageSize: number,
      before: { createdAt: number; id: string } | undefined,
    ) {
      return databaseService.getSessionsPage({ pageSize, before });
    },

    async loadMessagePage(sessionId: string, pageSize: number, beforeMessageId?: string) {
      const window = await databaseService.getSessionMessageWindow(sessionId, {
        pageSize,
        beforeMessageId,
      });
      return {
        messages: window.messages,
        loadedCount: window.messages.length,
        hasMore: window.hasMore,
      };
    },

    updateSessionMetadata(sessionId: string, patch: ChatSessionMetadataPatch): Promise<void> {
      return databaseService.updateSessionMetadata(sessionId, patch);
    },

    deleteSession(id: string): Promise<void> {
      return databaseService.deleteSession(id);
    },
  };
}

export type ChatSessionUseCases = ReturnType<typeof createChatSessionUseCases>;
