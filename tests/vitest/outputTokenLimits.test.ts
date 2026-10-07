import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MIN_PROMPT_TOKEN_BUDGET,
  splitContextBudget,
} from "../../src/domain/api/outputTokenLimits";
import { presetSamplerSchema } from "../../src/domain/presets/contracts";
import { runtimeProfileSamplingSchema } from "../../src/application/runtimeProfiles/agentSettings";
import {
  DEFAULT_SETTINGS,
  MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
} from "../../src/hooks/settings/defaults";

describe("输出长度上限单一来源", () => {
  it("出厂默认十万、可选上限一百万", () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(100_000);
    expect(MAX_OUTPUT_TOKENS).toBe(1_000_000);
  });

  it("出厂预设与默认设置使用同一默认值", () => {
    expect(MOBILE_TAVERN_BASIC_PRESET_BUNDLE.sampler.maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(DEFAULT_SETTINGS.preset.maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("预设实体接受一百万并拒绝超出", () => {
    const sampler = { id: "preset_a", name: "样例预设", maxTokens: MAX_OUTPUT_TOKENS };
    expect(presetSamplerSchema.safeParse(sampler).success).toBe(true);
    expect(presetSamplerSchema.safeParse({ ...sampler, maxTokens: MAX_OUTPUT_TOKENS + 1 }).success).toBe(false);
  });

  it("Agent Profile 采样接受一百万并拒绝超出", () => {
    const sampling = {
      temperature: 0.8,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.05,
      maxTokens: MAX_OUTPUT_TOKENS,
    };
    expect(runtimeProfileSamplingSchema.safeParse(sampling).success).toBe(true);
    expect(runtimeProfileSamplingSchema.safeParse({ ...sampling, maxTokens: MAX_OUTPUT_TOKENS + 1 }).success).toBe(false);
  });

  it("输出预留不会把提示词预算压到保底以下", () => {
    // 常规值：与既有「上下文 − maxTokens」语义逐字一致。
    expect(splitContextBudget(128_000, 100_000)).toEqual({
      outputReservation: 100_000,
      promptBudget: 28_000,
    });
    // 极端值：只预留「上下文 − 保底预算」，提示词仍留有空间。
    expect(splitContextBudget(128_000, MAX_OUTPUT_TOKENS)).toEqual({
      outputReservation: 128_000 - MIN_PROMPT_TOKEN_BUDGET,
      promptBudget: MIN_PROMPT_TOKEN_BUDGET,
    });
    // 上下文小于保底预算：整个窗口留给提示词，不做输出预留。
    expect(splitContextBudget(2_000, 1_000)).toEqual({
      outputReservation: 0,
      promptBudget: 2_000,
    });
  });
});
