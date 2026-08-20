import { IDatabaseService, IKernel, IScriptService } from "../serviceContracts";
import { CharacterCard, ChatSession, ChatSessionMetadataPatch, Message } from "../../types";
import {
  updateSessionMetadata,
  deleteSession,
  replaceCompleteSessions as dbReplaceCompleteSessions,
} from "../../infrastructure/storage/repositories/sessionsWriteRepository";
import { getCharacterById } from "../../infrastructure/storage/repositories/charactersRepository";
import { verifyDatabaseIntegrity } from "../../infrastructure/storage/indexedDbIntegrityCheck";
import { runStorageDiagnostics } from "../../infrastructure/storage/storageDiagnostics";
import { Logger } from "../../utils/logger";

const logger = Logger.create("DatabaseService");
import {
  getAllSessions,
  getLatestSessionByCharacter,
  getSessionById,
  getSessionCountsByCharacter,
  getSessionsPage,
  getSessionsCount,
  getSessionsPaginated,
} from "../../infrastructure/storage/indexedDbSessionQueries";
import {
  appendSessionSummary as dbAppendSessionSummary,
  deleteSessionSummary as dbDeleteSessionSummary,
  getMessageById,
  getMessagesBySession,
  replaceSessionBranch as dbReplaceSessionBranch,
  updateSessionSummary as dbUpdateSessionSummary,
} from "../../infrastructure/storage/indexedDbMemoryStore";
import { updateSessionMessage as dbUpdateSessionMessage } from "../../infrastructure/storage/repositories/sessionMessageUpdateRepository";
import { applyCharacterRegexScripts } from "../../compatibility/sillytavern/mvuParser";
import { commitSessionTurn as dbCommitSessionTurn } from "../../infrastructure/storage/repositories/sessionTurnRepository";
import { deleteSessionMessage as dbDeleteSessionMessage } from "../../infrastructure/storage/repositories/sessionMessageDeleteRepository";
import { hydrateNewestFirstMessagePage } from "../useCases/chatMessageHydration";
import { fromStoredMessageRecord, type StoredChatMessageRecord } from "../../infrastructure/storage/messageRecord";
import {
  findLegacyMvuVariables,
  findSessionStateSnapshot,
} from "../../domain/chat/sessionStateSnapshot";
import type { MemoryServiceTyped } from "./memory";

export class DatabaseService implements IDatabaseService<
  ChatSession,
  CharacterCard,
  ChatSession["summaries"][number],
  Message,
  ChatSessionMetadataPatch
> {
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
    // 启动时后台触发 IndexedDB schema 完整性扫描（fire-and-forget）：
    // 不阻塞 init，不抛错；缺失项由 verifyDatabaseIntegrity 内部上报遥测与日志。
    // 此前仅有版本迁移与写队列安全网，无启动时损坏检测，单副本存储无冗余。
    void verifyDatabaseIntegrity().catch((e) => {
      // 兜底：扫描本身异常不得影响 DatabaseService 可用性
      logger.warn("Integrity scan failed", { error: e });
    });
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

  async getLatestSessionByCharacter(characterId: string): Promise<ChatSession | null> {
    return getLatestSessionByCharacter(characterId);
  }

  private async resolveMessageBoundary(
    sessionId: string,
    messageId: string | undefined,
  ): Promise<StoredChatMessageRecord | null> {
    if (!messageId) return null;
    const boundary = await getMessageById(messageId);
    if (!boundary) {
      throw new Error(`[DatabaseService] Message cursor ${messageId} no longer exists.`);
    }
    if (boundary.sessionId !== sessionId) {
      throw new Error(`[DatabaseService] Message cursor ${messageId} belongs to another session.`);
    }
    if (!Number.isInteger(boundary.turnIndex)) {
      throw new Error(`[DatabaseService] Message cursor ${messageId} has no valid turnIndex.`);
    }
    return boundary;
  }

  async getSessionMessageWindow(
    sessionId: string,
    options: { pageSize: number; beforeMessageId?: string },
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const boundary = await this.resolveMessageBoundary(sessionId, options.beforeMessageId);
    const records = await getMessagesBySession(sessionId, {
      limit: options.pageSize + 1,
      descending: true,
      maxTurnIndexExclusive: Number.isInteger(boundary?.turnIndex)
        ? boundary?.turnIndex
        : undefined,
    });
    return {
      messages: hydrateNewestFirstMessagePage(records.slice(0, options.pageSize)),
      hasMore: records.length > options.pageSize,
    };
  }

  async getSessionPromptMessages(
    sessionId: string,
    options: { limit?: number; preserveFirstAssistant: boolean; beforeMessageId?: string },
  ): Promise<Message[]> {
    const boundary = await this.resolveMessageBoundary(sessionId, options.beforeMessageId);
    const boundaryTurnIndex = boundary?.turnIndex;
    const maxTurnIndexExclusive = Number.isInteger(boundaryTurnIndex)
      ? boundaryTurnIndex as number
      : undefined;
    const records = await getMessagesBySession(sessionId, {
      limit: options.limit,
      descending: true,
      maxTurnIndexExclusive,
    });
    const recent = hydrateNewestFirstMessagePage(records);
    if (!options.preserveFirstAssistant || recent.length === 0) return recent;
    const firstRecords = await getMessagesBySession(sessionId, {
      limit: 1,
      descending: false,
      maxTurnIndexExclusive,
    });
    const first = firstRecords[0];
    if (!first || first.role !== "assistant" || recent.some((message) => message.id === first.id)) {
      return recent;
    }
    return [hydrateNewestFirstMessagePage(firstRecords)[0], ...recent];
  }

  async getSessionStateBeforeMessage(
    sessionId: string,
    messageId: string,
  ): Promise<ChatSessionMetadataPatch> {
    const [session, boundary] = await Promise.all([
      getSessionById(sessionId),
      getMessageById(messageId),
    ]);
    if (!session) throw new Error(`[DatabaseService] Session ${sessionId} not found.`);
    if (!boundary) throw new Error(`[DatabaseService] Message ${messageId} not found.`);
    if (boundary.sessionId !== sessionId || !Number.isInteger(boundary.turnIndex)) {
      throw new Error(`[DatabaseService] Message ${messageId} is not a valid boundary for session ${sessionId}.`);
    }

    const pageSize = 50;
    let offset = 0;
    let legacyVariables: Record<string, unknown> | undefined;
    while (true) {
      const records = await getMessagesBySession(sessionId, {
        limit: pageSize,
        offset,
        descending: true,
        maxTurnIndexExclusive: boundary.turnIndex,
      });
      if (records.length === 0) break;
      const messages = hydrateNewestFirstMessagePage(records);
      const snapshot = findSessionStateSnapshot(messages);
      if (snapshot) {
        return {
          variables: snapshot.variables,
          tableMemory: snapshot.tableMemory,
        };
      }
      legacyVariables ??= findLegacyMvuVariables(messages);
      if (records.length < pageSize) break;
      offset += records.length;
    }

    let tableMemory: ChatSession["tableMemory"];
    if (session.tableMemory && this.kernel.hasService("memory")) {
      const character = await this.getCharacterById(session.characterId);
      tableMemory = this.kernel
        .getService<MemoryServiceTyped>("memory")
        .getStateTable()
        .initDefaultSheets(character?.name || "NPC");
    }
    return { variables: legacyVariables, tableMemory };
  }

  // PERF-03: 分页加载 API，封装 localDB 实现
  async getSessionsCount(): Promise<number> {
    return getSessionsCount();
  }

  async getSessionCountsByCharacter(): Promise<Record<string, number>> {
    return getSessionCountsByCharacter();
  }

  async getSessionsPaginated(page: number, pageSize: number): Promise<ChatSession[]> {
    return getSessionsPaginated(page, pageSize);
  }

  async getSessionsPage(options: {
    pageSize: number;
    before?: { createdAt: number; id: string };
  }): Promise<{ sessions: ChatSession[]; hasMore: boolean }> {
    return getSessionsPage(options);
  }

  async runStorageDiagnostics() {
    return runStorageDiagnostics();
  }

  async updateSessionMetadata(sessionId: string, patch: ChatSessionMetadataPatch, signal?: AbortSignal, traceId?: string): Promise<void> {
    // traceId 预留：当前元数据更新转发到底层仓库，无内部日志输出。
    // 未来若在持久化前后增加诊断日志，应通过 logger.withTrace(traceId) 创建子 logger。
    void traceId;
    return updateSessionMetadata(sessionId, patch, signal ?? this.abortController?.signal);
  }

  async appendSessionSummary(
    sessionId: string,
    summary: ChatSession["summaries"][number],
    signal?: AbortSignal
  ): Promise<ChatSession> {
    return dbAppendSessionSummary(
      sessionId,
      summary,
      signal ?? this.abortController?.signal
    );
  }

  async updateSessionSummary(
    sessionId: string,
    summary: ChatSession["summaries"][number],
    signal?: AbortSignal
  ): Promise<ChatSession> {
    return dbUpdateSessionSummary(
      sessionId,
      summary,
      signal ?? this.abortController?.signal
    );
  }

  async deleteSessionSummary(
    sessionId: string,
    summaryId: string,
    signal?: AbortSignal
  ): Promise<ChatSession> {
    return dbDeleteSessionSummary(
      sessionId,
      summaryId,
      signal ?? this.abortController?.signal
    );
  }

  /**
   * 应用层单条消息写入也统一经过会话事务，确保聚合统计和消息内容同时提交。
   */
  async appendSessionMessage(sessionId: string, message: Message, turnIndex?: number, signal?: AbortSignal, traceId?: string): Promise<void> {
    void traceId;
    const messageWithTurn = turnIndex === undefined
      ? message
      : { ...message, turnIndex };
    await dbCommitSessionTurn(
      sessionId,
      {},
      [messageWithTurn],
      signal ?? this.abortController?.signal,
    );
  }

  async commitSessionTurn(
    sessionId: string,
    patch: ChatSessionMetadataPatch,
    messages: Message[],
    signal?: AbortSignal,
    traceId?: string,
  ): Promise<void> {
    void traceId;
    return dbCommitSessionTurn(
      sessionId,
      patch,
      messages,
      signal ?? this.abortController?.signal,
    );
  }

  async deleteSessionMessage(sessionId: string, messageId: string, signal?: AbortSignal): Promise<ChatSession> {
    return dbDeleteSessionMessage(sessionId, messageId, signal ?? this.abortController?.signal);
  }

  async updateSessionMessage(
    sessionId: string,
    message: Message,
    patch: ChatSessionMetadataPatch,
    signal?: AbortSignal,
  ): Promise<ChatSession> {
    return dbUpdateSessionMessage(
      sessionId,
      message,
      patch,
      signal ?? this.abortController?.signal,
    );
  }

  async replaceSessionBranch(
    session: ChatSession,
    removedMessageIds: string[],
    newMessages: Message[],
    signal?: AbortSignal
  ): Promise<void> {
    return dbReplaceSessionBranch(
      session,
      removedMessageIds,
      newMessages,
      signal ?? this.abortController?.signal
    );
  }

  async deleteSession(id: string, signal?: AbortSignal): Promise<void> {
    return deleteSession(id, signal ?? this.abortController?.signal);
  }

  // 批量写入会话（备份恢复 / 跨设备同步场景），跨 sessions+messages Store 事务
  async replaceCompleteSessions(sessionsList: ChatSession[], signal?: AbortSignal): Promise<void> {
    return dbReplaceCompleteSessions(sessionsList, signal ?? this.abortController?.signal);
  }

  // P0-4 / P1-4: 单条直查角色卡，避免全量反序列化
  async getCharacterById(id: string): Promise<CharacterCard | null> {
    return getCharacterById(id);
  }

  async createNewSession(character: CharacterCard, starterMessage?: string, initialSuggestions?: string[]): Promise<ChatSession> {
    const scriptService = this.kernel.getService<IScriptService<CharacterCard, ChatSession>>("script");
    let mvuVariables = scriptService.initializeMvuFromCharacter(character);
    
    const id = "session_" + Math.random().toString(36).substring(2, 9);
    let formattedStarter = (starterMessage || "").trim();
    if (formattedStarter) {
      try {
        const processedStarter = applyCharacterRegexScripts(formattedStarter, character, undefined, undefined, undefined, "store");
        mvuVariables = scriptService.parseMvuMessage(processedStarter, mvuVariables);
      } catch (err) {
        logger.warn("Failed to parse starterMessage variables", { error: err });
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
    await this.replaceCompleteSessions([newSession]);
    return newSession;
  }

  async createEmptyBranch(character: CharacterCard, title: string): Promise<ChatSession> {
    const scriptService = this.kernel.getService<IScriptService<CharacterCard, ChatSession>>("script");
    let mvuVariables = scriptService.initializeMvuFromCharacter(character);
    
    // 如果角色卡有开场白，将其作为新分支的初始第一条消息，避免页面完全空白
    let starterMessage = (character?.first_mes || "").trim();
    if (starterMessage) {
      try {
        const processedStarter = applyCharacterRegexScripts(starterMessage, character, undefined, undefined, undefined, "store");
        mvuVariables = scriptService.parseMvuMessage(processedStarter, mvuVariables);
      } catch (err) {
        logger.warn("Failed to parse branch starterMessage variables", { error: err });
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
    await this.replaceCompleteSessions([newSession]);
    return newSession;
  }

  async createBacktrackBranch(sourceSession: ChatSession, title: string, msgId: string): Promise<ChatSession> {
    // 分支回溯必须基于 messages Store 的完整历史，而不是内存中懒加载的最近一页。
    // 否则早于已加载页的历史消息会从新分支中整段丢失（数据丢失根因）。
    const rawHistory = await getMessagesBySession(sourceSession.id);
    const fullHistory: Message[] = rawHistory.length > 0
      ? (rawHistory as StoredChatMessageRecord[]).map(fromStoredMessageRecord)
      : sourceSession.messages;

    const msgIndex = fullHistory.findIndex(m => m.id === msgId);
    if (msgIndex < 0) {
      throw new Error("Message not found in source session");
    }
    const sourceSubHistory = fullHistory.slice(0, msgIndex + 1);
    const messageIdsSet = new Set(sourceSubHistory.map((m) => m.id));
    const filteredSummaries = (sourceSession.summaries || [])
      .filter((s) => s.lastMessageId && messageIdsSet.has(s.lastMessageId))
      .map((s) => ({ ...s }));

    const lastSummarizedMessageId = filteredSummaries.length > 0
      ? filteredSummaries[filteredSummaries.length - 1].lastMessageId
      : undefined;
    const snapshot = findSessionStateSnapshot(sourceSubHistory);
    const legacyVariables = findLegacyMvuVariables(sourceSubHistory);
    let tableMemory = snapshot?.tableMemory;
    if (!tableMemory && sourceSession.tableMemory) {
      if (msgIndex === fullHistory.length - 1) {
        tableMemory = structuredClone(sourceSession.tableMemory);
      } else if (this.kernel.hasService("memory")) {
        const character = await this.getCharacterById(sourceSession.characterId);
        tableMemory = this.kernel
          .getService<MemoryServiceTyped>("memory")
          .getStateTable()
          .initDefaultSheets(character?.name || "NPC");
      }
    }

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: sourceSession.characterId,
      title,
      createdAt: Date.now(),
      messages: sourceSubHistory,
      summaries: filteredSummaries,
      lastSummarizedMessageId,
      variables: snapshot?.variables
        ?? legacyVariables
        ?? (msgIndex === fullHistory.length - 1
          ? structuredClone(sourceSession.variables)
          : undefined),
      tableMemory,
      parentSessionId: sourceSession.id,
      parentMessageId: msgId,
    };
    await this.replaceCompleteSessions([newSession]);
    return newSession;
  }

  async createBacktrackFromTimeline(sourceSession: ChatSession, title: string, summaryId: string): Promise<ChatSession> {
    const sumIdx = (sourceSession.summaries || []).findIndex((s) => s.id === summaryId);
    if (sumIdx < 0) {
      throw new Error("Summary not found in source session");
    }
    const summary = sourceSession.summaries[sumIdx];
    if (!summary.lastMessageId) {
      throw new Error("Summary has no message boundary");
    }
    return this.createBacktrackBranch(sourceSession, title, summary.lastMessageId);
  }
}
