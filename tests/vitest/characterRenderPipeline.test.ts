/**
 * 角色渲染管线纯函数 computeRenderState 单元测试。
 *
 * 覆盖：
 *   - 数组式 / 字典式 expressions 匹配
 *   - 无文本回退、匹配失败回退
 *   - glowColors 情绪配色（joy/sad/anger/blush/默认）
 *   - 无角色卡边界
 */
import { describe, it, expect } from "vitest";
import { computeRenderState, PipelineInput } from "../../src/services/characterRender/pipeline";

function makeInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    lastAssistantText: "",
    character: null,
    expressionTriggers: {},
    ...overrides,
  };
}

describe("computeRenderState — 无角色卡边界", () => {
  it("character 为 null 时返回默认情绪、空立绘、默认光晕", () => {
    const result = computeRenderState(makeInput({ character: null }));
    expect(result.emotion).toBe("默认");
    expect(result.portraitBase64).toBe("");
    expect(result.glowColors.light1).toBe("rgba(167, 139, 250, 0.28)");
    expect(result.glowColors.light2).toBe("rgba(34, 211, 238, 0.16)");
  });

  it("character 为 undefined 时同样安全降级", () => {
    const result = computeRenderState(makeInput({ character: undefined as any }));
    expect(result.emotion).toBe("默认");
    expect(result.portraitBase64).toBe("");
  });
});

describe("computeRenderState — avatar 回退", () => {
  it("有 avatar 无 expressions 时返回 avatar + 默认情绪", () => {
    const result = computeRenderState(
      makeInput({ character: { avatar: "data:image/png;base64,xxx" } as any })
    );
    expect(result.emotion).toBe("默认");
    expect(result.portraitBase64).toBe("data:image/png;base64,xxx");
  });
});

describe("computeRenderState — 数组式 expressions", () => {
  const arrayCharacter = {
    avatar: "default-avatar.png",
    visualSettings: {
      expressions: [
        { name: "default", image: "default.png", triggers: "" },
        { name: "joy", image: "joy.png", triggers: "开心|快乐|笑" },
        { name: "anger", image: "anger.png", triggers: "生气|愤怒" },
      ],
    },
  };

  it("无文本时回退 default 表情", () => {
    const result = computeRenderState(makeInput({ character: arrayCharacter as any }));
    expect(result.emotion).toBe("default");
    expect(result.portraitBase64).toBe("default.png");
  });

  it("文本匹配触发词时返回对应表情", () => {
    const result = computeRenderState(
      makeInput({ lastAssistantText: "她开心地笑了", character: arrayCharacter as any })
    );
    expect(result.emotion).toBe("joy");
    expect(result.portraitBase64).toBe("joy.png");
  });

  it("文本匹配 anger 触发词", () => {
    const result = computeRenderState(
      makeInput({ lastAssistantText: "他生气了", character: arrayCharacter as any })
    );
    expect(result.emotion).toBe("anger");
    expect(result.portraitBase64).toBe("anger.png");
  });

  it("匹配失败时回退 default", () => {
    const result = computeRenderState(
      makeInput({ lastAssistantText: "今天天气不错", character: arrayCharacter as any })
    );
    expect(result.emotion).toBe("default");
    expect(result.portraitBase64).toBe("default.png");
  });

  it("无 default 项时回退首项", () => {
    const charNoDefault = {
      avatar: "avatar.png",
      visualSettings: {
        expressions: [
          { name: "joy", image: "joy.png", triggers: "开心" },
          { name: "sad", image: "sad.png", triggers: "难过" },
        ],
      },
    };
    const result = computeRenderState(
      makeInput({ lastAssistantText: "", character: charNoDefault as any })
    );
    expect(result.emotion).toBe("joy");
    expect(result.portraitBase64).toBe("joy.png");
  });
});

describe("computeRenderState — 字典式 expressions", () => {
  const dictCharacter = {
    avatar: "avatar.png",
    extensions: {
      expressions: {
        default: "default.png",
        joy: "joy.png",
        sad: "sad.png",
      },
    },
  };
  const triggers = {
    joy: "开心|快乐",
    sad: "难过|哭泣",
  };

  it("无文本时回退 default 键", () => {
    const result = computeRenderState(
      makeInput({
        character: dictCharacter as any,
        expressionTriggers: triggers,
      })
    );
    expect(result.emotion).toBe("default");
    expect(result.portraitBase64).toBe("default.png");
  });

  it("文本匹配 presetTriggers 时返回对应表情", () => {
    const result = computeRenderState(
      makeInput({
        lastAssistantText: "她很开心",
        character: dictCharacter as any,
        expressionTriggers: triggers,
      })
    );
    expect(result.emotion).toBe("joy");
    expect(result.portraitBase64).toBe("joy.png");
  });

  it("无 default 键时回退 normal/首项", () => {
    const charNoDefault = {
      avatar: "avatar.png",
      extensions: {
        expressions: {
          joy: "joy.png",
          angry: "angry.png",
        },
      },
    };
    const result = computeRenderState(
      makeInput({
        lastAssistantText: "",
        character: charNoDefault as any,
        expressionTriggers: {},
      })
    );
    // 无 default/neutral/normal，回退首项（Object.keys 顺序）
    expect(result.portraitBase64).toBe("joy.png");
  });
});

describe("computeRenderState — glowColors 情绪配色", () => {
  it("joy 类情绪 → 粉金光晕", () => {
    const result = computeRenderState(
      makeInput({
        character: {
          visualSettings: {
            expressions: [
              { name: "joy", image: "joy.png", triggers: "开心" },
            ],
          },
        } as any,
        lastAssistantText: "开心",
      })
    );
    expect(result.glowColors.light1).toBe("rgba(244, 63, 94, 0.48)");
    expect(result.glowColors.light2).toBe("rgba(251, 191, 36, 0.24)");
  });

  it("sad 类情绪 → 冷蓝光晕", () => {
    const result = computeRenderState(
      makeInput({
        character: {
          visualSettings: {
            expressions: [
              { name: "sad", image: "sad.png", triggers: "难过" },
            ],
          },
        } as any,
        lastAssistantText: "难过",
      })
    );
    expect(result.glowColors.light1).toBe("rgba(59, 130, 246, 0.48)");
    expect(result.glowColors.light2).toBe("rgba(167, 139, 250, 0.22)");
  });

  it("anger 类情绪 → 深红光晕", () => {
    const result = computeRenderState(
      makeInput({
        character: {
          visualSettings: {
            expressions: [
              { name: "anger", image: "anger.png", triggers: "生气" },
            ],
          },
        } as any,
        lastAssistantText: "生气",
      })
    );
    expect(result.glowColors.light1).toBe("rgba(239, 68, 68, 0.48)");
    expect(result.glowColors.light2).toBe("rgba(251, 191, 36, 0.22)");
  });

  it("blush 类情绪 → 深紫光晕", () => {
    const result = computeRenderState(
      makeInput({
        character: {
          visualSettings: {
            expressions: [
              { name: "blush", image: "blush.png", triggers: "害羞" },
            ],
          },
        } as any,
        lastAssistantText: "害羞",
      })
    );
    expect(result.glowColors.light1).toBe("rgba(236, 72, 153, 0.48)");
    expect(result.glowColors.light2).toBe("rgba(167, 139, 250, 0.22)");
  });

  it("默认情绪 → 紫青光晕", () => {
    const result = computeRenderState(makeInput({ character: { avatar: "a.png" } as any }));
    expect(result.glowColors.light1).toBe("rgba(167, 139, 250, 0.28)");
    expect(result.glowColors.light2).toBe("rgba(34, 211, 238, 0.16)");
  });
});
