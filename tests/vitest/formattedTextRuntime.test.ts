import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  parseSafeHtmlToReact,
  preprocessFormattedText,
} from "../../src/components/formatted-text/renderingRuntime";

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

  it("保留预设折叠卡片的 <details>/<summary>，并按布尔值处理 open", () => {
    // 双星纪等预设的 CoT 美化用 <details class="jdg"><summary>…</summary>…</details>
    // 产出可折叠思维块；被白名单拆壳时用户看到的就是"正则没生效、思维内容裸露"。
    const content = parseSafeHtmlToReact(
      '<details class="jdg" open><summary>思考过程</summary><p>内部思考</p></details>',
      false,
      false,
      null,
      0,
      true,
      true,
      undefined,
      null,
      "isolated",
    );
    const { container } = render(React.createElement(React.Fragment, null, content));
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("思考过程");
    expect(container.querySelector("details p")?.textContent).toBe("内部思考");
  });
});
