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
  SessionDirectoryQuery,
  SessionDirectorySnapshot,
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
  loadFavoriteSessionBackup,
  listFavoriteSessionBackups,
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

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort(), { once: true });
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async queryDirectory(query: SessionDirectoryQuery = {}): Promise<SessionDirectorySnapshot> {
    const [sessions, characters, backups] = await Promise.all([
      this.database.getAllSessions(),
      this.characters.getCharacterCatalog(),
      listFavoriteSessionBackups(),
    ]);
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    const characterMap = new Map(characters.map((character) => [character.id, character]));
    const favoriteEntries = backups.map((metadata) => this.toFavoriteEntry(metadata, sessionMap.get(metadata.sourceSessionId ?? "")));
    const favoriteMap = new Map(
      favoriteEntries.flatMap((entry) => entry.metadata.sourceSessionId
        ? [[entry.metadata.sourceSessionId, entry] as const]
        : []),
    );
    const branchCounts = new Map<string, number>();
    for (const session of sessions) {
      if (!session.parentSessionId) continue;
      branchCounts.set(session.parentSessionId, (branchCounts.get(session.parentSessionId) ?? 0) + 1);
    }

    const entries = sessions.map<SessionDirectoryEntry>((session) => {
      const character = characterMap.get(session.characterId);
      return {
        session,
        characterName: character?.name || "已移除角色",
        characterAvatar: character?.avatar,
        favorite: favoriteMap.get(session.id),
        branchCount: branchCounts.get(session.id) ?? 0,
      };
    });
    const entryMap = new Map(entries.map((entry) => [entry.session.id, entry]));
    const filtered = this.filterEntries(entries, query);
    return {
      active: filtered.filter((entry) => entry.session.lifecycle !== "archived"),
      archived: filtered.filter((entry) => entry.session.lifecycle === "archived"),
      favorites: favoriteEntries
        .filter((entry) => this.favoriteMatches(
          entry,
          query,
          entry.metadata.sourceSessionId
            ? entryMap.get(entry.metadata.sourceSessionId)
            : undefined,
        ))
        .sort((left, right) => this.compareFavorites(left, right, query)),
    };
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
    if (!await this.characters.getCharacterById(characterId)) {
      characterId = `character_restored_${crypto.randomUUID()}`;
      createdCharacterId = characterId;
      await this.characters.saveCharacter({ ...structuredClone(payload.character), id: characterId });
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

    const attachmentService = this.attachments;
    const previousAttachments = await attachmentService.exportAttachments();
    const previousMetadata = await attachmentService.listAttachments();
    const previousReferences = previousMetadata.flatMap((item) => item.referenceIds.map((referenceId) => ({
      referenceId,
      assetIds: [item.id],
    })));
    const mergedAttachments = Array.from(new Map(
      [...previousAttachments, ...payload.attachments].map((item) => [item.id, item]),
    ).values());
    const restoredReferences = messages.flatMap((message) => {
      const assetIds = collectMessageAssetIds(message.parts ?? []);
      return assetIds.length > 0 ? [{ referenceId: `${restoreId}/${message.id}`, assetIds }] : [];
    });
    const existingSessions = await this.database.getAllSessions();
    const previousJournal = (await Promise.all(existingSessions.map((session) =>
      this.agentRuntime.listJournalBySession(session.id),
    ))).flat();
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
    let sessionCreated = false;
    try {
      await attachmentService.replaceAttachments(
        mergedAttachments,
        mergeReferences([...previousReferences, ...restoredReferences]),
      );
      await this.database.replaceCompleteSessions([restoredSession], this.signal);
      sessionCreated = true;
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
      await this.agentRuntime.replaceJournal([...previousJournal, ...restoredJournal]);
      return restoredSession;
    } catch (error: unknown) {
      await Promise.allSettled([
        attachmentService.replaceAttachments(previousAttachments, mergeReferences(previousReferences)),
        this.agentRuntime.replaceJournal(previousJournal),
      ]);
      if (sessionCreated) {
        await this.database.updateSessionMetadata(restoreId, { lifecycle: "archived", archivedAt: Date.now() });
        await this.database.deleteSession(restoreId, this.signal);
      }
      if (createdCharacterId) await this.characters.deleteCharacter(createdCharacterId);
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

  private filterEntries(entries: SessionDirectoryEntry[], query: SessionDirectoryQuery): SessionDirectoryEntry[] {
    const normalizedSearch = query.search?.trim().toLocaleLowerCase();
    const filtered = entries.filter((entry) => {
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
    });
    return filtered.sort((left, right) => {
      if (query.sort === "created_asc") return left.session.createdAt - right.session.createdAt;
      if (query.sort === "title_asc") return left.session.title.localeCompare(right.session.title);
      if (query.sort === "turns_desc") return (right.session.turnCount ?? 0) - (left.session.turnCount ?? 0);
      return (right.session.updatedAt ?? right.session.createdAt) - (left.session.updatedAt ?? left.session.createdAt);
    });
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

  private compareFavorites(
    left: FavoriteSessionBackupEntry,
    right: FavoriteSessionBackupEntry,
    query: SessionDirectoryQuery,
  ): number {
    if (query.sort === "created_asc") return left.metadata.createdAt - right.metadata.createdAt;
    if (query.sort === "title_asc") return left.metadata.title.localeCompare(right.metadata.title);
    if (query.sort === "turns_desc") return right.metadata.messageCount - left.metadata.messageCount;
    return right.metadata.updatedAt - left.metadata.updatedAt;
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

function mergeReferences(
  references: ReadonlyArray<{ referenceId: string; assetIds: string[] }>,
): Array<{ referenceId: string; assetIds: string[] }> {
  const merged = new Map<string, Set<string>>();
  for (const reference of references) {
    const assetIds = merged.get(reference.referenceId) ?? new Set<string>();
    for (const assetId of reference.assetIds) assetIds.add(assetId);
    merged.set(reference.referenceId, assetIds);
  }
  return Array.from(merged, ([referenceId, assetIds]) => ({ referenceId, assetIds: [...assetIds] }));
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
