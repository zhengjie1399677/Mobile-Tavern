import { describe, expect, it } from "vitest";
import { parseReplyChoices, parseSuggestions } from "../../src/hooks/useChat/helpers/suggestions";

describe("结构化回复选择协议", () => {
  it("只保留原生选择字段", () => {
    const choices = parseReplyChoices(JSON.stringify({
      choices: [
        {
          id: "warm<script>",
          label: "温和回应",
          prompt: "微笑着回应对方",
          description: "情感 / 合作",
          onClick: "executeSomething()",
        },
        { label: "观察", value: "观察四周" },
      ],
      script: "alert(1)",
    }));
    expect(choices).toEqual([
      {
        id: "warmscript",
        label: "温和回应",
        prompt: "微笑着回应对方",
        description: "情感 / 合作",
      },
      { id: "choice-2", label: "观察", prompt: "观察四周" },
    ]);
  });

  it("旧字符串数组仍按原语义兼容", () => {
    const raw = '["继续剧情", "谨慎观察"]';
    expect(parseSuggestions(raw)).toEqual(["继续剧情", "谨慎观察"]);
    expect(parseReplyChoices(raw).map((choice) => choice.prompt)).toEqual(["继续剧情", "谨慎观察"]);
  });
});
