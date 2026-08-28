import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagementService } from "../../src/application/services/SessionManagementService";
import { KernelServices } from "../../src/application/serviceContracts";
import { __sessionBackupStorageTest } from "../../src/infrastructure/sessionBackups/sessionBackupStorage";
import type { CharacterCard, ChatSession } from "../../src/types";

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

describe("SessionManagementService", () => {
  beforeEach(resetBackupDatabase);

  it("收藏生成独立备份，并在源修订变化后标记未更新", async () => {
    let storedSession = { ...session };
    const database = {
      getSessionById: vi.fn(async () => ({ ...storedSession, messages: [] })),
      getAllSessions: vi.fn(async () => [{ ...storedSession, messages: [] }]),
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
    const directory = await management.queryDirectory();
    expect(directory.favorites[0].status).toBe("outdated");
    expect(directory.active[0].favorite?.status).toBe("outdated");
    expect((await management.queryDirectory({ backupStatus: "current" })).favorites).toEqual([]);
    expect((await management.queryDirectory({ backupStatus: "outdated" })).favorites).toHaveLength(1);
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
});
