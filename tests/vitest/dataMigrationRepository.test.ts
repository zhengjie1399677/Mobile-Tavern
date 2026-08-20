import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUnifiedBackupPayload } from "../../src/application/useCases/dataMigrationUseCases";
import { replaceLocalDataFromBackup } from "../../src/infrastructure/storage/repositories/dataMigrationRepository";
import { getAllCharacters } from "../../src/infrastructure/storage/repositories/charactersRepository";
import { getAllSessions } from "../../src/infrastructure/storage/indexedDbSessionQueries";
import { getMessagesBySession } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { getCustomWorldbooks } from "../../src/infrastructure/storage/repositories/worldbooksRepository";
import { getGlobalLorebook } from "../../src/infrastructure/storage/repositories/lorebooksRepository";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import { DB_NAME } from "../../src/infrastructure/storage/dbSchema";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { CharacterCard, ChatSession } from "../../src/types";

function deleteDatabase(): Promise<void> {
  __resetDBInstanceForTesting();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("测试数据库删除被阻塞"));
  });
}

function createPayload(id: string) {
  const character = {
    id: `character-${id}`,
    name: `角色-${id}`,
    avatar: "",
    lorebookEntries: [],
  } as unknown as CharacterCard;
  const session = {
    id: `session-${id}`,
    characterId: character.id,
    title: `会话-${id}`,
    createdAt: 1,
    summaries: [],
    messages: [
      {
        id: `message-${id}`,
        sender: "assistant",
        content: `正文-${id}`,
        timestamp: 1,
        reasoningContent: `推理-${id}`,
        generationTime: 1.25,
        tokenCount: 12,
        promptTokenCount: 34,
        swipes: ["版本一", "版本二"],
        swipe_id: 1,
        extra: { image: `asset://${id}` },
        variables: { stage: id },
      },
    ],
  } as ChatSession;

  return buildUnifiedBackupPayload({
    characters: [character],
    sessions: [session],
    memoryDictEntries: [],
    memoryFragments: [],
    memoryFacts: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    globalLorebook: [{ id: `lore-${id}`, keys: [id], content: id, enabled: true, constant: false }],
    customWorldbooks: {
      [`worldbook-${id}`]: {
        id: `worldbook-${id}`,
        name: `世界书-${id}`,
        enabled: true,
        entries: [],
      },
    },
    backupDate: "2026-08-03T00:00:00.000Z",
    isEncrypted: false,
  });
}

describe("本地数据原子覆盖仓库", () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it("覆盖后旧角色、会话、消息与世界书不残留", async () => {
    await replaceLocalDataFromBackup(createPayload("old"));
    await replaceLocalDataFromBackup(createPayload("new"));

    expect((await getAllCharacters()).map((item) => item.id)).toEqual(["character-new"]);
    expect((await getAllSessions()).map((item) => item.id)).toEqual(["session-new"]);
    expect((await getMessagesBySession("session-old"))).toEqual([]);
    expect((await getMessagesBySession("session-new")).map((item) => item.content)).toEqual(["正文-new"]);
    expect((await getMessagesBySession("session-new"))[0]).toMatchObject({
      reasoningContent: "推理-new",
      generationTime: 1.25,
      tokenCount: 12,
      promptTokenCount: 34,
      swipes: ["版本一", "版本二"],
      swipe_id: 1,
      metadata: { image: "asset://new" },
      variables: { stage: "new" },
    });
    expect(Object.keys(await getCustomWorldbooks())).toEqual(["worldbook-new"]);
    expect((await getGlobalLorebook()).map((item) => item.id)).toEqual(["lore-new"]);
  });

  it("任一记录无法写入时中止整个事务并保留旧数据", async () => {
    await replaceLocalDataFromBackup(createPayload("stable"));
    const invalid = createPayload("invalid");
    invalid.characters[0].avatar = (() => "不可克隆") as unknown as string;

    await expect(replaceLocalDataFromBackup(invalid)).rejects.toBeDefined();

    expect((await getAllCharacters()).map((item) => item.id)).toEqual(["character-stable"]);
    expect((await getAllSessions()).map((item) => item.id)).toEqual(["session-stable"]);
    expect((await getMessagesBySession("session-stable")).map((item) => item.content)).toEqual(["正文-stable"]);
  });
});
