import { describe, expect, it } from "vitest";
import type { CustomPromptBlock, PromptConfig } from "../../src/types";
import type { PromptBlock, PromptComposition } from "../../src/domain/prompt-composition";
import {
  applyLegacyPromptRemoval,
  applyLegacyPromptSwitch,
  legacyPromptSwitchKey,
  mirrorPromptSwitches,
  removeCompositionBlocks,
  syncCustomPromptSwitches,
  type PromptSwitchSnapshot,
} from "../../src/application/useCases/promptSwitchSync";

/**
 * 列表（customPrompts）与自由编排（composition.blocks）是同一批条目的两种视图。
 * 用户侧的可见症状是"关了子条目请求里还带着它""编排里删了列表还留着"
 * 以及"编排里关了列表还显示开启"。
 */

function customPrompt(id: string, enabled: boolean, identifier?: string): CustomPromptBlock {
  return {
    id,
    ...(identifier ? { identifier } : {}),
    name: id,
    role: "system",
    content: `${id} 内容`,
    enabled,
  };
}

function block(id: string, enabled: boolean, originalIdentifier?: string): PromptBlock {
  return {
    id,
    name: id,
    enabled,
    role: "system",
    source: { type: "template" },
    template: `${id} 模板`,
    order: 100,
    placement: { type: "ordered" },
    ...(originalIdentifier
      ? { compatibility: { source: "sillytavern", originalIdentifier } }
      : {}),
  };
}

function composition(blocks: PromptBlock[]): PromptComposition {
  return { id: "composition_fixture", name: "夹具编排", version: 1, blocks };
}

function promptConfig(overrides: Partial<PromptConfig> = {}): PromptConfig {
  return {
    mainPrompt: "主指令",
    composition: composition([block("st_main", true, "main"), block("st_jailbreak", true, "jailbreak")]),
    customPrompts: [customPrompt("main", true, "main"), customPrompt("jailbreak", true, "jailbreak")],
    ...overrides,
  } as PromptConfig;
}

function snapshot(overrides: Partial<PromptSwitchSnapshot> = {}): PromptSwitchSnapshot {
  const config = promptConfig();
  return {
    composition: config.composition as PromptComposition,
    customPrompts: config.customPrompts as CustomPromptBlock[],
    ...overrides,
  };
}

function toggledComposition(
  base: PromptComposition,
  ids: readonly string[],
  enabled: boolean,
): PromptComposition {
  return composition(base.blocks.map((item) => ids.includes(item.id) ? { ...item, enabled } : item));
}

describe("promptSwitchSync 开关同步", () => {
  it("同步键与编排区块生成侧保持一致（identifier 优先，回退 id）", () => {
    expect(legacyPromptSwitchKey(customPrompt("a", true, "identifier_a"))).toBe("identifier_a");
    expect(legacyPromptSwitchKey(customPrompt("a", true))).toBe("a");
    expect(legacyPromptSwitchKey(customPrompt("a", true, ""))).toBe("a");
  });

  it("列表侧关闭子条目时同步关闭同源编排区块", () => {
    const next = applyLegacyPromptSwitch(promptConfig(), "jailbreak", false);

    expect(next.customPrompts?.find((item) => item.id === "jailbreak")?.enabled).toBe(false);
    expect(next.composition?.blocks.find((item) => item.id === "st_jailbreak")?.enabled).toBe(false);
    // 未触及的条目必须原样保留。
    expect(next.composition?.blocks.find((item) => item.id === "st_main")?.enabled).toBe(true);
    expect(next.customPrompts?.find((item) => item.id === "main")?.enabled).toBe(true);
  });

  it("列表侧同步不依赖编排是否启用，避免先改列表再启用编排时状态丢失", () => {
    const config = promptConfig({ usePromptComposition: false });
    const next = applyLegacyPromptSwitch(config, "jailbreak", false);

    expect(next.composition?.blocks.find((item) => item.id === "st_jailbreak")?.enabled).toBe(false);
  });

  it("列表侧条目没有同源区块时只改列表", () => {
    const config = promptConfig({ customPrompts: [customPrompt("lonely", true)] });
    const next = applyLegacyPromptSwitch(config, "lonely", false);

    expect(next.customPrompts?.find((item) => item.id === "lonely")?.enabled).toBe(false);
    expect(next.composition).toBe(config.composition);
  });

  it("编排整体写入：仅有开关变化时回写列表（编辑器开关与撤销/重做走同一路径）", () => {
    const config = promptConfig();
    const next = toggledComposition(config.composition as PromptComposition, ["st_jailbreak"], false);

    const list = syncCustomPromptSwitches(
      config.customPrompts as CustomPromptBlock[],
      config.composition,
      next,
    );

    expect(list.find((item) => item.id === "jailbreak")?.enabled).toBe(false);
    expect(list.find((item) => item.id === "main")?.enabled).toBe(true);
  });

  it("编排整体写入：结构变更（增删/排序/改模板）不回写列表", () => {
    const config = promptConfig();
    const blocks = (config.composition as PromptComposition).blocks;
    const variants = [
      composition([...blocks, block("st_extra", false, "extra")]),
      composition([{ ...blocks[1], order: 100 }, { ...blocks[0], order: 200 }]),
      composition(blocks.map((item) => item.id === "st_jailbreak" ? { ...item, template: "改过的模板" } : item)),
    ];

    for (const next of variants) {
      const list = syncCustomPromptSwitches(config.customPrompts as CustomPromptBlock[], config.composition, next);
      expect(list).toBe(config.customPrompts);
    }
  });

  it("编排整体写入：方向不一致（同时开又关）时不回写列表，避免半边生效", () => {
    const base = composition([block("st_main", true, "main"), block("st_jailbreak", false, "jailbreak")]);
    const config = promptConfig({
      composition: base,
      customPrompts: [customPrompt("main", true, "main"), customPrompt("jailbreak", false, "jailbreak")],
    });
    const flipped = composition([
      { ...base.blocks[0], enabled: false },
      { ...base.blocks[1], enabled: true },
    ]);

    const list = syncCustomPromptSwitches(config.customPrompts as CustomPromptBlock[], base, flipped);

    expect(list).toBe(config.customPrompts);
  });

  it("编排整体写入：多个区块同向变化时列表一并同步", () => {
    const config = promptConfig();
    const disabled = toggledComposition(config.composition as PromptComposition, ["st_main", "st_jailbreak"], false);

    const list = syncCustomPromptSwitches(config.customPrompts as CustomPromptBlock[], config.composition, disabled);

    expect(list.every((item) => item.enabled === false)).toBe(true);
  });

  it("切换模式时把旧视图状态镜像进即将生效的视图", () => {
    const config = promptConfig();

    const toComposition = mirrorPromptSwitches(
      { ...config, customPrompts: [customPrompt("main", false, "main"), customPrompt("jailbreak", true, "jailbreak")] },
      "to-composition",
    );
    expect(toComposition.composition?.blocks.find((item) => item.id === "st_main")?.enabled).toBe(false);
    expect(toComposition.composition?.blocks.find((item) => item.id === "st_jailbreak")?.enabled).toBe(true);

    const toLegacy = mirrorPromptSwitches(
      { ...config, composition: composition([block("st_main", true, "main"), block("st_jailbreak", false, "jailbreak")]) },
      "to-legacy",
    );
    expect(toLegacy.customPrompts?.find((item) => item.id === "main")?.enabled).toBe(true);
    expect(toLegacy.customPrompts?.find((item) => item.id === "jailbreak")?.enabled).toBe(false);
  });

  it("状态一致时不产生新对象，避免无谓的设置写入", () => {
    const config = promptConfig();
    expect(mirrorPromptSwitches(config, "to-composition")).toBe(config);
    expect(mirrorPromptSwitches(config, "to-legacy")).toBe(config);
    expect(applyLegacyPromptSwitch(config, "不存在的条目", false)).toBe(config);
    expect(syncCustomPromptSwitches(
      config.customPrompts as CustomPromptBlock[],
      config.composition as PromptComposition,
      config.composition as PromptComposition,
    )).toBe(config.customPrompts);
  });
});

describe("promptSwitchSync 删除连带", () => {
  it("删除编排区块时同源列表条目一并删除", () => {
    const current = snapshot();
    const next = removeCompositionBlocks(current, ["st_jailbreak"]);

    expect(next.composition.blocks.map((item) => item.id)).toEqual(["st_main"]);
    expect(next.customPrompts.map((item) => item.id)).toEqual(["main"]);
  });

  it("删除无同源条目的编排区块（MT 原生块）只删区块", () => {
    const current = snapshot({
      composition: composition([block("example_main", true), block("st_main", true, "main")]),
      customPrompts: [customPrompt("main", true, "main")],
    });
    const next = removeCompositionBlocks(current, ["example_main"]);

    expect(next.composition.blocks.map((item) => item.id)).toEqual(["st_main"]);
    expect(next.customPrompts).toBe(current.customPrompts);
  });

  it("删除不存在的区块返回原快照，不产生无谓写入", () => {
    const current = snapshot();
    expect(removeCompositionBlocks(current, ["missing"])).toBe(current);
    expect(removeCompositionBlocks(current, [])).toBe(current);
  });

  it("删除列表条目时同源编排区块一并删除", () => {
    const next = applyLegacyPromptRemoval(promptConfig(), ["jailbreak"]);

    expect(next.customPrompts?.map((item) => item.id)).toEqual(["main"]);
    expect(next.composition?.blocks.map((item) => item.id)).toEqual(["st_main"]);
  });

  it("批量删除列表条目时逐条匹配同源区块", () => {
    const next = applyLegacyPromptRemoval(promptConfig(), ["main", "jailbreak"]);

    expect(next.customPrompts).toEqual([]);
    expect(next.composition?.blocks).toEqual([]);
  });

  it("删除没有对应列表条目的选中项（界面上内置主指令等伪条目）不改变任何数据", () => {
    const config = promptConfig();
    expect(applyLegacyPromptRemoval(config, ["built-in-main-prompt"])).toBe(config);
    expect(applyLegacyPromptRemoval(config, [])).toBe(config);
  });

  it("删除列表条目时同步清理场景方案里对同源区块的开关覆盖", () => {
    const config = promptConfig({
      composition: {
        ...(promptConfig().composition as PromptComposition),
        sceneProfiles: [{ id: "scene", name: "场景", blockStates: { st_main: true, st_jailbreak: true } }],
      },
    });
    const next = applyLegacyPromptRemoval(config, ["jailbreak"]);

    expect(next.composition?.sceneProfiles?.[0].blockStates).toEqual({ st_main: true });
  });
});
