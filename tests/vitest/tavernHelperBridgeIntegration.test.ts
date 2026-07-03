/**
 * TavernHelper Bridge 集成测试
 *
 * 因 tavernHelperBridge.ts 在模块加载时通过静态初始化块（if typeof window !== "undefined"）
 * 注入大量全局 Mock（window.$、window.z、window.TavernHelper、window.SillyTavern 等），
 * 本测试在 happy-dom 环境（提供完整 window/document）下验证：
 *
 * 1. MVU 脚本预处理 (preprocessScriptContent)：CDN import 替换为本地查找
 * 2. Zod Mock 的 .parse() / .safeParse() 行为（MVU 状态卡依赖此 mock）
 * 3. TavernHelper 全局对象的基本契约
 *
 * 注：_getVariables / _replaceVariables 的完整集成流程由
 *     tests/run_bridge_tests.cjs 的 Node shim 方案覆盖（更轻量）。
 *     本测试聚焦 happy-dom 独有的 window 依赖能力。
 */

import { describe, it, expect, beforeAll } from "vitest";

// ------------------------------------------------------------------
// 模块导入前确认 window 就绪（happy-dom 默认提供）
// ------------------------------------------------------------------

describe("TavernHelper Bridge - Zod Mock (window.z)", () => {
  // window.z 在 tavernHelperBridge 模块加载时由静态初始化块创建
  // happy-dom 下 window 存在，模块 import 会触发初始化

  it("window.z 全局对象存在且可链式调用", async () => {
    // 静态 import 会触发 tavernHelperBridge 的顶层初始化块
    await import("../../src/utils/tavernHelper");

    const z = (window as any).z;
    expect(z).toBeDefined();
    expect(typeof z.string).toBe("function");
    expect(typeof z.number).toBe("function");
    expect(typeof z.object).toBe("function");
  });

  it("z.string().parse() 校验字符串", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    const schema = z.string();
    expect(schema.parse("hello")).toBe("hello");
    expect(() => schema.parse(123)).toThrow();
  });

  it("z.number().parse() 校验数字", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    const schema = z.number();
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse("not a number")).toThrow();
  });

  it("z.object().parse() 校验并默认填充对象", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    const schema = z.object({
      name: z.string().default("无名"),
      hp: z.number().default(100),
    });

    // 完整数据
    const full = schema.parse({ name: "勇士", hp: 80 });
    expect(full).toEqual({ name: "勇士", hp: 80 });

    // 缺字段使用默认值
    const partial = schema.parse({});
    expect(partial).toEqual({ name: "无名", hp: 100 });
  });

  it("z.coerce 系列强制类型转换", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    expect(z.coerce.string().parse(123)).toBe("123");
    expect(z.coerce.number().parse("42")).toBe(42);
    expect(z.coerce.boolean().parse("true")).toBe(true);
    expect(z.coerce.boolean().parse("false")).toBe(false);
  });

  it("safeParse 不抛错返回 { success, data/error }", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    const schema = z.number();
    const ok = schema.safeParse(42);
    expect(ok.success).toBe(true);
    expect(ok.data).toBe(42);

    const fail = schema.safeParse("bad");
    expect(fail.success).toBe(false);
    expect(fail.error).toBeDefined();
  });

  it("z.union() 支持多 schema 联合校验", async () => {
    await import("../../src/utils/tavernHelper");
    const z = (window as any).z;

    const schema = z.union([z.string(), z.number()]);
    expect(schema.parse("text")).toBe("text");
    expect(schema.parse(123)).toBe(123);
    expect(() => schema.parse(true)).toThrow();
  });
});

describe("TavernHelper Bridge - 脚本预处理 (preprocessScriptContent)", () => {
  // preprocessScriptContent 是 MVU iframe 注入前的文本转换，
  // 负责将 CDN import 替换为本地 TavernHelperMvuLibs 查找
  let preprocessScriptContent: (content: string) => string;

  beforeAll(async () => {
    const mod = await import("../../src/utils/tavernHelper");
    preprocessScriptContent = mod.preprocessScriptContent;
  });

  it("将 MVU bundle 本地路径 import 替换为注释（正则期待无后缀路径）", () => {
    // preprocessScriptContent 的 bundle 替换正则匹配 `import "...bundle"` 模式，
    // 不匹配 jsdelivr CDN URL 中的 `bundle/+esm` 后缀
    const input = `import "./mvu_bundle";`;
    const result = preprocessScriptContent(input);
    expect(result).toContain("本地 MVU bundle 已预加载");
    expect(result).not.toContain("./mvu_bundle");
  });

  it("将 mvu_zod CDN import 替换为本地引用", () => {
    const input = `import { registerMvuSchema } from "https://testingcf.jsdelivr.net/npm/mvu_zod/+esm";`;
    const result = preprocessScriptContent(input);
    // 核心断言：jsdelivr CDN 被移除，替换为本地引用
    expect(result).not.toContain("jsdelivr.net");
    expect(result).toContain("registerMvuSchema");
    expect(result).toContain("window");
  });

  it("将 pinia CDN namespace import 替换为 TavernHelperMvuLibs 查找", () => {
    const input = `import * as math from "https://testingcf.jsdelivr.net/npm/mathjs/+esm";`;
    const result = preprocessScriptContent(input);
    expect(result).toContain("TavernHelperMvuLibs.math");
    expect(result).not.toContain("jsdelivr.net");
  });

  it("将 named CDN import 替换为 window.defineMvuDataStore", () => {
    const input = `import { defineMvuDataStore as d } from "https://testingcf.jsdelivr.net/npm/mvu/+esm";`;
    const result = preprocessScriptContent(input);
    expect(result).toContain("defineMvuDataStore: d");
    expect(result).toContain("window.defineMvuDataStore");
    expect(result).not.toContain("jsdelivr.net");
  });

  it("非 CDN 的普通 import 原样保留", () => {
    const input = `import { something } from "./local-module";`;
    const result = preprocessScriptContent(input);
    expect(result).toBe(input);
  });

  it("混合脚本（多个 CDN import + 本地 import）全部正确处理", () => {
    const input = `
import { defineMvuDataStore as d } from "https://testingcf.jsdelivr.net/npm/mvu/+esm";
import * as math from "https://testingcf.jsdelivr.net/npm/mathjs/+esm";
import { registerMvuSchema } from "./mvu_zod";
import { helper } from "./helpers";
const x = 1;
`;
    const result = preprocessScriptContent(input);
    // mvu named import 被替换
    expect(result).not.toContain("jsdelivr.net/npm/mvu/");
    // math namespace import 被替换
    expect(result).not.toContain("jsdelivr.net/npm/mathjs/");
    // mvu_zod 本地 import 被替换为 registerMvuSchema 引用
    expect(result).toContain("registerMvuSchema");
    expect(result).toContain("window");
    // 本地 import 保留
    expect(result).toContain(`import { helper } from "./helpers"`);
    // 普通代码不变
    expect(result).toContain("const x = 1");
  });
});

describe("TavernHelper Bridge - 全局对象契约", () => {
  it("window.TavernHelper 存在且包含核心绑定", async () => {
    await import("../../src/utils/tavernHelper");
    const TH = (window as any).TavernHelper;
    expect(TH).toBeDefined();
    expect(TH._bind).toBeDefined();
    expect(typeof TH.getVariables).toBe("function");
    expect(typeof TH.replaceVariables).toBe("function");
    expect(typeof TH.getCharacter).toBe("function");
    expect(typeof TH.getChatMessages).toBe("function");
  });

  it("window.SillyTavern 存在且可获取 extensionSettings", async () => {
    await import("../../src/utils/tavernHelper");
    const ST = (window as any).SillyTavern;
    expect(ST).toBeDefined();
    // 默认返回空对象
    expect(ST.extensionSettings).toEqual({});
  });

  it("window.Mvu 存在且暴露 getMvuData / replaceMvuData", async () => {
    await import("../../src/utils/tavernHelper");
    const Mvu = (window as any).Mvu;
    expect(Mvu).toBeDefined();
    expect(typeof Mvu.getMvuData).toBe("function");
    expect(typeof Mvu.replaceMvuData).toBe("function");
    expect(typeof Mvu.parseMessage).toBe("function");
  });
});
