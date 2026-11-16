import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kernel } from "../../src/kernel/Kernel";
import { bindRuntimeKernel, getRuntimeKernel } from "../../src/kernel/runtimeKernel";
import { createScriptIframeSrcDoc, createMessageIframeSrcDoc } from "../../src/utils/tavernHelper/scriptIframe";
import { initTavernHelperMocks } from "../../src/utils/tavernHelper/tavernHelperMocks";
import {
  getBridgeParams,
  setBridgeParams,
  tavernHelperEventEmitter,
  type TavernHelperBridgeParams,
} from "../../src/utils/tavernHelper/bridgeCore";
import {
  createLorebookEntries,
  createOrReplaceWorldbook,
  createWorldbook,
  deleteLorebookEntries,
  deleteWorldbook,
  getCharLorebooks,
  getCharWorldbookNames,
  getCurrentCharPrimaryLorebook,
  getGlobalWorldbookNames,
  getLorebookEntries,
  getLorebookSettings,
  getWorldbook,
  getWorldbookNames,
  replaceWorldbook,
  setLorebookEntries,
  setLorebookSettings,
  updateWorldbookWith,
} from "../../src/compatibility/sillytavern/worldbookBridge";
import { resolveSillyTavernWorldInfo } from "../../src/compatibility/sillytavern/worldInfoResolver";
import type { CharacterCard, CustomWorldbook, LorebookEntry, UserSettings } from "../../src/types";

function makeEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: "entry-1",
    keys: ["勇者"],
    secondary_keys: ["圣剑"],
    selectiveLogic: "AND_ANY",
    content: "勇者持有圣剑。",
    constant: false,
    enabled: true,
    disabled: false,
    comment: "勇者设定",
    position: "after_char_def",
    depth: 4,
    order: 100,
    probability: 100,
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id: "char-1",
    name: "艾莉亚",
    description: "desc",
    personality: "kind",
    scenario: "fantasy",
    first_mes: "hello",
    mes_example: "",
    lorebookEntries: [makeEntry()],
    extensions: {
      world: "艾莉亚世界书",
      extra_world_books: ["附加设定集"],
    },
    ...overrides,
  };
}

function makeBridgeParams(overrides: Partial<TavernHelperBridgeParams> = {}): TavernHelperBridgeParams {
  let characters: CharacterCard[] = [overrides.activeCharacter ?? makeCharacter()];
  let customWorldbooks: Record<string, CustomWorldbook> = overrides.customWorldbooks ?? {
    "wb-extra": {
      id: "wb-extra",
      name: "附加设定集",
      enabled: true,
      entries: [makeEntry({ id: "extra-1", keys: ["魔法"], content: "魔力法则", comment: "魔法" })],
    },
    "wb-disabled": {
      id: "wb-disabled",
      name: "未启用设定集",
      enabled: false,
      entries: [],
    },
  };
  let globalLorebook: LorebookEntry[] = overrides.globalLorebook ?? [
    makeEntry({ id: "global-1", keys: ["世界观"], content: "全局规则", comment: "全局" }),
  ];

  const params: TavernHelperBridgeParams = {
    activeCharacter: characters[0],
    activeSession: null,
    characters,
    setSessions: vi.fn(),
    saveSession: vi.fn(async () => undefined),
    setCharacters: vi.fn((update) => {
      characters = typeof update === "function" ? update(characters) : update;
      params.characters = characters;
    }),
    saveCharacter: vi.fn(async (char) => {
      characters = characters.map((c) => (c.id === char.id ? char : c));
      params.characters = characters;
    }),
    globalLorebook,
    saveGlobalLorebook: vi.fn(async (entries) => {
      globalLorebook = entries;
      params.globalLorebook = entries;
    }),
    customWorldbooks,
    updateCustomWorldbooks: vi.fn(async (update) => {
      customWorldbooks = typeof update === "function" ? update(customWorldbooks) : update;
      params.customWorldbooks = customWorldbooks;
    }),
    settings: { userName: "玩家" } as UserSettings,
    updateSettings: vi.fn(),
    handleSendMessage: vi.fn(async () => true),
    ...overrides,
  };
  return params;
}

describe("SillyTavern 动态世界书 API (worldbookBridge)", () => {
  beforeEach(() => {
    if (!getRuntimeKernel()) {
      bindRuntimeKernel(new Kernel());
    }
    setBridgeParams(makeBridgeParams());
  });

  afterEach(() => {
    tavernHelperEventEmitter.clearAll();
    setBridgeParams(null);
  });

  it("正确解析角色主/附加世界书名、全局世界书名及 LorebookSettings", async () => {
    expect(getCharWorldbookNames("current")).toEqual({
      primary: "艾莉亚世界书",
      additional: ["附加设定集"],
    });
    await expect(getCharLorebooks()).resolves.toEqual({
      primary: "艾莉亚世界书",
      additional: ["附加设定集"],
    });
    expect(getCurrentCharPrimaryLorebook()).toBe("艾莉亚世界书");
    expect(getGlobalWorldbookNames()).toEqual(["附加设定集", "global"]);
    expect(getWorldbookNames()).toEqual(["附加设定集", "未启用设定集", "艾莉亚世界书", "global"]);

    const settings = getLorebookSettings();
    expect(settings.selected_global_lorebooks).toEqual(["附加设定集", "global"]);

    // 修改 selected_global_lorebooks 应同步切换 customWorldbooks.enabled
    setLorebookSettings({ selected_global_lorebooks: ["未启用设定集"] });
    const params = getBridgeParams();
    expect(params?.customWorldbooks?.["wb-extra"].enabled).toBe(false);
    expect(params?.customWorldbooks?.["wb-disabled"].enabled).toBe(true);
  });

  it("支持 getWorldbook / replaceWorldbook / updateWorldbookWith 读写角色绑定世界书并保持与 worldInfoResolver 兼容", async () => {
    const events: unknown[] = [];
    tavernHelperEventEmitter.on("worldinfo_updated", (name: string, entries: unknown) => {
      events.push({ name, entries });
    });

    const initial = await getWorldbook("艾莉亚世界书");
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      uid: 0,
      name: "勇者设定",
      enabled: true,
      content: "勇者持有圣剑。",
      strategy: {
        type: "selective",
        keys: ["勇者"],
        keys_secondary: { logic: "and_any", keys: ["圣剑"] },
      },
      position: { type: "after_character_definition", role: "system", depth: 4, order: 100 },
    });

    const updated = await updateWorldbookWith("艾莉亚世界书", (entries: unknown[]) => [
      ...entries,
      {
        uid: 1,
        name: "隐藏任务",
        enabled: true,
        strategy: {
          type: "selective",
          keys: [/魔王|暗影/i],
          keys_secondary: { logic: "and_all", keys: ["夜晚"] },
          scan_depth: 5,
        },
        position: { type: "at_depth", role: "user", depth: 2, order: 150 },
        content: "魔王会在夜晚现身。",
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: false, delay_until: null },
        effect: { sticky: 3, cooldown: 1, delay: null },
      },
    ]);

    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({
      uid: 1,
      name: "隐藏任务",
      strategy: {
        type: "selective",
        keys: ["/魔王|暗影/i"],
        keys_secondary: { logic: "and_all", keys: ["夜晚"] },
        scan_depth: 5,
      },
      position: { type: "at_depth", role: "user", depth: 2, order: 150 },
      recursion: { prevent_incoming: true, prevent_outgoing: false, delay_until: null },
      effect: { sticky: 3, cooldown: 1, delay: null },
    });

    const params = getBridgeParams()!;
    expect(params.saveCharacter).toHaveBeenCalledTimes(1);
    expect(params.activeCharacter?.lorebookEntries).toHaveLength(2);
    expect(events).toHaveLength(1);

    // 同一个 tick 内再次读取必须拿到更新后的内容，且能被 worldInfoResolver 触发
    const readBack = await getWorldbook("艾莉亚世界书");
    expect(readBack).toHaveLength(2);

    const triggered = resolveSillyTavernWorldInfo({
      entries: params.activeCharacter?.lorebookEntries ?? [],
      messages: [],
      userInput: "今晚暗影与夜晚降临",
    });
    expect(triggered.map((entry) => entry.comment)).toContain("隐藏任务");
  });

  it("支持自定义世界书增删改与全局世界书读写，未知世界书按规范抛错", async () => {
    await expect(getWorldbook("不存在的世界书")).rejects.toThrow("WORLD_BOOK_NOT_FOUND");
    await expect(replaceWorldbook("不存在的世界书", [])).rejects.toThrow("WORLD_BOOK_NOT_FOUND");

    const created = await createWorldbook("动态副本", [
      {
        name: "副本规则",
        enabled: true,
        strategy: { type: "constant", keys: [] },
        content: "进入副本后时间流速减半。",
      },
    ]);
    expect(created).toBe(true);
    expect(await createWorldbook("动态副本", [])).toBe(false);

    const book = await getWorldbook("动态副本");
    expect(book).toHaveLength(1);
    expect(book[0].strategy.type).toBe("constant");

    await createOrReplaceWorldbook("动态副本", [
      { name: "新规则", enabled: true, content: "副本已重置" },
    ]);
    expect((await getWorldbook("动态副本"))[0].content).toBe("副本已重置");

    expect(await deleteWorldbook("动态副本")).toBe(true);
    await expect(getWorldbook("动态副本")).rejects.toThrow("WORLD_BOOK_NOT_FOUND");

    await replaceWorldbook("global", [
      { name: "更新全局", enabled: true, keys: ["世界"], content: "新全局设定" },
    ]);
    const globalRead = await getWorldbook("global");
    expect(globalRead).toHaveLength(1);
    expect(globalRead[0].content).toBe("新全局设定");
  });

  it("支持旧版 getLorebookEntries / setLorebookEntries / createLorebookEntries / deleteLorebookEntries 语义", async () => {
    const entries = await getLorebookEntries("附加设定集");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ uid: 0, comment: "魔法", content: "魔力法则" });

    await setLorebookEntries("附加设定集", [{ uid: 0, content: "魔力守恒定律", enabled: false }]);
    const afterSet = await getLorebookEntries("附加设定集");
    expect(afterSet[0]).toMatchObject({ uid: 0, comment: "魔法", content: "魔力守恒定律", enabled: false });

    const created = await createLorebookEntries("附加设定集", [
      { comment: "炼金术", keys: ["炼金"], content: "等价交换" },
    ]);
    expect(created).toHaveLength(1);
    expect(created[0].uid).toBe(1);
    expect(await getLorebookEntries("附加设定集")).toHaveLength(2);

    await deleteLorebookEntries("附加设定集", [0]);
    const remaining = await getLorebookEntries("附加设定集");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].comment).toBe("炼金术");
  });

  it("在 TavernHelper 全局对象与 iframe 工厂中暴露世界书 API", () => {
    initTavernHelperMocks();
    const th = (window as unknown as { TavernHelper?: Record<string, unknown> }).TavernHelper;
    expect(typeof th?.getWorldbook).toBe("function");
    expect(typeof th?.replaceWorldbook).toBe("function");
    expect(typeof th?.updateWorldbookWith).toBe("function");
    expect(typeof th?.getCharWorldbookNames).toBe("function");

    const scriptHtml = createScriptIframeSrcDoc("console.log('ok');", "s1", false);
    const msgHtml = createMessageIframeSrcDoc("<div>hi</div>", 1, false);
    for (const apiName of ["getWorldbook", "replaceWorldbook", "updateWorldbookWith", "getWorldbookNames"]) {
      expect(scriptHtml).toContain(`'${apiName}'`);
      expect(msgHtml).toContain(`'${apiName}'`);
    }
  });
});
