import { describe, expect, it } from "vitest";
import { buildSillyTavernWorldInfoNodes } from "../../src/application/runtimePlugins/sillyTavernCompatibilityRuntimePlugin";
import type { LorebookEntry } from "../../src/types";

function entry(id: string, overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id,
    keys: [],
    content: id,
    constant: false,
    enabled: true,
    ...overrides,
  };
}

const format = (item: LorebookEntry) => item.content;

describe("SillyTavern 世界书 Prompt 分块", () => {
  it("常规位置仍归入角色卡前后两个上下文块", () => {
    const nodes = buildSillyTavernWorldInfoNodes(
      [
        entry("前置", { position: "before_char_def" }),
        entry("最顶", { position: "top" }),
        entry("后置", { position: "after_char_def" }),
      ],
      format,
    );

    expect(nodes.map((node) => node.id)).toEqual([
      "sillytavern_world_info_before_char_def",
      "sillytavern_world_info_after_char_def",
    ]);
    expect(nodes[0].priority).toBe("High");
    expect(nodes[0].content).toBe("前置\n\n最顶");
  });

  it("atDepth 条目按深度与角色单独成节点，不再混进上下文档", () => {
    const nodes = buildSillyTavernWorldInfoNodes(
      [
        entry("注入", {
          position: "in_chat",
          depth: 3,
          sourceMetadata: { role: 1 },
        }),
      ],
      format,
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "sillytavern_world_info_depth_3:user",
      content: "注入",
      metadata: {
        compatibility: "sillytavern",
        position: "in_chat",
        depth: 3,
        role: "user",
      },
    });
  });

  it("把 ST 数字角色映射为 prompt role，缺省回落 system", () => {
    const roles = [0, 1, 2, undefined].map((role) => {
      const nodes = buildSillyTavernWorldInfoNodes(
        [entry(`条目${String(role)}`, {
          position: "in_chat",
          sourceMetadata: role === undefined ? {} : { role },
        })],
        format,
      );
      return nodes[0].metadata?.role;
    });

    expect(roles).toEqual(["system", "user", "assistant", "system"]);
  });

  it("同一深度与角色的条目合并，并按 order 升序拼接", () => {
    const nodes = buildSillyTavernWorldInfoNodes(
      [
        entry("高", { position: "in_chat", depth: 2, order: 200 }),
        entry("低", { position: "in_chat", depth: 2, order: 10 }),
      ],
      format,
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0].content).toBe("低\n\n高");
  });
});
