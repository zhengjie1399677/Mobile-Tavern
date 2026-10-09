import { describe, expect, it } from "vitest";
import type { PresetBundle } from "../../src/domain/presets/contracts";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import {
  createPresetCatalog,
  deletePresetBundle,
  deletePresetBundles,
  registerPresetBundle,
  savePresetBundleAsNew,
  type PresetCatalogPort,
} from "../../src/application/useCases/presetCatalog";

/**
 * 预设目录用例契约：锁定从 usePresetBundles 下沉到 application 层的列表代数与串行化语义。
 * Hook 侧的调用行为由 tests/vitest/presetSaveEffectiveness.test.ts 与组件用例覆盖。
 */

/** 以出厂内置预设为模板生成测试预设包，避免手写完整 PromptConfig。 */
const makeBundle = (id: string, name = id): PresetBundle => {
  const base = (DEFAULT_SETTINGS.savedPresets || [])[0];
  if (!base) throw new Error("DEFAULT_SETTINGS 缺少内置预设，测试模板不可用");
  return {
    ...structuredClone(base),
    id,
    sampler: { ...structuredClone(base.sampler), id: `preset_${id}`, name },
  };
};

const ids = (list: PresetBundle[] | null): string[] => (list ?? []).map((bundle) => bundle.id);

describe("presetCatalog 纯变换", () => {
  it("registerPresetBundle 以 Store 列表为基追加，不改动入参", () => {
    const current = [makeBundle("a")];
    const result = registerPresetBundle(current, makeBundle("b"));

    expect(ids(result.presets)).toEqual(["a", "b"]);
    expect(result.changed).toBe(true);
    expect(ids(current)).toEqual(["a"]);
  });

  it("savePresetBundleAsNew 只追加；给出 replaceBundleId 时才原位覆盖", () => {
    const current = [makeBundle("a"), makeBundle("b")];
    const snapshot = makeBundle("a", "改过的 a");

    // 「另存为新预设」总是用新 id 调用，因此无目标时按旧 Hook 行为直接追加。
    expect(ids(savePresetBundleAsNew(current, snapshot).presets)).toEqual(["a", "b", "a"]);

    const replaced = savePresetBundleAsNew(current, snapshot, { replaceBundleId: "a" });
    expect(ids(replaced.presets)).toEqual(["a", "b"]);
    expect(replaced.presets[0]?.sampler.name).toBe("改过的 a");

    const appended = savePresetBundleAsNew(current, snapshot, { replaceBundleId: "missing" });
    expect(ids(appended.presets)).toEqual(["a", "b", "a"]);
  });

  it("deletePresetBundle / deletePresetBundles 只做机械删除并反馈 changed", () => {
    const current = [makeBundle("a"), makeBundle("b"), makeBundle("c")];

    expect(ids(deletePresetBundle(current, "b").presets)).toEqual(["a", "c"]);
    expect(deletePresetBundle(current, "missing").changed).toBe(false);
    expect(deletePresetBundle(current, "missing").presets).toEqual(current);

    expect(ids(deletePresetBundles(current, ["a", "c"]).presets)).toEqual(["b"]);
    expect(deletePresetBundles(current, []).changed).toBe(false);
    expect(deletePresetBundles(current, []).presets).toEqual(current);
  });
});

describe("presetCatalog 串行读-改-写", () => {
  it("并发变更按入队顺序执行，不丢更新", async () => {
    let store: PresetBundle[] | null = [makeBundle("a")];
    const writes: string[][] = [];
    const port: PresetCatalogPort = {
      read: async () => store,
      write: async (presets) => {
        store = presets;
        writes.push(ids(presets));
      },
    };
    const catalog = createPresetCatalog(port);

    await Promise.all([
      catalog.mutate((current) => registerPresetBundle(current, makeBundle("b"))),
      catalog.mutate((current) => registerPresetBundle(current, makeBundle("c"))),
    ]);

    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(writes).toEqual([["a", "b"], ["a", "b", "c"]]);
  });

  it("Store 无记录时以空列表为基，写库失败不阻断后续变更", async () => {
    let store: PresetBundle[] | null = null;
    const port: PresetCatalogPort = {
      read: async () => store,
      write: async (presets) => {
        if (presets.some((bundle) => bundle.id === "boom")) throw new Error("write failed");
        store = presets;
      },
    };
    const catalog = createPresetCatalog(port);

    await expect(
      catalog.mutate((current) => registerPresetBundle(current, makeBundle("boom"))),
    ).rejects.toThrow("write failed");

    const recovered = await catalog.mutate((current) => registerPresetBundle(current, makeBundle("b")));
    expect(ids(recovered.presets)).toEqual(["b"]);
    expect(ids(store)).toEqual(["b"]);
  });
});
