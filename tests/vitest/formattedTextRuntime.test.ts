import { describe, expect, it } from "vitest";
import { preprocessFormattedText } from "../../src/components/formatted-text/renderingRuntime";

describe("通用文本渲染与 Compatibility Transform 边界", () => {
  it("在基础占位符替换后把文本交给插件 Transform", () => {
    const inputs: string[] = [];
    const result = preprocessFormattedText(
      "{{char}}：{{user}}",
      "角色",
      "用户",
      null,
      false,
      undefined,
      undefined,
      true,
      false,
      null,
      "isolated",
      (value) => {
        inputs.push(value);
        return value.replace("角色", "插件角色");
      },
    );

    expect(inputs).toEqual(["角色：用户"]);
    expect(result).toBe("插件角色：用户");
  });
});
