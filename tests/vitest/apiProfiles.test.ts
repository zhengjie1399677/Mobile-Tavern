/**
 * API 通道档案投影/脏检查单测（2026-10-06 修复“两条档案看起来被合并”缺陷的回归）。
 *
 * 覆盖：
 *  - 字段清单与 `pickApiProfileFields` 的字面量必须一致（防止两处清单漂移）
 *  - 投影只覆盖档案字段，表单专属字段（历史地址 / 上下文上限 / 发送名称）保持不变
 *  - `isApiProfileDirty` 只比较档案字段：刚投影必为 false，改了档案字段必为 true
 *  - `createApiProfileFromApi`（另存）从当前表单取全字段
 */
import { describe, expect, it } from "vitest";
import type { ApiConfig, ApiProfile } from "../../src/types";
import {
  API_PROFILE_FIELDS,
  applyApiProfileToApi,
  createApiProfileFromApi,
  isApiProfileDirty,
  pickApiProfileFields,
} from "../../src/domain/api/apiProfiles";

const baseApi: ApiConfig = {
  type: "openai-compat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-form",
  modelName: "deepseek-chat",
  savedUrls: ["https://api.deepseek.com/v1", "https://relay.example.com/v1"],
  contextLimit: 64000,
  sendNames: true,
  chatPath: "/chat/completions",
  reasoningStrength: "auto",
};

const profile: ApiProfile = {
  id: "profile_1",
  name: "DeepSeek 主",
  type: "openai-compat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-profile",
  modelName: "deepseek-reasoner",
  chatPath: "/chat/completions",
  modelsPath: "/models",
  bypassProxy: false,
  reasoningStrength: "high",
  supportsVision: true,
};

describe("API 通道档案投影", () => {
  it("字段清单与 pick 的字段字面量一致", () => {
    expect(Object.keys(pickApiProfileFields(baseApi)).sort()).toEqual([...API_PROFILE_FIELDS].sort());
  });

  it("选择通道只覆盖档案字段，表单专属字段保持不变", () => {
    const next = applyApiProfileToApi(baseApi, profile);

    expect(next.apiKey).toBe("sk-profile");
    expect(next.modelName).toBe("deepseek-reasoner");
    expect(next.reasoningStrength).toBe("high");
    expect(next.supportsVision).toBe(true);
    // 表单专属字段不得被档案清空或覆盖
    expect(next.savedUrls).toEqual(baseApi.savedUrls);
    expect(next.contextLimit).toBe(64000);
    expect(next.sendNames).toBe(true);
    // 档案未声明的字段按历史语义保持 undefined 覆盖
    expect(next.forceBasicParams).toBeUndefined();
  });

  it("另存从当前表单构造档案", () => {
    const created = createApiProfileFromApi(baseApi, "profile_new", "新通道");

    expect(created.id).toBe("profile_new");
    expect(created.name).toBe("新通道");
    expect(created.apiKey).toBe("sk-form");
  });

  it("脏检查只比较档案字段，刚投影必为 false", () => {
    const projected = applyApiProfileToApi(baseApi, profile);
    expect(isApiProfileDirty(projected, profile)).toBe(false);

    expect(isApiProfileDirty({ ...projected, apiKey: "sk-other" }, profile)).toBe(true);
    expect(isApiProfileDirty({ ...projected, baseUrl: "https://relay.example.com/v1" }, profile)).toBe(true);
    expect(isApiProfileDirty({ ...projected, modelName: "gpt-4o" }, profile)).toBe(true);
  });

  it("表单专属字段变化不算未保存", () => {
    const projected = applyApiProfileToApi(baseApi, profile);
    expect(
      isApiProfileDirty(
        { ...projected, savedUrls: ["https://new.example.com/v1"], contextLimit: 128000 },
        profile,
      ),
    ).toBe(false);
  });
});
