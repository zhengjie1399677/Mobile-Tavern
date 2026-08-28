import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagementService } from "../../src/application/services/SessionManagementService";
import { AttachmentService } from "../../src/application/services/AttachmentService";
import { KernelServices } from "../../src/application/serviceContracts";
import { __sessionBackupStorageTest } from "../../src/infrastructure/sessionBackups/sessionBackupStorage";
import { __attachmentStorageTest } from "../../src/infrastructure/attachments/attachmentStorage";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import { getDictBySession } from "../../src/infrastructure/storage/repositories/memoryDictRepository";
import { getFragmentsBySession } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { getTemporalFactsBySession } from "../../src/infrastructure/storage/repositories/memoryFactsRepository";
import { deleteSession as deleteStoredSession } from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import type { AgentJournalEvent } from "../../src/domain/agents/contracts";
import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../../src/application/services/memory/types";
import type { CharacterCard, ChatSession, Message } from "../../src/types";

const session: ChatSession = {
  id: "session-1",
  characterId: "character-1",
  title: "旧旅程",
  createdAt: 1,
  updatedAt: 2,
  lifecycle: "active",
  contentRevision: 1,
  messages: [],
  summaries: [],
  turnCount: 1,
};
const character = {
  id: "character-1",
  name: "角色",
  first_mes: "",
  description: "",
  personality: "",
  avatar: "",
} as unknown as CharacterCard;

async function resetBackupDatabase(): Promise<void> {
  __sessionBackupStorageTest.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("MobileTavernSessionBackupDB");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function resetMainDatabase(): Promise<void> {
  __resetDBInstanceForTesting();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function pngFile(name: string): File {
  return new File([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  ], name, { type: "image/png" });
}

describe("SessionManagementService", () => {
  beforeEach(async () => {
    await resetBackupDatabase();
    await resetMainDatabase();
    await __attachmentStorageTest.reset();
  });

  it("收藏生成独立备份，并在源修订变化后标记未更新", async () => {
    let storedSession = { ...session };
    const database = {
      getSessionById: vi.fn(async () => ({ ...storedSession, messages: [] })),
      getSessionBranchCounts: vi.fn(async () => ({})),
      getSessionsPage: vi.fn(async () => ({
        sessions: [{ ...storedSession, messages: [] }],
        hasMore: false,
      })),
      getSessionPromptMessages: vi.fn(async () => [{ id: "message-1", sender: "user", content: "你好", timestamp: 2 }]),
      updateSessionMetadata: vi.fn(async (_id: string, patch: Partial<ChatSession>) => {
        storedSession = { ...storedSession, ...patch };
      }),
    };
    const services = new Map<string, unknown>([
      [KernelServices.Database, database],
      [KernelServices.Character, {
        getCharacterById: vi.fn(async () => character),
        getCharacterCatalog: vi.fn(async () => [character]),
      }],
      [KernelServices.Memory, { getStorage: () => ({
        getDictBySession: vi.fn(async () => []),
        getFragmentsBySession: vi.fn(async () => []),
        getTemporalFactsBySession: vi.fn(async () => []),
      }) }],
      [KernelServices.Attachments, { exportAttachments: vi.fn(async () => []) }],
      [KernelServices.AgentRuntime, { listJournalBySession: vi.fn(async () => []) }],
    ]);
    const management = new SessionManagementService();
    management.init({ getService: (name: string) => services.get(name) } as never);

    const favorite = await management.favoriteSession(session.id);
    expect(favorite.status).toBe("current");
    expect(database.updateSessionMetadata).toHaveBeenCalledWith(session.id, {
      favoriteBackupId: favorite.metadata.id,
    });

    storedSession = { ...storedSession, contentRevision: 2 };
    const favorites = await management.queryDirectory({ category: "favorite" });
    const active = await management.queryDirectory({ category: "active" });
    expect(favorites.favorites[0].status).toBe("outdated");
    expect(active.active[0].favorite?.status).toBe("outdated");
    expect((await management.queryDirectory({ category: "favorite", backupStatus: "current" })).favorites).toEqual([]);
    expect((await management.queryDirectory({ category: "favorite", backupStatus: "outdated" })).favorites).toHaveLength(1);
  });

  it("永久删除必须先归档", async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const database = {
      getSessionById: vi.fn(async () => ({ ...session })),
      deleteSession,
    };
    const management = new SessionManagementService();
    management.init({ getService: () => database } as never);

    await expect(management.permanentlyDeleteArchivedSession(session.id)).rejects.toThrow(
      "SESSION_DELETE_REQUIRES_ARCHIVE",
    );
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("收藏到恢复完整往返会重映射单会话数据，并保留期间新增的源数据与其他库记录", async () => {
    const harness = await createRestoreHarness();
    const favorite = await harness.management.favoriteSession(harness.sourceSession.id);

    harness.sourceSession.messages.push({
      id: "message-after-backup",
      sender: "assistant",
      content: "收藏之后的新回复",
      timestamp: 20,
    });
    harness.sourceSession.contentRevision = 2;
    await harness.attachments.replaceAttachments([]);
    const unrelatedAttachment = await harness.attachments.stageFile(pngFile("unrelated.png"));
    harness.journal.push({
      id: "background-event",
      sessionId: "other-session",
      turnId: "other-turn",
      sequence: 1,
      createdAt: 20,
      type: "turn.completed",
    });
    harness.characters.delete(character.id);

    const restored = await harness.management.restoreFavoriteBackup(favorite.metadata.id);
    const restoredMessages = harness.sessions.get(restored.id)?.messages ?? [];
    const restoredDict = await getDictBySession(restored.id);
    const restoredFragments = await getFragmentsBySession(restored.id);
    const restoredFacts = await getTemporalFactsBySession(restored.id);

    expect(restored.id).not.toBe(harness.sourceSession.id);
    expect(restored.characterId).not.toBe(character.id);
    expect(harness.characters.get(restored.characterId)?.name).toBe(character.name);
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0].id).not.toBe("message-before-backup");
    expect(restoredMessages[0].content).toBe("收藏时的消息");
    expect(restoredDict[0]).toMatchObject({
      sessionId: restored.id,
      firstSeenMsgId: restoredMessages[0].id,
    });
    expect(restoredFragments[0]).toMatchObject({
      sessionId: restored.id,
      sourceMessageIds: [restoredMessages[0].id],
    });
    expect(restoredFacts[0]).toMatchObject({
      sessionId: restored.id,
      sourceMessageId: restoredMessages[0].id,
    });
    expect(harness.journal).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "background-event", sessionId: "other-session" }),
      expect.objectContaining({ sessionId: restored.id, type: "turn.completed" }),
    ]));
    expect(await harness.attachments.getMetadata(unrelatedAttachment.id)).not.toBeNull();
    expect(await harness.attachments.getMetadata(harness.sourceAttachmentId)).not.toBeNull();
    expect(harness.sourceSession.messages.map((message) => message.id)).toEqual([
      "message-before-backup",
      "message-after-backup",
    ]);
  });

  it("恢复中间步骤失败时回滚新会话、记忆和重建角色，不破坏旧数据", async () => {
    const harness = await createRestoreHarness({ failJournalAppend: true });
    const favorite = await harness.management.favoriteSession(harness.sourceSession.id);
    harness.characters.delete(character.id);
    harness.journal.push({
      id: "background-event",
      sessionId: "other-session",
      turnId: "other-turn",
      sequence: 1,
      createdAt: 20,
      type: "turn.completed",
    });

    await expect(harness.management.restoreFavoriteBackup(favorite.metadata.id))
      .rejects.toThrow("TEST_JOURNAL_APPEND_FAILED");

    const rolledBackSessionId = harness.deletedSessionIds.find((id) => id !== harness.sourceSession.id);
    expect(rolledBackSessionId).toBeDefined();
    expect(harness.sessions.get(harness.sourceSession.id)?.messages[0].content).toBe("收藏时的消息");
    expect(harness.sessions.has(rolledBackSessionId as string)).toBe(false);
    expect(await getDictBySession(rolledBackSessionId as string)).toEqual([]);
    expect(await getFragmentsBySession(rolledBackSessionId as string)).toEqual([]);
    expect(await getTemporalFactsBySession(rolledBackSessionId as string)).toEqual([]);
    expect(harness.characters.size).toBe(0);
    expect(harness.journal).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "background-event", sessionId: "other-session" }),
      expect.objectContaining({ id: "source-journal", sessionId: harness.sourceSession.id }),
    ]));
    expect(harness.sourceMemory.dictEntries[0].firstSeenMsgId).toBe("message-before-backup");
    expect(harness.sourceMemory.fragments[0].sourceMessageIds).toEqual(["message-before-backup"]);
    expect(harness.sourceMemory.facts[0].sourceMessageId).toBe("message-before-backup");
    expect(await harness.attachments.getMetadata(harness.sourceAttachmentId)).not.toBeNull();
  });
});

async function createRestoreHarness(options: { failJournalAppend?: boolean } = {}) {
  const attachments = new AttachmentService();
  await attachments.init({} as never);
  const sourceAttachment = await attachments.stageFile(pngFile("source.png"));
  const sourceMessage: Message = {
    id: "message-before-backup",
    sender: "user",
    content: "收藏时的消息",
    parts: [{ type: "image", assetId: sourceAttachment.id }],
    timestamp: 10,
  };
  const sourceSession: ChatSession = {
    ...session,
    messages: [sourceMessage],
    summaries: [{
      id: "summary-before-backup",
      timeTag: "第一幕",
      location: "酒馆",
      content: "收藏时的总结",
      lastMessageId: sourceMessage.id,
    }],
    pinnedMessageIds: [sourceMessage.id],
  };
  const sessions = new Map<string, ChatSession>([[sourceSession.id, sourceSession]]);
  const characters = new Map<string, CharacterCard>([[character.id, character]]);
  const deletedSessionIds: string[] = [];
  const memoryDictEntries: MemoryDictEntry[] = [{
    id: `${sourceSession.id}:旅人`,
    sessionId: sourceSession.id,
    entity: "旅人",
    aliases: [],
    type: "character",
    firstSeenMsgId: sourceMessage.id,
    firstSeenTurn: 1,
    count: 1,
    createdAt: 10,
    updatedAt: 10,
  }];
  const memoryFragments: MemoryFragment[] = [{
    id: "fragment-before-backup",
    sessionId: sourceSession.id,
    content: "旅人来到酒馆",
    participants: ["旅人"],
    tags: [],
    sourceMessageIds: [sourceMessage.id],
    sourceRole: "user",
    sourceTurnStart: 1,
    sourceTurnEnd: 1,
    status: "active",
    importance: 0.5,
    confidence: 1,
    createdAt: 10,
    updatedAt: 10,
  }];
  const memoryFacts: TemporalFact[] = [{
    id: "fact-before-backup",
    sessionId: sourceSession.id,
    subject: "旅人",
    predicate: "位于",
    object: "酒馆",
    tags: [],
    status: "active",
    validFromTurn: 1,
    sourceMessageId: sourceMessage.id,
    confidence: 1,
    createdAt: 10,
    updatedAt: 10,
  }];
  const journal: AgentJournalEvent[] = [{
    id: "source-journal",
    sessionId: sourceSession.id,
    turnId: "source-turn",
    sequence: 1,
    createdAt: 10,
    type: "turn.completed",
  }];

  const database = {
    getSessionById: vi.fn(async (id: string) => sessions.get(id) ?? null),
    getSessionPromptMessages: vi.fn(async (id: string) => structuredClone(sessions.get(id)?.messages ?? [])),
    getSessionBranchCounts: vi.fn(async () => ({})),
    getSessionsPage: vi.fn(async () => ({ sessions: [], hasMore: false })),
    replaceCompleteSessions: vi.fn(async (restored: ChatSession[]) => {
      for (const item of restored) sessions.set(item.id, structuredClone(item));
    }),
    updateSessionMetadata: vi.fn(async (id: string, patch: Partial<ChatSession>) => {
      const current = sessions.get(id);
      if (!current) throw new Error("SESSION_NOT_FOUND");
      Object.assign(current, patch);
    }),
    deleteSession: vi.fn(async (id: string) => {
      sessions.delete(id);
      deletedSessionIds.push(id);
      await deleteStoredSession(id);
    }),
  };
  const characterService = {
    getCharacterById: vi.fn(async (id: string) => characters.get(id) ?? null),
    getCharacterCatalog: vi.fn(async () => Array.from(characters.values())),
    saveCharacter: vi.fn(async (value: CharacterCard) => {
      characters.set(value.id, structuredClone(value));
    }),
    deleteCharacter: vi.fn(async (id: string) => {
      characters.delete(id);
    }),
  };
  const agentRuntime = {
    listJournalBySession: vi.fn(async (sessionId: string) =>
      structuredClone(journal.filter((event) => event.sessionId === sessionId))),
    appendJournal: vi.fn(async (events: AgentJournalEvent[]) => {
      if (options.failJournalAppend) throw new Error("TEST_JOURNAL_APPEND_FAILED");
      journal.push(...structuredClone(events));
    }),
    deleteJournalBySession: vi.fn(async (sessionId: string) => {
      for (let index = journal.length - 1; index >= 0; index -= 1) {
        if (journal[index].sessionId === sessionId) journal.splice(index, 1);
      }
    }),
  };
  const services = new Map<string, unknown>([
    [KernelServices.Database, database],
    [KernelServices.Character, characterService],
    [KernelServices.Memory, { getStorage: () => ({
      getDictBySession: vi.fn(async (id: string) => id === sourceSession.id ? memoryDictEntries : []),
      getFragmentsBySession: vi.fn(async (id: string) => id === sourceSession.id ? memoryFragments : []),
      getTemporalFactsBySession: vi.fn(async (id: string) => id === sourceSession.id ? memoryFacts : []),
    }) }],
    [KernelServices.Attachments, attachments],
    [KernelServices.AgentRuntime, agentRuntime],
  ]);
  const management = new SessionManagementService();
  management.init({ getService: (name: string) => services.get(name) } as never);

  return {
    management,
    attachments,
    sourceAttachmentId: sourceAttachment.id,
    sourceSession,
    sessions,
    characters,
    journal,
    deletedSessionIds,
    sourceMemory: {
      dictEntries: memoryDictEntries,
      fragments: memoryFragments,
      facts: memoryFacts,
    },
  };
}
