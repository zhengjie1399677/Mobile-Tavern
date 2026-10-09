import { describe, expect, it } from "vitest";
import { readPresetBundle, readPresetBundleList } from "../../src/domain/presets/bundleMigration";
import { toPersistedRegexScript } from "../../src/domain/regex/regexScriptIdentity";
import { buildPresetBundleSnapshot } from "../../src/application/useCases/presetBundleLifecycle";
import type { PromptConfig, RegexScript, SamplerPreset } from "../../src/types";

/**
 * 读取边界的降级契约（`CHANGE-SAFE`）：能读就不能失效，且不得静默丢用户数据。
 *
 * 覆盖两类真实缺陷：
 * 1. 正则脚本里出现实体契约之外的字段（编辑器曾把 `scope` 一起写进对象）时，
 *    旧实现会让**整条正则轨道**在末级降级里被清空；
 * 2. 单条记录的 `id` 超出实体契约长度时，旧实现让整份列表读取抛错。
 */

const validScript = {
  id: "reg_1",
  scriptName: "思维链折叠",
  findRegex: "/<thinking>/g",
  replaceString: "\n```\n",
  disabled: false,
  placement: [2],
};

const v3Record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 3,
  id: "bundle_1",
  sampler: { id: "preset_1", name: "我的预设" },
  promptConfig: { mainPrompt: "MAIN" },
  regexScripts: [],
  ...overrides,
});

const fullPromptConfig = (overrides: Partial<PromptConfig> = {}): PromptConfig => ({
  mainPrompt: "MAIN",
  jailbreakPrompt: "JAIL",
  useJailbreak: false,
  instructTemplate: "default",
  systemPrefix: "",
  systemSuffix: "",
  userPrefix: "",
  userSuffix: "",
  assistantPrefix: "",
  assistantSuffix: "",
  ...overrides,
});

const fullSamplerPreset = (overrides: Partial<SamplerPreset> = {}): SamplerPreset => ({
  id: "preset_1",
  name: "我的预设",
  temperature: 0.8,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.05,
  maxTokens: 600,
  ...overrides,
});

describe("预设读取边界：正则脚本逐条收口", () => {
  it("单个脚本带未知字段时，整条轨道保留，只剔除该字段并留下诊断", () => {
    const result = readPresetBundle(v3Record({
      regexScripts: [{ ...validScript, scope: "preset" }],
    }));

    expect(result).not.toBeNull();
    expect(result?.bundle.regexScripts).toHaveLength(1);
    expect(result?.bundle.regexScripts[0]).toMatchObject({ id: "reg_1", scriptName: "思维链折叠" });
    expect(result?.bundle.regexScripts[0]).not.toHaveProperty("scope");
    expect(result?.diagnostics).toContainEqual({
      code: "preset.bundle.regex-script-fields-dropped",
      detail: "0:scope",
    });
  });

  it("未知字段不会连坐同轨的其他脚本（兄弟条目不被牺牲）", () => {
    const result = readPresetBundle(v3Record({
      regexScripts: [
        { ...validScript, scope: "preset" },
        { ...validScript, id: "reg_2", scriptName: "第二条" },
      ],
    }));

    expect(result?.bundle.regexScripts.map((script) => script.id)).toEqual(["reg_1", "reg_2"]);
  });

  it("字段类型不符时逐字段丢弃，脚本本身保留", () => {
    const result = readPresetBundle(v3Record({
      regexScripts: [{ ...validScript, minDepth: "0" }],
    }));

    expect(result?.bundle.regexScripts).toHaveLength(1);
    expect(result?.bundle.regexScripts[0]).not.toHaveProperty("minDepth");
  });

  it("非对象条目按条丢弃并留诊断，其余脚本不受影响", () => {
    const result = readPresetBundle(v3Record({
      regexScripts: [null, validScript],
    }));

    expect(result?.bundle.regexScripts.map((script) => script.id)).toEqual(["reg_1"]);
    expect(result?.diagnostics).toContainEqual({
      code: "preset.bundle.regex-script-dropped",
      detail: "0:null",
    });
  });
});

describe("预设读取边界：单条脏记录不得让整份列表失效", () => {
  it("id 超长的记录被丢弃，同列表其余预设正常返回", () => {
    const list = readPresetBundleList([
      v3Record({ id: "bundle_good" }),
      v3Record({ id: "x".repeat(201) }),
    ]);

    expect(list.bundles.map((bundle) => bundle.id)).toEqual(["bundle_good"]);
    expect(list.diagnostics).toContainEqual({
      code: "preset.bundle.invalid-record",
      detail: "object",
    });
  });

  it.each([
    ["非数组", { id: "bundle_1" }],
    ["数组内含 null/数组/字符串", [null, [], "x", 42]],
    ["缺少 id", [{ schemaVersion: 3, sampler: { id: "p", name: "n" }, promptConfig: {}, regexScripts: [] }]],
    ["id 为空串", [v3Record({ id: "   " })]],
    ["采样与正则整块类型错误", [v3Record({ sampler: "broken", regexScripts: "broken", promptConfig: ["x"] })]],
  ])("%s 时不抛错，只留诊断", (_label, raw) => {
    expect(() => readPresetBundleList(raw)).not.toThrow();
    const list = readPresetBundleList(raw);
    expect(list.diagnostics.length).toBeGreaterThan(0);
  });

  it("读取面永不抛错：任意嵌套垃圾输入都被降级处理", () => {
    const hostile = [
      v3Record({ regexScripts: [{ id: 1, scriptName: {}, findRegex: [], placement: [{}, "2"] }] }),
      { schemaVersion: "3", id: "bundle_x", preset: 42 },
      { id: "bundle_y", promptPlan: { composition: { blocks: null } } },
    ];
    expect(() => readPresetBundleList(hostile)).not.toThrow();
  });
});

describe("预设正则的持久化形态", () => {
  it("toPersistedRegexScript 剥离编辑器字段，保留实体字段与身份 id", () => {
    const persisted = toPersistedRegexScript({ ...validScript, scope: "preset" });

    expect(persisted).toEqual(validScript);
    expect(persisted).not.toHaveProperty("scope");
  });

  it("修复前的脏快照（含 scope）经存储往返后仍保留全部脚本", () => {
    // 模拟历史数据：修复前 UI 把编辑器字段写进了预设快照。
    const pollutedScript = { ...validScript, scope: "preset" } as unknown as RegexScript;
    const polluted = buildPresetBundleSnapshot(
      {
        preset: fullSamplerPreset(),
        promptConfig: fullPromptConfig(),
        presetRegexScripts: [pollutedScript],
      },
      { id: "bundle_1" },
    ) as unknown as Record<string, unknown>;

    const roundTripped = JSON.parse(JSON.stringify(polluted)) as unknown;
    const read = readPresetBundle(roundTripped);

    expect(read?.bundle.regexScripts).toHaveLength(1);
    expect(read?.migrated).toBe(true);
  });

  it("干净快照经存储往返保持原样且不产生迁移写入", () => {
    const snapshot = buildPresetBundleSnapshot(
      {
        preset: fullSamplerPreset(),
        promptConfig: fullPromptConfig(),
        presetRegexScripts: [validScript],
      },
      { id: "bundle_1" },
    );
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as unknown;

    const read = readPresetBundle(roundTripped);

    expect(read?.migrated).toBe(false);
    expect(read?.bundle.regexScripts).toEqual([validScript]);
  });
});
