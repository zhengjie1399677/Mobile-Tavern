import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "vitest";
import {
  deleteCharacter,
  getCharacterById,
  getCharacterCatalog,
  saveCharacter,
} from "../../src/infrastructure/storage/repositories/charactersRepository";
import type { CharacterCard } from "../../src/types";
import { deleteSession, replaceCompleteSessions } from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { getSessionById } from "../../src/infrastructure/storage/indexedDbSessionQueries";
import { getMessagesBySession } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { getDB } from "../../src/infrastructure/storage/idbConnection";

const characterId = `catalog-test-${Date.now()}`;

describe("角色卡轻量目录", () => {
  afterAll(async () => {
    await deleteCharacter(characterId);
  });

  it("首页目录加载头像但不反序列化世界书与脚本，按主键仍可读取完整卡片", async () => {
    const completeCard: CharacterCard = {
      id: characterId,
      name: "轻量目录测试角色",
      description: "仅保留在目录中的摘要",
      avatar: "data:image/png;base64," + "A".repeat(4096),
      personality: "完整人格",
      scenario: "完整场景",
      first_mes: "完整开场白",
      mes_example: "完整示例",
      lorebookEntries: [{
        id: "entry-1",
        keys: ["测试"],
        content: "完整世界书",
        constant: false,
        enabled: true,
      }],
      extensions: { regex_scripts: [{ name: "完整脚本" }] },
    };

    await saveCharacter(completeCard);

    const catalogCard = (await getCharacterCatalog()).find((card) => card.id === characterId);
    expect(catalogCard).toMatchObject({
      id: characterId,
      name: completeCard.name,
      description: completeCard.description,
      avatar: completeCard.avatar,
      extensions: { __catalogOnly: true },
    });
    expect(catalogCard).not.toHaveProperty("lorebookEntries");

    const hydrated = await getCharacterById(characterId);
    expect(hydrated).toMatchObject({
      avatar: completeCard.avatar,
      personality: completeCard.personality,
      lorebookEntries: completeCard.lorebookEntries,
      extensions: completeCard.extensions,
    });
  });

  it("删除角色时保留全部会话和记忆，避免绕过归档安全缓冲", async () => {
    const sessionIds = Array.from({ length: 55 }, (_, index) => `${characterId}-session-${index}`);
    await replaceCompleteSessions(sessionIds.map((id, index) => ({
      id,
      characterId,
      title: `会话 ${index}`,
      createdAt: index + 1,
      summaries: [],
      messages: [{
        id: `${id}-message`,
        sender: "assistant" as const,
        content: `消息 ${index}`,
        timestamp: index + 1,
      }],
    })));
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      transaction.objectStore("memory_dict").put({
        id: `${sessionIds[54]}:实体`, sessionId: sessionIds[54], entity: "实体", count: 1,
      });
      transaction.objectStore("memory_fragments").put({
        id: `${sessionIds[54]}-fragment`, sessionId: sessionIds[54], content: "事件",
        participants: [], tags: [], sourceMessageIds: [`${sessionIds[54]}-message`],
        sourceRole: "assistant", sourceTurnStart: 0, sourceTurnEnd: 0, status: "active",
        importance: 1, confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.objectStore("memory_facts").put({
        id: `${sessionIds[54]}-fact`, sessionId: sessionIds[54], subject: "甲",
        predicate: "认识", object: "乙", tags: [], status: "active", validFromTurn: 0,
        sourceMessageId: `${sessionIds[54]}-message`, confidence: 1, createdAt: 1, updatedAt: 1,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await deleteCharacter(characterId);

    expect(await getCharacterById(characterId)).toBeNull();
    expect(await getSessionById(sessionIds[0])).not.toBeNull();
    expect(await getSessionById(sessionIds[54])).not.toBeNull();
    expect(await getMessagesBySession(sessionIds[54])).toHaveLength(1);
    const derivedCounts = await new Promise<number[]>((resolve, reject) => {
      const transaction = db.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readonly",
      );
      const requests = ["memory_dict", "memory_fragments", "memory_facts"].map((store) =>
        transaction.objectStore(store).index("sessionId").count(IDBKeyRange.only(sessionIds[54]))
      );
      transaction.oncomplete = () => resolve(requests.map((request) => request.result));
      transaction.onerror = () => reject(transaction.error);
    });
    expect(derivedCounts).toEqual([1, 1, 1]);
    for (const sessionId of sessionIds) await deleteSession(sessionId);
  });
});
