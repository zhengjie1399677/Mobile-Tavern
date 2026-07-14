/**
 * catbotResponses 单元测试
 *
 * 覆盖数据完整性、缓存读写、默认值降级
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_CAT_RESPONSES,
  getResponsesCache,
  setResponsesCache,
} from "../../src/utils/catbotResponses";

describe("catbotResponses 数据完整性", () => {
  it("DEFAULT_CAT_RESPONSES 包含所有必要的事件类型", () => {
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("idle_click");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("idle_timeout");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("night_mode");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("api_error");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("character_imported");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("character_created");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("lorebook_imported");
    expect(DEFAULT_CAT_RESPONSES).toHaveProperty("cloud_fallback");
  });

  it("idle_click 是非空字符串数组", () => {
    expect(Array.isArray(DEFAULT_CAT_RESPONSES.idle_click)).toBe(true);
    expect(DEFAULT_CAT_RESPONSES.idle_click.length).toBeGreaterThan(5);
    DEFAULT_CAT_RESPONSES.idle_click.forEach((msg: string) => {
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    });
  });

  it("idle_timeout 至少有 1 条消息", () => {
    expect(DEFAULT_CAT_RESPONSES.idle_timeout.length).toBeGreaterThan(0);
  });

  it("night_mode 至少有 1 条消息", () => {
    expect(DEFAULT_CAT_RESPONSES.night_mode.length).toBeGreaterThan(0);
  });

  it("api_error 至少有 1 条消息", () => {
    expect(DEFAULT_CAT_RESPONSES.api_error.length).toBeGreaterThan(0);
  });

  it("cloud_fallback 是对象且含必要字段", () => {
    expect(typeof DEFAULT_CAT_RESPONSES.cloud_fallback).toBe("object");
    expect(DEFAULT_CAT_RESPONSES.cloud_fallback).toHaveProperty("welcome");
    expect(DEFAULT_CAT_RESPONSES.cloud_fallback).toHaveProperty("offline");
    expect(DEFAULT_CAT_RESPONSES.cloud_fallback).toHaveProperty("error_guidance");
  });

  it("所有消息均为中文（包含'喵'字特征）", () => {
    const allMessages = [
      ...DEFAULT_CAT_RESPONSES.idle_click,
      ...DEFAULT_CAT_RESPONSES.idle_timeout,
      ...DEFAULT_CAT_RESPONSES.night_mode,
      ...DEFAULT_CAT_RESPONSES.api_error,
      ...DEFAULT_CAT_RESPONSES.character_imported,
      ...DEFAULT_CAT_RESPONSES.character_created,
      ...DEFAULT_CAT_RESPONSES.lorebook_imported,
    ];
    // 至少 80% 的消息包含"喵"字
    const meowCount = allMessages.filter((m: string) => m.includes("喵")).length;
    expect(meowCount / allMessages.length).toBeGreaterThan(0.8);
  });
});

describe("catbotResponses 缓存读写", () => {
  beforeEach(() => {
    // 恢复默认缓存
    setResponsesCache(DEFAULT_CAT_RESPONSES);
  });

  it("getResponsesCache 返回当前缓存", () => {
    const cache = getResponsesCache();
    expect(cache).toBe(DEFAULT_CAT_RESPONSES);
  });

  it("setResponsesCache 覆盖缓存", () => {
    const customData = {
      idle_click: ["自定义消息"],
    };
    setResponsesCache(customData);
    expect(getResponsesCache()).toBe(customData);
    expect(getResponsesCache().idle_click).toEqual(["自定义消息"]);
  });

  it("setResponsesCache 可设置为 null 并降级", () => {
    setResponsesCache(null as any);
    expect(getResponsesCache()).toBeNull();
  });

  it("setResponsesCache 可设置为空对象", () => {
    setResponsesCache({});
    const cache = getResponsesCache();
    expect(cache).toEqual({});
    expect(cache.idle_click).toBeUndefined();
  });

  it("恢复默认缓存后数据一致", () => {
    const customData = { test: true };
    setResponsesCache(customData);
    setResponsesCache(DEFAULT_CAT_RESPONSES);
    expect(getResponsesCache()).toBe(DEFAULT_CAT_RESPONSES);
    expect(getResponsesCache().idle_click.length).toBeGreaterThan(5);
  });
});
