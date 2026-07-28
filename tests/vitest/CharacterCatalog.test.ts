import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "vitest";
import {
  deleteCharacter,
  getCharacterById,
  getCharacterCatalog,
  saveCharacter,
} from "../../src/infrastructure/storage/repositories/charactersRepository";
import type { CharacterCard } from "../../src/types";

const characterId = `catalog-test-${Date.now()}`;

describe("角色卡轻量目录", () => {
  afterAll(async () => {
    await deleteCharacter(characterId);
  });

  it("首页目录不反序列化头像、世界书与脚本，按主键仍可读取完整卡片", async () => {
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
      extensions: { __catalogOnly: true },
    });
    expect(catalogCard).not.toHaveProperty("avatar");
    expect(catalogCard).not.toHaveProperty("lorebookEntries");

    const hydrated = await getCharacterById(characterId);
    expect(hydrated).toMatchObject({
      avatar: completeCard.avatar,
      personality: completeCard.personality,
      lorebookEntries: completeCard.lorebookEntries,
      extensions: completeCard.extensions,
    });
  });
});
