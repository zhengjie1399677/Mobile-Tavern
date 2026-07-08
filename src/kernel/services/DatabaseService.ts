import { IDatabaseService, IKernel } from "../types";
import { ChatSession } from "../../types";
import { getAllSessions, saveSession, deleteSession, getSessionsCount, getSessionsPaginated, getSessionById, getCharacterById } from "../../utils/localDB";
import { applyCharacterRegexScripts } from "../../utils/tavernHelper/mvuParser";

export class DatabaseService implements IDatabaseService {
  name = "database";
  isCritical = true;
  dependencies = ["script"] as const;
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时中止挂起的 IDB 操作（IDB 事务会被 abort）
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async getAllSessions(): Promise<ChatSession[]> {
    return getAllSessions();
  }

  // P0-2: 单条直查会话，避免全量反序列化
  async getSessionById(id: string): Promise<ChatSession | null> {
    return getSessionById(id);
  }

  // PERF-03: 分页加载 API，封装 localDB 实现
  async getSessionsCount(): Promise<number> {
    return getSessionsCount();
  }

  async getSessionsPaginated(page: number, pageSize: number): Promise<ChatSession[]> {
    return getSessionsPaginated(page, pageSize);
  }

  async saveSession(session: ChatSession): Promise<void> {
    return saveSession(session);
  }

  async deleteSession(id: string): Promise<void> {
    return deleteSession(id);
  }

  // P0-4 / P1-4: 单条直查角色卡，避免全量反序列化
  async getCharacterById(id: string): Promise<any | null> {
    return getCharacterById(id);
  }

  async createNewSession(character: any, starterMessage?: string, initialSuggestions?: string[]): Promise<ChatSession> {
    const scriptService = this.kernel.getService<any>("script");
    let mvuVariables = scriptService.initializeMvuFromCharacter(character);
    
    const id = "session_" + Math.random().toString(36).substring(2, 9);
    let formattedStarter = (starterMessage || "").trim();
    if (formattedStarter) {
      try {
        const processedStarter = applyCharacterRegexScripts(formattedStarter, character, undefined, undefined, undefined, "store");
        mvuVariables = scriptService.parseMvuMessage(processedStarter, mvuVariables);
      } catch (err) {
        console.warn("[DatabaseService] Failed to parse starterMessage variables:", err);
      }
    }
    if (formattedStarter && !formattedStarter.includes("<center>")) {
      formattedStarter = `<center>\n${formattedStarter}\n</center>`;
    }

    const messages = formattedStarter
      ? [
          {
            id: "msg_ai_" + Math.random().toString(36).substring(2, 9),
            sender: "assistant" as const,
            content: formattedStarter,
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
    let mvuVariables = scriptService.initializeMvuFromCharacter(character);
    
    // 如果角色卡有开场白，将其作为新分支的初始第一条消息，避免页面完全空白
    let starterMessage = (character?.first_mes || "").trim();
    if (starterMessage) {
      try {
        const processedStarter = applyCharacterRegexScripts(starterMessage, character, undefined, undefined, undefined, "store");
        mvuVariables = scriptService.parseMvuMessage(processedStarter, mvuVariables);
      } catch (err) {
        console.warn("[DatabaseService] Failed to parse branch starterMessage variables:", err);
      }
    }
    if (starterMessage && !starterMessage.includes("<center>")) {
      starterMessage = `<center>\n${starterMessage}\n</center>`;
    }
    const messages = starterMessage
      ? [
          {
            id: "msg_ai_" + Math.random().toString(36).substring(2, 9),
            sender: "assistant" as const,
            content: starterMessage,
            timestamp: Date.now(),
            extra: {
              variables: {
                0: mvuVariables
              }
            }
          }
        ]
      : [];

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: character.id,
      title,
      messages,
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
