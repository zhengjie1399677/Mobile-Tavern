import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "vitest";
import { CharacterService } from "../../src/application/services/CharacterService";
import {
  deleteCharacter,
  getCharacterById,
  getCharacterCatalog,
} from "../../src/infrastructure/storage/repositories/charactersRepository";
import type { CharacterCard, LorebookEntry } from "../../src/types";

/**
 * CharacterService 空壳保存守卫测试。
 *
 * 背景：世界书 Tab 启动时的 characters 来自 character_catalog 轻量目录
 * （getCharacterCatalog 产物，extensions.__catalogOnly === true），该空壳缺少
 * personality/scenario/first_mes/mes_example/system_prompt 与真实 extensions。
 * 若基于空壳对象直接 saveCharacter，会以空字段覆盖 characters store 中的完整记录。
 *
 * 守卫行为：检测到 __catalogOnly 空壳时，先 getCharacterById 重灌完整记录合并，
 * 空壳上的展示字段（name/description/avatar/creator/tags）与业务字段
 * （lorebookEntries/isWorldbookGlobal）优先，其余字段以完整记录为准。
 */

const characterId = `save-guard-test-${Date.now()}`;

describe("CharacterService 空壳保存守卫", () => {
  const service = new CharacterService();

  afterAll(async () => {
    await deleteCharacter(characterId);
  });

  it("空壳对象保存时不会清空完整字段，导入的新世界书条目能落盘", async () => {
    // 1. 先保存完整角色卡（模拟用户已有的角色）
    const fullCard: CharacterCard = {
      id: characterId,
      name: "守卫测试角色",
      description: "摘要",
      personality: "完整人格",
      scenario: "完整场景",
      first_mes: "完整开场白",
      mes_example: "完整示例",
      system_prompt: "系统提示",
      creator: "原作者",
      tags: ["测试"],
      lorebookEntries: [
        {
          id: "entry-old",
          keys: ["旧关键词"],
          content: "旧条目",
          constant: false,
          enabled: true,
        },
      ],
      extensions: { project: "mobile-tavern" },
    };
    await service.saveCharacter(fullCard);

    // 2. 模拟世界书 Tab 拿到的 catalog 空壳对象
    const catalog = await getCharacterCatalog();
    const shell = catalog.find((c) => c.id === characterId);
    expect(shell).toBeDefined();
    expect(shell!.extensions?.__catalogOnly).toBe(true);
    expect(shell!).not.toHaveProperty("lorebookEntries");
    expect(shell!.personality).toBe("");
    expect(shell!.scenario).toBe("");

    // 3. 模拟在世界书 Tab 对空壳角色导入新条目
    const imported: LorebookEntry = {
      id: "entry-new",
      keys: ["新关键词"],
      content: "导入的新条目",
      constant: false,
      enabled: true,
    };
    const shellWithImport: CharacterCard = {
      ...shell!,
      lorebookEntries: [...(shell!.lorebookEntries ?? []), imported],
    };
    await service.saveCharacter(shellWithImport);

    // 4. 完整字段必须保留（守卫核心价值），新条目必须写入
    const hydrated = await getCharacterById(characterId);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.personality).toBe("完整人格");
    expect(hydrated!.scenario).toBe("完整场景");
    expect(hydrated!.first_mes).toBe("完整开场白");
    expect(hydrated!.mes_example).toBe("完整示例");
    expect(hydrated!.system_prompt).toBe("系统提示");
    expect(hydrated!.creator).toBe("原作者");
    expect(hydrated!.extensions).toEqual({ project: "mobile-tavern" });
    expect(hydrated!.lorebookEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "entry-new" }),
      ]),
    );
    // 目录记录同步更新（展示字段仍可读）
    const updatedCatalog = await getCharacterCatalog();
    const updatedShell = updatedCatalog.find((c) => c.id === characterId);
    expect(updatedShell?.name).toBe("守卫测试角色");
  });

  it("完整对象保存不受守卫影响（正常路径直接落盘）", async () => {
    const id = `${characterId}-full`;
    try {
      const full: CharacterCard = {
        id,
        name: "完整路径角色",
        description: "d",
        personality: "p",
        scenario: "s",
        first_mes: "f",
        mes_example: "m",
        lorebookEntries: [
          {
            id: "le-a",
            keys: ["a"],
            content: "A",
            constant: false,
            enabled: true,
          },
        ],
        extensions: { kept: true },
      };
      await service.saveCharacter(full);
      const loaded = await getCharacterById(id);
      expect(loaded).toMatchObject({
        personality: "p",
        scenario: "s",
        first_mes: "f",
        mes_example: "m",
        extensions: { kept: true },
      });
    } finally {
      await deleteCharacter(id);
    }
  });
});
