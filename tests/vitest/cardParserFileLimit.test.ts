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

describe("SillyTavern 世界书条目字段对齐", () => {
  it("读取 ST 原生 disable 字段", () => {
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      content: "设定",
      disable: true,
    })).toMatchObject({ enabled: false, disabled: true });

    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      content: "设定",
      disable: false,
    })).toMatchObject({ enabled: true, disabled: false });

    // 本应用自己的导出用 enabled，两者都要认
    expect(mapSillyTavernLorebookEntry({
      keys: ["城门"],
      content: "设定",
      enabled: false,
    })).toMatchObject({ enabled: false, disabled: true });
  });

  it("读取 ST 原生 keysecondary 与次关键词策略枚举", () => {
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      keysecondary: ["守卫"],
      content: "设定",
      extensions: { selectiveLogic: 0 },
    })).toMatchObject({
      secondary_keys: ["守卫"],
      selectiveLogic: "AND_ANY",
    });

    // ST world_info_logic：1=NOT ALL、2=NOT ANY、3=AND ALL
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      keysecondary: ["守卫"],
      content: "设定",
      extensions: { selectiveLogic: 1 },
    }).selectiveLogic).toBe("NOT_ALL");
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      keysecondary: ["守卫"],
      content: "设定",
      extensions: { selectiveLogic: 2 },
    }).selectiveLogic).toBe("NOT_ANY");
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      keysecondary: ["守卫"],
      content: "设定",
      extensions: { selectiveLogic: 3 },
    }).selectiveLogic).toBe("AND_ALL");
  });

  it("selective 为 false 或没有次关键词时不启用次关键词判定", () => {
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      keysecondary: ["守卫"],
      selective: false,
      content: "设定",
    }).selectiveLogic).toBe("NONE");

    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      content: "设定",
    }).selectiveLogic).toBe("NONE");
  });

  it("接受 ST 原生 scanDepth 驼峰写法", () => {
    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      content: "设定",
      scanDepth: 4,
    }).scanDepth).toBe(4);

    expect(mapSillyTavernLorebookEntry({
      key: ["城门"],
      content: "设定",
      scanDepth: null,
    }).scanDepth).toBeUndefined();
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
      extensions: { exclude_recursion: true, group: "location" },
    });
  });
});
