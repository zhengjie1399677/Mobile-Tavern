import { describe, expect, it } from "vitest";
import {
  applySillyTavernRegexEngine,
  parseRegexFromString,
  RegexPlacement,
  RegexProvider,
  runRegexScript,
  sanitizeRegexMacro,
  SubstituteFindRegex,
} from "../../src/compatibility/sillytavern/regexEngine";

describe("SillyTavern Regex Engine", () => {
  it("parseRegexFromString 支持标准 /pattern/flags 与普通字符串回退", () => {
    const r1 = parseRegexFromString("/foo\\d+/gi");
    expect(r1).not.toBeNull();
    expect(r1?.test("FOO123")).toBe(true);
    expect(r1?.flags).toBe("gi");

    const r2 = parseRegexFromString("bare-text");
    expect(r2).not.toBeNull();
    expect(r2?.test("BARE-TEXT")).toBe(true);
  });

  it("RegexProvider 实现 LRU 缓存与 lastIndex 清零保护", () => {
    const provider = new RegexProvider(3);
    const r1 = provider.get("/test/g");
    expect(r1).not.toBeNull();
    r1!.test("test");
    expect(r1!.lastIndex).toBe(4);

    // 再次获取同一个正则时，lastIndex 应自动重置为 0
    const r1Second = provider.get("/test/g");
    expect(r1Second?.lastIndex).toBe(0);

    // 填满缓存并验证 LRU 淘汰
    provider.get("/a/g");
    provider.get("/b/g");
    expect(provider.size).toBe(3);

    // 访问 /test/g 使其变活跃
    provider.get("/test/g");

    // 插入第四个，应淘汰最久未访问的 /a/g
    provider.get("/c/g");
    expect(provider.size).toBe(3);
  });

  it("sanitizeRegexMacro 严格转义元字符，防止特殊昵称破坏正则语法", () => {
    const escaped = sanitizeRegexMacro("Alice(Queen)+[King].*?^$");
    expect(escaped).toBe("Alice\\(Queen\\)\\+\\[King\\]\\.\\*\\?\\^\\$");
  });

  it("substituteRegex 支持 NONE(0), RAW(1), ESCAPED(2)", () => {
    // 1. RAW 模式：普通宏替换
    const rawResult = runRegexScript(
      {
        findRegex: "/hello {{char}}/i",
        replaceString: "hi $0",
        substituteRegex: SubstituteFindRegex.RAW,
      },
      "hello Alice",
      { charName: "Alice" },
    );
    expect(rawResult).toBe("hi hello Alice");

    // 2. ESCAPED 模式：角色名带正则特殊字符时不会崩溃且能精准匹配
    const dangerousCharName = "Dr. [Neo] (V2)+";
    const escapedResult = runRegexScript(
      {
        findRegex: "/greeting {{char}}/i",
        replaceString: "Welcome!",
        substituteRegex: SubstituteFindRegex.ESCAPED,
      },
      `greeting ${dangerousCharName}`,
      { charName: dangerousCharName },
    );
    expect(escapedResult).toBe("Welcome!");

    // 3. NONE 模式：不替换 {{char}}，字面量匹配
    const noneResult = runRegexScript(
      {
        findRegex: "/greeting {{char}}/i",
        replaceString: "Matched Literal",
        substituteRegex: SubstituteFindRegex.NONE,
      },
      "greeting {{char}}",
      { charName: "Alice" },
    );
    expect(noneResult).toBe("Matched Literal");
  });

  it("支持 {{match}}, 数字捕获组 $1 与命名捕获组 $<name>", () => {
    const result = runRegexScript(
      {
        findRegex: "/say\\s+(?<word>\\w+)/i",
        replaceString: "Matched: {{match}}, Word: $<word>",
      },
      "say hello",
    );
    expect(result).toBe("Matched: say hello, Word: hello");
  });

  it("支持 trimStrings 过滤修剪捕获组中的指定字符", () => {
    const result = runRegexScript(
      {
        findRegex: "/\\[thought:(.*?)\\]/s",
        replaceString: "Thinking: $1",
        trimStrings: ["SECRET", "private"],
      },
      "[thought: this is a SECRET private plan]",
    );
    expect(result).toBe("Thinking:  this is a   plan");
  });

  it("applySillyTavernRegexEngine 支持深度范围 minDepth 与 maxDepth 过滤", () => {
    const scripts = [
      {
        scriptName: "deep-only",
        findRegex: "/TARGET/g",
        replaceString: "REPLACED",
        minDepth: 2,
        maxDepth: 5,
      },
    ];

    // depth = 0 时跳过
    expect(
      applySillyTavernRegexEngine("TARGET", scripts, { depth: 0 }),
    ).toBe("TARGET");

    // depth = 3 在 [2, 5] 区间内，生效
    expect(
      applySillyTavernRegexEngine("TARGET", scripts, { depth: 3 }),
    ).toBe("REPLACED");

    // depth = 6 时跳过
    expect(
      applySillyTavernRegexEngine("TARGET", scripts, { depth: 6 }),
    ).toBe("TARGET");
  });

  it("applySillyTavernRegexEngine 支持 runOnEdit 编辑态感知", () => {
    const scripts = [
      {
        scriptName: "no-edit",
        findRegex: "/edit-me/g",
        replaceString: "edited",
        runOnEdit: false,
      },
      {
        scriptName: "allow-edit",
        findRegex: "/always-edit/g",
        replaceString: "changed",
        runOnEdit: true,
      },
    ];

    // 非编辑态：全部执行
    expect(
      applySillyTavernRegexEngine("edit-me always-edit", scripts, { isEdit: false }),
    ).toBe("edited changed");

    // 编辑态：runOnEdit: false 的跳过
    expect(
      applySillyTavernRegexEngine("edit-me always-edit", scripts, { isEdit: true }),
    ).toBe("edit-me changed");
  });

  it("applySillyTavernRegexEngine 支持 placement 多位置分流", () => {
    const scripts = [
      {
        scriptName: "user-only",
        findRegex: "/FLAG/g",
        replaceString: "USER",
        placement: [RegexPlacement.USER_INPUT],
      },
      {
        scriptName: "ai-only",
        findRegex: "/FLAG/g",
        replaceString: "AI",
        placement: [RegexPlacement.AI_OUTPUT],
      },
      {
        scriptName: "reasoning-only",
        findRegex: "/FLAG/g",
        replaceString: "THINK",
        placement: [RegexPlacement.REASONING],
      },
    ];

    expect(
      applySillyTavernRegexEngine("FLAG", scripts, { isAiMessage: false }),
    ).toBe("USER");

    expect(
      applySillyTavernRegexEngine("FLAG", scripts, { isAiMessage: true }),
    ).toBe("AI");

    expect(
      applySillyTavernRegexEngine("FLAG", scripts, { placement: RegexPlacement.REASONING }),
    ).toBe("THINK");
  });

  it("applySillyTavernRegexEngine 在 AbortSignal 触发时抛出 AbortError", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      applySillyTavernRegexEngine(
        "test text",
        [{ findRegex: "/test/g", replaceString: "ok" }],
        { signal: controller.signal },
      ),
    ).toThrowError();
  });
});

it("宏值中的美元符号按字面量展开", () => {
  const charName = "A$&B$1";
  expect(runRegexScript({ findRegex: "/{{char}}/g", substituteRegex: 2, replaceString: "{{char}} / <USER>" }, charName, { charName, userName: "$&" })).toBe("A$&B$1 / $&");
});

it("命名组与越界数字组共存时不会替换成偏移量", () => {
  expect(runRegexScript({ findRegex: "/(?<letter>a)/g", replaceString: "$1:$2:$<letter>" }, "xa")).toBe("xa::a");
});

it("同时选择显示与 Prompt 时两者均生效，存储保持原文", () => {
  const scripts = [{ findRegex: "/a/g", replaceString: "b", markdownOnly: true, promptOnly: true }];
  expect(applySillyTavernRegexEngine("a", scripts, { mode: "render" })).toBe("b");
  expect(applySillyTavernRegexEngine("a", scripts, { mode: "prompt" })).toBe("b");
  expect(applySillyTavernRegexEngine("a", scripts, { mode: "store" })).toBe("a");
});
