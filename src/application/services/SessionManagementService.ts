import type {
  IAgentRuntimeService,
  IAttachmentService,
  ICharacterService,
  IDatabaseService,
  IKernel,
  ISessionManagementService,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type {
  FavoriteSessionBackupEntry,
  FavoriteSessionBackupMetadata,
  FavoriteSessionBackupPayload,
  SessionDirectoryEntry,
  SessionDirectoryCursor,
  SessionDirectoryQuery,
  SessionDirectorySnapshot,
  SessionDirectorySort,
} from "../../domain/session-management";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
} from "../../types";
import type { MemoryServiceTyped } from "./memory";
import { collectMessageAssetIds } from "../../domain/messages/messageContent";
import {
  deleteFavoriteSessionBackup,
  getFavoriteSessionBackupBySource,
  getFavoriteSessionBackupMetadata,
  loadFavoriteSessionBackup,
  listFavoriteSessionBackupsPage,
  pruneOrphanedFavoriteSessionBackupVersions,
  saveFavoriteSessionBackup,
} from "../../infrastructure/sessionBackups/sessionBackupStorage";
import { restoreSessionMemorySnapshot } from "../../infrastructure/storage/repositories/sessionMemorySnapshotRepository";

type Database = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message,
  ChatSessionMetadataPatch
>;

export class SessionManagementService implements ISessionManagementService<ChatSession> {
  readonly name = KernelServices.SessionManagement;
  readonly isCritical = false;
  readonly dependencies = [
    KernelServices.Database,
    KernelServices.Character,
    KernelServices.Memory,
    KernelServices.Attachments,
    KernelServices.AgentRuntime,
  ] as const;

  private kernel!: IKernel;
  private abortController: AbortController | null = null;
  private backupMaintenance: Promise<void> | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    this.backupMaintenance = pruneOrphanedFavoriteSessionBackupVersions()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn("[SessionManagementService] Failed to prune orphaned backup versions", error);
      });
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort(), { once: true });
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.backupMaintenance = null;
  }

  async queryDirectory(query: SessionDirectoryQuery = {}): Promise<SessionDirectorySnapshot> {
    await this.backupMaintenance;
    const category = query.category ?? "active";
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 24)));
    const sort = query.sort ?? "updated_desc";
    if (query.cursor && (
      query.cursor.sort !== sort
      || (query.cursor.category && query.cursor.category !== category)
    )) {
      throw new Error("SESSION_DIRECTORY_CURSOR_MISMATCH");
    }
    const [characters, branchCounts] = await Promise.all([
      this.characters.getCharacterCatalog(),
      this.database.getSessionBranchCounts(),
    ]);
    const characterMap = new Map(characters.map((character) => [character.id, character]));
    const snapshot = emptyDirectorySnapshot(characters.map(({ id, name }) => ({ id, name })));
    if (category === "favorite") {
      const page = await this.collectFavoritePage(query, pageSize, sort, characterMap, branchCounts);
      snapshot.favorites = page.items;
      snapshot.pageInfo.favorite = { cursor: page.cursor, hasMore: page.hasMore };
      return snapshot;
    }
    const page = await this.collectSessionPage(category, query, pageSize, sort, characterMap, branchCounts);
    snapshot[category] = page.items;
    snapshot.pageInfo[category] = { cursor: page.cursor, hasMore: page.hasMore };
    return snapshot;
  }

  async archiveSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.lifecycle === "archived") return;
    await this.database.updateSessionMetadata(sessionId, {
      lifecycle: "archived",
      archivedAt: Date.now(),
    });
  }

  async restoreSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.lifecycle !== "archived") return;
    await this.database.updateSessionMetadata(sessionId, {
      lifecycle: "active",
      archivedAt: undefined,
    });
  }

  async favoriteSession(sessionId: string): Promise<FavoriteSessionBackupEntry> {
    const session = await this.requireSession(sessionId);
    const existing = await getFavoriteSessionBackupBySource(sessionId);
    const entry = await this.writeBackup(session, existing);
    try {
      await this.database.updateSessionMetadata(sessionId, { favoriteBackupId: entry.metadata.id });
    } catch (error: unknown) {
      if (!existing) await deleteFavoriteSessionBackup(entry.metadata.id);
      throw error;
    }
    return entry;
  }

  async updateFavoriteBackup(backupId: string): Promise<FavoriteSessionBackupEntry> {
    const current = await loadFavoriteSessionBackup(backupId);
    const sourceId = current.metadata.sourceSessionId;
    if (!sourceId) throw new Error("SESSION_BACKUP_SOURCE_MISSING");
    const source = await this.requireSession(sourceId);
    return this.writeBackup(source, current.metadata);
  }

  async removeFavoriteBackup(backupId: string): Promise<void> {
    const loaded = await loadFavoriteSessionBackup(backupId);
    const sourceId = loaded.metadata.sourceSessionId;
    if (sourceId && await this.database.getSessionById(sourceId)) {
      await this.database.updateSessionMetadata(sourceId, { favoriteBackupId: undefined });
    }
    await deleteFavoriteSessionBackup(backupId);
  }

  async restoreFavoriteBackup(backupId: string): Promise<ChatSession> {
    const { payload, metadata } = await loadFavoriteSessionBackup(backupId);
    const restoreId = `session_restored_${crypto.randomUUID()}`;
    const messageIdMap = new Map(payload.session.messages.map((message) => [
      message.id,
      `${restoreId}_message_${crypto.randomUUID()}`,
    ]));
    const messages = payload.session.messages.map((message) => ({
      ...structuredClone(message),
      id: messageIdMap.get(message.id) as string,
    }));
    let characterId = payload.character.id;
    let createdCharacterId: string | null = null;
    const characterExists = Boolean(await this.characters.getCharacterById(characterId));
    if (!characterExists) {
      characterId = `character_restored_${crypto.randomUUID()}`;
      createdCharacterId = characterId;
    }
    const now = Date.now();
    const restoredSession: ChatSession = {
      ...structuredClone(payload.session),
      id: restoreId,
      characterId,
      title: `${metadata.title}（从收藏恢复）`,
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
      archivedAt: undefined,
      favoriteBackupId: undefined,
      contentRevision: 1,
      parentSessionId: metadata.sourceSessionId,
      parentMessageId: payload.session.parentMessageId
        ? messageIdMap.get(payload.session.parentMessageId) ?? payload.session.parentMessageId
        : undefined,
      messages,
      summaries: payload.session.summaries.map((summary) => ({
        ...structuredClone(summary),
        lastMessageId: summary.lastMessageId ? messageIdMap.get(summary.lastMessageId) : undefined,
      })),
      lastSummarizedMessageId: payload.session.lastSummarizedMessageId
        ? messageIdMap.get(payload.session.lastSummarizedMessageId)
        : undefined,
      pinnedMessageIds: payload.session.pinnedMessageIds?.map((id) => messageIdMap.get(id) ?? id),
      mutedMessageIds: payload.session.mutedMessageIds?.map((id) => messageIdMap.get(id) ?? id),
    };

    const turnIdMap = new Map<string, string>();
    const restoredJournal = payload.agentJournal.map((event, index) => {
      const turnId = turnIdMap.get(event.turnId) ?? `${restoreId}_turn_${crypto.randomUUID()}`;
      turnIdMap.set(event.turnId, turnId);
      return {
        ...structuredClone(event),
        id: `${restoreId}_journal_${index}_${crypto.randomUUID()}`,
        sessionId: restoreId,
        turnId,
      };
    });
    let importedAttachmentIds: string[] = [];
    try {
      if (createdCharacterId) {
        await this.characters.saveCharacter({ ...structuredClone(payload.character), id: createdCharacterId });
      }
      importedAttachmentIds = await this.attachments.importAttachments(payload.attachments);
      await this.database.replaceCompleteSessions([restoredSession], this.signal);
      await restoreSessionMemorySnapshot({
        dictEntries: payload.memoryDictEntries.map((entry) => ({
          ...structuredClone(entry),
          id: `${restoreId}:${entry.entity}`,
          sessionId: restoreId,
          firstSeenMsgId: messageIdMap.get(entry.firstSeenMsgId) ?? entry.firstSeenMsgId,
        })),
        fragments: remapFragments(payload, restoreId, messageIdMap),
        facts: remapFacts(payload, restoreId, messageIdMap),
      }, this.signal);
      await this.agentRuntime.appendJournal(restoredJournal);
      return restoredSession;
    } catch (error: unknown) {
      await this.agentRuntime.deleteJournalBySession(restoreId).catch(() => undefined);
      const persistedSession = await this.database.getSessionById(restoreId).catch(() => null);
      if (persistedSession) {
        await this.database
          .updateSessionMetadata(restoreId, { lifecycle: "archived", archivedAt: Date.now() })
          .then(() => this.database.deleteSession(restoreId, this.signal))
          .catch(() => undefined);
      }
      await this.attachments.discardUnreferencedAttachments(importedAttachmentIds).catch(() => undefined);
      if (createdCharacterId) await this.characters.deleteCharacter(createdCharacterId).catch(() => undefined);
      throw error;
    }
  }

  async permanentlyDeleteArchivedSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.lifecycle !== "archived") throw new Error("SESSION_DELETE_REQUIRES_ARCHIVE");
    await this.database.deleteSession(sessionId, this.signal);
  }

  private async writeBackup(
    sessionMetadata: ChatSession,
    existing: FavoriteSessionBackupMetadata | null,
  ): Promise<FavoriteSessionBackupEntry> {
    const session = await this.readCompleteSession(sessionMetadata);
    const character = await this.characters.getCharacterById(session.characterId);
    if (!character) throw new Error("SESSION_BACKUP_CHARACTER_MISSING");
    const storage = this.memory.getStorage();
    const assetIds = Array.from(new Set(session.messages.flatMap((message) =>
      collectMessageAssetIds(message.parts ?? []),
    )));
    const [dictEntries, fragments, facts, attachments, agentJournal] = await Promise.all([
      storage.getDictBySession(session.id),
      storage.getFragmentsBySession(session.id),
      storage.getTemporalFactsBySession(session.id),
      this.attachments.exportAttachments(assetIds),
      this.agentRuntime.listJournalBySession(session.id),
    ]);
    const payload: FavoriteSessionBackupPayload = structuredClone({
      version: 1,
      session,
      character,
      memoryDictEntries: dictEntries,
      memoryFragments: fragments,
      memoryFacts: facts,
      attachments,
      agentJournal,
    });
    const now = Date.now();
    const metadata = await saveFavoriteSessionBackup({
      id: existing?.id ?? `session_backup_${crypto.randomUUID()}`,
      sourceSessionId: session.id,
      sourceRevision: session.contentRevision ?? 1,
      sourceUpdatedAt: session.updatedAt ?? session.createdAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      title: session.title,
      characterName: character.name,
      messageCount: session.messages.length,
    }, payload);
    return this.toFavoriteEntry(metadata, session);
  }

  private async readCompleteSession(metadata: ChatSession): Promise<ChatSession> {
    return {
      ...metadata,
      messages: await this.database.getSessionPromptMessages(metadata.id, {
        preserveFirstAssistant: false,
      }),
    };
  }

  private toFavoriteEntry(
    metadata: FavoriteSessionBackupMetadata,
    sourceSession?: ChatSession,
  ): FavoriteSessionBackupEntry {
    const status = !sourceSession
      ? "source_missing" as const
      : (sourceSession.contentRevision ?? 1) === metadata.sourceRevision
        ? "current" as const
        : "outdated" as const;
    return {
      metadata,
      status,
      sourceSession,
      newMessageCount: status === "outdated"
        ? Math.max(1, (sourceSession?.contentRevision ?? 1) - metadata.sourceRevision)
        : 0,
    };
  }

  private entryMatches(entry: SessionDirectoryEntry, query: SessionDirectoryQuery): boolean {
    const normalizedSearch = query.search?.trim().toLocaleLowerCase();
    const session = entry.session;
    if (normalizedSearch && ![session.title, entry.characterName].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch),
    )) return false;
    if (query.characterId && session.characterId !== query.characterId) return false;
    if (query.createdAfter && session.createdAt < query.createdAfter) return false;
    if (query.updatedAfter && (session.updatedAt ?? session.createdAt) < query.updatedAfter) return false;
    if (query.hasBranch !== undefined && (entry.branchCount > 0 || Boolean(session.parentSessionId)) !== query.hasBranch) return false;
    if (query.backupStatus && entry.favorite?.status !== query.backupStatus) return false;
    return true;
  }

  private favoriteMatches(
    entry: FavoriteSessionBackupEntry,
    query: SessionDirectoryQuery,
    sourceEntry?: SessionDirectoryEntry,
  ): boolean {
    const search = query.search?.trim().toLocaleLowerCase();
    if (search && ![entry.metadata.title, entry.metadata.characterName].some((value) =>
      value.toLocaleLowerCase().includes(search),
    )) return false;
    if (query.characterId && sourceEntry?.session.characterId !== query.characterId) return false;
    if (query.createdAfter && (sourceEntry?.session.createdAt ?? entry.metadata.createdAt) < query.createdAfter) return false;
    if (query.updatedAfter && (sourceEntry?.session.updatedAt ?? entry.metadata.updatedAt) < query.updatedAfter) return false;
    if (query.hasBranch !== undefined) {
      const hasBranch = sourceEntry
        ? sourceEntry.branchCount > 0 || Boolean(sourceEntry.session.parentSessionId)
        : false;
      if (hasBranch !== query.hasBranch) return false;
    }
    if (query.backupStatus && entry.status !== query.backupStatus) return false;
    return true;
  }

  private async collectSessionPage(
    category: "active" | "archived",
    query: SessionDirectoryQuery,
    pageSize: number,
    sort: SessionDirectorySort,
    characterMap: ReadonlyMap<string, CharacterCard>,
    branchCounts: Readonly<Record<string, number>>,
  ): Promise<{ items: SessionDirectoryEntry[]; cursor?: SessionDirectoryCursor; hasMore: boolean }> {
    const matches: Array<{ entry: SessionDirectoryEntry; cursor: SessionDirectoryCursor }> = [];
    let sourceCursor = query.cursor;
    let sourceHasMore = true;
    while (matches.length <= pageSize && sourceHasMore) {
      const page = await this.database.getSessionsPage({
        pageSize: Math.max(32, pageSize * 2),
        cursor: sourceCursor,
        lifecycle: category,
        sort,
      });
      sourceHasMore = page.hasMore;
      sourceCursor = page.cursor;
      const entries = await Promise.all(page.sessions.map(async (session) => {
        const character = characterMap.get(session.characterId);
        const favoriteMetadata = session.favoriteBackupId
          ? await getFavoriteSessionBackupMetadata(session.favoriteBackupId)
          : null;
        return {
          session,
          characterName: character?.name || "已移除角色",
          characterAvatar: character?.avatar,
          favorite: favoriteMetadata ? this.toFavoriteEntry(favoriteMetadata, session) : undefined,
          branchCount: branchCounts[session.id] ?? 0,
        } satisfies SessionDirectoryEntry;
      }));
      for (const entry of entries) {
        if (!this.entryMatches(entry, query)) continue;
        matches.push({ entry, cursor: toSessionCursor(entry.session, category, sort) });
        if (matches.length > pageSize) break;
      }
      if (page.sessions.length === 0) sourceHasMore = false;
    }
    const visible = matches.slice(0, pageSize);
    return {
      items: visible.map(({ entry }) => entry),
      cursor: visible.at(-1)?.cursor,
      hasMore: matches.length > pageSize,
    };
  }

  private async collectFavoritePage(
    query: SessionDirectoryQuery,
    pageSize: number,
    sort: SessionDirectorySort,
    characterMap: ReadonlyMap<string, CharacterCard>,
    branchCounts: Readonly<Record<string, number>>,
  ): Promise<{ items: FavoriteSessionBackupEntry[]; cursor?: SessionDirectoryCursor; hasMore: boolean }> {
    const matches: Array<{ entry: FavoriteSessionBackupEntry; cursor: SessionDirectoryCursor }> = [];
    let sourceCursor = query.cursor;
    let sourceHasMore = true;
    while (matches.length <= pageSize && sourceHasMore) {
      const page = await listFavoriteSessionBackupsPage({
        pageSize: Math.max(32, pageSize * 2),
        cursor: sourceCursor,
        sort,
      });
      sourceHasMore = page.hasMore;
      sourceCursor = page.cursor;
      const sourceSessions = await Promise.all(page.records.map((metadata) =>
        metadata.sourceSessionId
          ? this.database.getSessionById(metadata.sourceSessionId)
          : Promise.resolve(null),
      ));
      page.records.forEach((metadata, index) => {
        const sourceSession = sourceSessions[index] ?? undefined;
        const entry = this.toFavoriteEntry(metadata, sourceSession);
        const sourceCharacter = sourceSession ? characterMap.get(sourceSession.characterId) : undefined;
        const sourceEntry = sourceSession ? {
          session: sourceSession,
          characterName: sourceCharacter?.name || metadata.characterName,
          characterAvatar: sourceCharacter?.avatar,
          favorite: entry,
          branchCount: branchCounts[sourceSession.id] ?? 0,
        } satisfies SessionDirectoryEntry : undefined;
        if (!this.favoriteMatches(entry, query, sourceEntry)) return;
        matches.push({ entry, cursor: toFavoriteCursor(metadata, sort) });
      });
      if (page.records.length === 0) sourceHasMore = false;
    }
    const visible = matches.slice(0, pageSize);
    return {
      items: visible.map(({ entry }) => entry),
      cursor: visible.at(-1)?.cursor,
      hasMore: matches.length > pageSize,
    };
  }

  private requireSession(sessionId: string): Promise<ChatSession> {
    return this.database.getSessionById(sessionId).then((session) => {
      if (!session) throw new Error("SESSION_NOT_FOUND");
      return session;
    });
  }

  private get database(): Database {
    return this.kernel.getService<Database>(KernelServices.Database);
  }

  private get characters(): ICharacterService<CharacterCard> {
    return this.kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
  }

  private get memory(): MemoryServiceTyped {
    return this.kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
  }

  private get attachments(): IAttachmentService {
    return this.kernel.getService<IAttachmentService>(KernelServices.Attachments);
  }

  private get agentRuntime(): IAgentRuntimeService {
    return this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
  }

  private get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }
}

function emptyDirectorySnapshot(
  characters: ReadonlyArray<{ id: string; name: string }>,
): SessionDirectorySnapshot {
  return {
    active: [],
    favorites: [],
    archived: [],
    pageInfo: {
      active: { hasMore: false },
      favorite: { hasMore: false },
      archived: { hasMore: false },
    },
    characters,
  };
}

function sessionSortValue(session: ChatSession, sort: SessionDirectorySort): number | string {
  if (sort === "created_asc" || sort === "created_desc") return session.createdAt;
  if (sort === "title_asc") return session.title;
  if (sort === "turns_desc") return session.turnCount ?? 0;
  return session.updatedAt ?? session.createdAt;
}

function toSessionCursor(
  session: ChatSession,
  category: "active" | "archived",
  sort: SessionDirectorySort,
): SessionDirectoryCursor {
  return {
    category,
    sort,
    value: sessionSortValue(session, sort),
    createdAt: session.createdAt,
    id: session.id,
  };
}

function toFavoriteCursor(
  metadata: FavoriteSessionBackupMetadata,
  sort: SessionDirectorySort,
): SessionDirectoryCursor {
  const value = sort === "created_asc" || sort === "created_desc"
    ? metadata.createdAt
    : sort === "title_asc"
      ? metadata.title
      : sort === "turns_desc"
        ? metadata.messageCount
        : metadata.updatedAt;
  return {
    category: "favorite",
    sort,
    value,
    createdAt: metadata.createdAt,
    id: metadata.id,
  };
}

function remapFragments(
  payload: FavoriteSessionBackupPayload,
  sessionId: string,
  messageIdMap: ReadonlyMap<string, string>,
) {
  const idMap = new Map(payload.memoryFragments.map((fragment) => [
    fragment.id,
    `${sessionId}_fragment_${crypto.randomUUID()}`,
  ]));
  return payload.memoryFragments.map((fragment) => ({
    ...structuredClone(fragment),
    id: idMap.get(fragment.id) as string,
    sessionId,
    sourceMessageIds: fragment.sourceMessageIds.map((id) => messageIdMap.get(id) ?? id),
    supersedesId: fragment.supersedesId ? idMap.get(fragment.supersedesId) : undefined,
    supersededById: fragment.supersededById ? idMap.get(fragment.supersededById) : undefined,
  }));
}

function remapFacts(
  payload: FavoriteSessionBackupPayload,
  sessionId: string,
  messageIdMap: ReadonlyMap<string, string>,
) {
  const idMap = new Map(payload.memoryFacts.map((fact) => [
    fact.id,
    `${sessionId}_fact_${crypto.randomUUID()}`,
  ]));
  return payload.memoryFacts.map((fact) => ({
    ...structuredClone(fact),
    id: idMap.get(fact.id) as string,
    sessionId,
    sourceMessageId: messageIdMap.get(fact.sourceMessageId) ?? fact.sourceMessageId,
    supersedesId: fact.supersedesId ? idMap.get(fact.supersedesId) : undefined,
    supersededById: fact.supersededById ? idMap.get(fact.supersededById) : undefined,
  }));
}
