import { describe, expect, it } from "vitest";
import {
  injectPngMetadata,
  isCharacterCardFileSizeAllowed,
  mapSillyTavernLorebookEntry,
  MAX_CHARACTER_CARD_FILE_BYTES,
  parseCharacterFile,
} from "../../src/utils/cardParser";
import type { CharacterCard } from "../../src/types";
import { parsePngMetadataLocal } from "../suites/testUtils";

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

  it.each([
    [0, "AND_ANY"],
    [1, "NOT_ALL"],
    [2, "NOT_ANY"],
    [3, "AND_ALL"],
  ] as const)("按 SillyTavern 枚举映射 selectiveLogic=%i", (raw, expected) => {
    expect(mapSillyTavernLorebookEntry({
      key: "城门",
      secondary_keys: " 白天, 守卫 ",
      content: "设定",
      selectiveLogic: raw,
    })).toMatchObject({
      secondary_keys: ["白天", "守卫"],
      selectiveLogic: expected,
    });
  });

  it("把时效和递归字段归一化，并忽略无效数值", () => {
    expect(mapSillyTavernLorebookEntry({
      key: "城门",
      content: "设定",
      depth: "invalid",
      order: "invalid",
      probability: "invalid",
      extensions: {
        sticky: "3",
        cooldown: 2,
        delay: "1",
        delay_until_recursion: "2",
        exclude_recursion: true,
        prevent_recursion: true,
        scan_depth: "invalid",
      },
    })).toMatchObject({
      depth: 4,
      order: 100,
      probability: 100,
      sticky: 3,
      cooldown: 2,
      delay: 1,
      delayUntilRecursion: 2,
      excludeRecursion: true,
      preventRecursion: true,
      scanDepth: undefined,
    });
  });

  it("保留未归一化的 SillyTavern 条目字段供兼容插件恢复", () => {
    const entry = mapSillyTavernLorebookEntry({
      uid: 42,
      key: ["城门"],
      content: "城门设定",
      extensions: {
        exclude_recursion: true,
        prevent_recursion: true,
        delay_until_recursion: 2,
        group: "location",
        group_weight: 7,
        role: "system",
      },
    });

    expect(entry.sourceMetadata).toMatchObject({
      uid: 42,
      extensions: {
        exclude_recursion: true,
        prevent_recursion: true,
        delay_until_recursion: 2,
        group: "location",
        group_weight: 7,
        role: "system",
      },
    });
  });
});

describe("角色卡来源字段保真", () => {
  it("导入并导出时保留未知卡片字段与 World Info 来源字段", async () => {
    const parsed = await parseCharacterFile(new File([JSON.stringify({
      data: {
        name: "保真角色",
        description: "描述",
        personality: "性格",
        scenario: "场景",
        first_mes: "你好",
        mes_example: "例句",
        custom_card_field: { provider: "st" },
        extensions: { custom_extension: { enabled: true } },
        character_book: {
          custom_book_field: "keep-me",
          entries: [{
            uid: 42,
            key: ["城门"],
            content: "城门设定",
            extensions: { exclude_recursion: true, group: "location" },
          }],
        },
      },
    })], "card.json", { type: "application/json" }));

    expect(parsed.sourceMetadata).toMatchObject({
      custom_card_field: { provider: "st" },
      extensions: { custom_extension: { enabled: true } },
      character_book: { custom_book_field: "keep-me" },
    });

    const character: CharacterCard = {
      id: "card-1",
      name: parsed.name ?? "",
      description: parsed.description ?? "",
      personality: parsed.personality ?? "",
      scenario: parsed.scenario ?? "",
      first_mes: parsed.first_mes ?? "",
      mes_example: parsed.mes_example ?? "",
      ...parsed,
    };
    character.lorebookEntries = character.lorebookEntries?.map((entry) => ({
      ...entry,
      selectiveLogic: "NOT_ANY",
      caseSensitive: true,
      sticky: 3,
      cooldown: 2,
      delay: 1,
      excludeRecursion: false,
      preventRecursion: true,
      delayUntilRecursion: 2,
    }));
    const basePng = Uint8Array.from(atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ), (value) => value.charCodeAt(0)).buffer;
    const exported = parsePngMetadataLocal(
      await (await injectPngMetadata(basePng, character)).arrayBuffer(),
    );

    expect(exported.data.custom_card_field).toEqual({ provider: "st" });
    expect(exported.data.extensions.custom_extension).toEqual({ enabled: true });
    expect(exported.data.character_book.custom_book_field).toBe("keep-me");
    expect(exported.data.character_book.entries[0]).toMatchObject({
      uid: 42,
      selectiveLogic: 2,
      caseSensitive: true,
      sticky: 3,
      cooldown: 2,
      delay: 1,
      excludeRecursion: false,
      preventRecursion: true,
      delayUntilRecursion: 2,
      extensions: {
        exclude_recursion: false,
        prevent_recursion: true,
        delay_until_recursion: 2,
        group: "location",
        selectiveLogic: 2,
        case_sensitive: true,
      },
    });
  });
});
