import { IDatabaseService, IKernel } from "../types";
import { ChatSession } from "../../types";
import { getAllSessions, saveSession, deleteSession } from "../../utils/localDB";

export class DatabaseService implements IDatabaseService {
  name = "database";
  isCritical = true;
  dependencies = ["script"] as const;
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  async getAllSessions(): Promise<ChatSession[]> {
    return getAllSessions();
  }

  async saveSession(session: ChatSession): Promise<void> {
    return saveSession(session);
  }

  async deleteSession(id: string): Promise<void> {
    return deleteSession(id);
  }

  async createNewSession(character: any, starterMessage?: string, initialSuggestions?: string[]): Promise<ChatSession> {
    const scriptService = this.kernel.getService<any>("script");
    const mvuVariables = scriptService.initializeMvuFromCharacter(character);
    const id = "session_" + Math.random().toString(36).substring(2, 9);
    
    const messages = starterMessage
      ? [
          {
            id: "msg_ai_" + Math.random().toString(36).substring(2, 9),
            sender: "assistant" as const,
            content: starterMessage.trim(),
            timestamp: Date.now(),
            extra: {
              variables: {
                0: mvuVariables
              },
              suggestions: initialSuggestions
            }
          }
        ]
      : [];

    const newSession: ChatSession = {
      id,
      characterId: character.id,
      title: character.name + " 的新会话",
      createdAt: Date.now(),
      messages,
      summaries: [],
      variables: mvuVariables,
    };
    await this.saveSession(newSession);
    return newSession;
  }

  async createEmptyBranch(character: any, title: string): Promise<ChatSession> {
    const scriptService = this.kernel.getService<any>("script");
    const mvuVariables = scriptService.initializeMvuFromCharacter(character);
    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: character.id,
      title,
      messages: [],
      summaries: [],
      createdAt: Date.now(),
      variables: mvuVariables,
    };
    await this.saveSession(newSession);
    return newSession;
  }

  async createBacktrackBranch(sourceSession: ChatSession, title: string, msgId: string): Promise<ChatSession> {
    const msgIndex = sourceSession.messages.findIndex(m => m.id === msgId);
    if (msgIndex < 0) {
      throw new Error("Message not found in source session");
    }
    const sourceSubHistory = sourceSession.messages.slice(0, msgIndex + 1);
    const messageIdsSet = new Set(sourceSubHistory.map((m) => m.id));
    const filteredSummaries = (sourceSession.summaries || [])
      .filter((s) => s.lastMessageId && messageIdsSet.has(s.lastMessageId))
      .map((s) => ({ ...s }));

    const lastSummarizedMessageId = filteredSummaries.length > 0
      ? filteredSummaries[filteredSummaries.length - 1].lastMessageId
      : undefined;

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: sourceSession.characterId,
      title,
      createdAt: Date.now(),
      messages: sourceSubHistory,
      summaries: filteredSummaries,
      lastSummarizedMessageId,
      variables: sourceSession.variables ? { ...sourceSession.variables } : undefined,
      tableMemory: sourceSession.tableMemory ? sourceSession.tableMemory.map(s => ({ ...s })) : undefined,
    };
    await this.saveSession(newSession);
    return newSession;
  }

  async createBacktrackFromTimeline(sourceSession: ChatSession, title: string, summaryId: string): Promise<ChatSession> {
    const sumIdx = (sourceSession.summaries || []).findIndex((s) => s.id === summaryId);
    if (sumIdx < 0) {
      throw new Error("Summary not found in source session");
    }
    const summary = sourceSession.summaries[sumIdx];
    const targetBranchesSummaries = (sourceSession.summaries || [])
      .slice(0, sumIdx + 1)
      .map((s) => ({ ...s }));

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: sourceSession.characterId,
      title,
      createdAt: Date.now(),
      messages: [
        {
          id: "msg_re_" + Date.now(),
          sender: "assistant" as const,
          content: `（继续在先前的局面上续写）\n当前时局记述: ${summary.content}\n\n“接下来，我们需要如何安排行动？”`,
          timestamp: Date.now(),
        },
      ],
      summaries: targetBranchesSummaries,
      lastSummarizedMessageId: undefined,
    };
    await this.saveSession(newSession);
    return newSession;
  }
}
