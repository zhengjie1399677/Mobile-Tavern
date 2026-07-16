/**
 * 业务服务插件测试套件
 *
 * 覆盖 4 个业务服务插件到 localDB 的 CRUD 桥接正确性：
 *  - testCharacterService：CharacterService 角色卡 CRUD + 默认角色初始化标志位
 *  - testWorldbookService：WorldbookService 全局世界书 + 自定义世界书集 CRUD
 *  - testSettingsService：SettingsService 用户设置 CRUD
 *  - testPresetService：PresetService 预设包 CRUD
 *
 * 使用 fake-indexeddb 模拟真实 IDB 行为，验证服务层 → localDB 的桥接正确性，
 * 防止方法名拼写错误、参数顺序错位、返回值不正确等运行时缺陷。
 *
 * 遵循 AGENTS.md 准则一/八/十：物理隔离沙盒测试，不污染其他测试套件。
 */

import 'fake-indexeddb/auto';
import { assert } from "./testUtils";

export async function testCharacterService() {
  console.log("\n--- Running CharacterService Verification ---");
  const { __resetDBInstanceForTesting } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const { CharacterService } = await import("../../src/kernel/services/CharacterService");
  const service = new CharacterService();
  service.init({} as any);

  // 1. 初始读取应为空数组
  const initial = await service.getAllCharacters();
  assert(Array.isArray(initial) && initial.length === 0, "Initial characters should be empty array");

  // 2. saveCharacter → getAllCharacters
  const card = {
    id: "char_test_1",
    name: "测试角色",
    description: "测试描述",
    version: "1.0",
  } as any;
  await service.saveCharacter(card);
  const afterSave = await service.getAllCharacters();
  assert(afterSave.length === 1, "Should have 1 character after save");
  assert(afterSave[0].id === "char_test_1", "Saved character id matches");
  assert(afterSave[0].name === "测试角色", "Saved character name matches");

  // 3. bulkSaveCharacters 用 put 语义（同 id 更新，新 id 追加）
  const bulkCards = [
    { id: "char_test_1", name: "更新后的名字", version: "1.0" }, // 同 id 更新
    { id: "char_bulk_2", name: "批量2", version: "1.0" }, // 新增
  ] as any;
  await service.bulkSaveCharacters(bulkCards);
  const afterBulk = await service.getAllCharacters();
  assert(afterBulk.length === 2, "bulkSave should result in 2 items (1 updated + 1 new)");
  const updatedCard = afterBulk.find((c: any) => c.id === "char_test_1");
  assert(updatedCard && updatedCard.name === "更新后的名字", "Existing card should be updated by bulkSave (put semantics)");
  const newCard = afterBulk.find((c: any) => c.id === "char_bulk_2");
  assert(newCard && newCard.name === "批量2", "New bulk card should be added");

  // 4. deleteCharacter
  await service.deleteCharacter("char_bulk_2");
  const afterDelete = await service.getAllCharacters();
  assert(afterDelete.length === 1, "Should have 1 character after delete");
  assert(afterDelete[0].id === "char_test_1", "Remaining character id matches");

  // 5. 默认角色初始化标志位读写
  const initialFlag = await service.getStoredDefaultCharactersInitializedFlag();
  assert(initialFlag === false, "Default characters initialized flag should be false initially");
  await service.saveStoredDefaultCharactersInitializedFlag(true);
  const savedFlag = await service.getStoredDefaultCharactersInitializedFlag();
  assert(savedFlag === true, "Flag should be true after save");

  service.destroy();
  console.log("✔ CharacterService verified successfully!");
}

export async function testWorldbookService() {
  console.log("\n--- Running WorldbookService Verification ---");
  const { __resetDBInstanceForTesting } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const { WorldbookService } = await import("../../src/kernel/services/WorldbookService");
  const service = new WorldbookService();
  service.init({} as any);

  // 1. 全局世界书初始应为空数组
  const initialGlobal = await service.getGlobalLorebook();
  assert(Array.isArray(initialGlobal) && initialGlobal.length === 0, "Initial global lorebook should be empty array");

  // 2. saveGlobalLorebook → getGlobalLorebook
  const entries = [
    { id: "lore_1", keys: ["酒馆"], content: "酒馆入口", enabled: true },
    { id: "lore_2", keys: ["老张"], content: "老张是老板", enabled: true },
  ] as any;
  await service.saveGlobalLorebook(entries);
  const afterSave = await service.getGlobalLorebook();
  assert(afterSave.length === 2, "Should have 2 lorebook entries");
  assert(afterSave[0].id === "lore_1", "First entry id matches");
  assert(Array.isArray(afterSave[1].keys) && afterSave[1].keys.includes("老张"), "Second entry keys match");

  // 3. 自定义世界书集初始应为空对象
  const initialCustom = await service.getCustomWorldbooks();
  assert(typeof initialCustom === "object" && initialCustom !== null && Object.keys(initialCustom).length === 0, "Initial custom worldbooks should be empty object");

  // 4. saveCustomWorldbooks → getCustomWorldbooks
  const customWorldbooks = {
    wb_1: { name: "世界书A", lorebook: [] },
    wb_2: { name: "世界书B", lorebook: [] },
  } as any;
  await service.saveCustomWorldbooks(customWorldbooks);
  const afterCustomSave = await service.getCustomWorldbooks();
  assert(Object.keys(afterCustomSave).length === 2, "Should have 2 custom worldbooks");
  assert(afterCustomSave.wb_1.name === "世界书A", "First worldbook name matches");
  assert(afterCustomSave.wb_2.name === "世界书B", "Second worldbook name matches");

  service.destroy();
  console.log("✔ WorldbookService verified successfully!");
}

export async function testSettingsService() {
  console.log("\n--- Running SettingsService Verification ---");
  const { __resetDBInstanceForTesting } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const { SettingsService } = await import("../../src/kernel/services/SettingsService");
  const service = new SettingsService();
  service.init({} as any);

  // 1. 初始读取应为 null
  const initial = await service.getStoredSettings();
  assert(initial === null, "Initial settings should be null");

  // 2. saveStoredSettings → getStoredSettings
  const settings = {
    apiBaseUrl: "https://api.test.com/v1",
    apiKey: "sk-test-123",
    model: "gpt-4",
    ttsConfig: {
      enabled: true,
      provider: "speech-synthesis",
      volume: 0.8,
      rate: 1.0,
      pitch: 1.0,
      voiceName: "",
      openaiApiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "tts-1",
      openaiVoice: "alloy",
    },
  } as any;
  await service.saveStoredSettings(settings);
  const saved = await service.getStoredSettings() as any;
  assert(saved !== null, "Settings should be saved (not null)");
  assert(saved.apiBaseUrl === "https://api.test.com/v1", "apiBaseUrl matches");
  assert(saved.apiKey === "sk-test-123", "apiKey matches");
  assert(saved.ttsConfig.provider === "speech-synthesis", "ttsConfig.provider matches");
  assert(saved.ttsConfig.volume === 0.8, "ttsConfig.volume matches");

  service.destroy();
  console.log("✔ SettingsService verified successfully!");
}

export async function testPresetService() {
  console.log("\n--- Running PresetService Verification ---");
  const { __resetDBInstanceForTesting } = await import("../../src/utils/localDB");
  __resetDBInstanceForTesting();

  const { PresetService } = await import("../../src/kernel/services/PresetService");
  const service = new PresetService();
  service.init({} as any);

  // 1. 初始读取应为 null
  const initial = await service.getStoredSavedPresets();
  assert(initial === null, "Initial presets should be null");

  // 2. saveStoredSavedPresets → getStoredSavedPresets
  const presets = [
    { id: "preset_1", name: "预设A", settings: { temperature: 0.8 } },
    { id: "preset_2", name: "预设B", settings: { temperature: 1.0 } },
  ];
  await service.saveStoredSavedPresets(presets);
  const saved = await service.getStoredSavedPresets();
  assert(Array.isArray(saved), "Saved presets should be an array");
  assert(saved.length === 2, "Should have 2 presets");
  assert(saved[0].id === "preset_1", "First preset id matches");
  assert(saved[1].name === "预设B", "Second preset name matches");

  service.destroy();
  console.log("✔ PresetService verified successfully!");
}
