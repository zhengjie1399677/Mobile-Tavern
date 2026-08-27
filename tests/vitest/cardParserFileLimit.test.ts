import { describe, expect, it } from "vitest";
import {
  isCharacterCardFileSizeAllowed,
  mapSillyTavernLorebookEntry,
  MAX_CHARACTER_CARD_FILE_BYTES,
} from "../../src/utils/cardParser";

describe("角色卡文件大小限制", () => {
  it("允许最大 20 MB，并拒绝超过边界的文件", () => {
    expect(MAX_CHARACTER_CARD_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(isCharacterCardFileSizeAllowed(MAX_CHARACTER_CARD_FILE_BYTES)).toBe(true);
    expect(isCharacterCardFileSizeAllowed(MAX_CHARACTER_CARD_FILE_BYTES + 1)).toBe(false);
    expect(isCharacterCardFileSizeAllowed(0)).toBe(false);
  });
});

describe("角色卡世界书键名归一化", () => {
  it("接受字符串或字符串数组，并忽略非标对象值", () => {
    expect(mapSillyTavernLorebookEntry({
      key: "城镇, 酒馆 ",
      content: "设定",
    }).keys).toEqual(["城镇", "酒馆"]);

    expect(mapSillyTavernLorebookEntry({
      keys: ["魔法, 剑", " 工会 "],
      content: "设定",
    }).keys).toEqual(["魔法", "剑", "工会"]);

    expect(mapSillyTavernLorebookEntry({
      key: { unexpected: true },
      keys: "后备键",
      content: "设定",
    }).keys).toEqual(["后备键"]);

    expect(mapSillyTavernLorebookEntry({
      key: { unexpected: true },
      content: "设定",
    }).keys).toEqual([]);
  });
});
