import { describe, expect, it } from "vitest";
import { parseHeadlessConfig } from "../../headless/config";
import {
  ALL_INTERFACES_HOST,
  buildHeadlessEnvText,
  evaluateHostBinding,
  generateAccessKey,
  isAllInterfacesHost,
  isLoopbackHost,
  normalizeHost,
  parseCorsOrigins,
  parsePortInput,
} from "../../src/utils/hostBindingPolicy";
import {
  normalizeHostBaseUrl,
  testHostConnection,
} from "../../src/application/useCases/hostServiceUseCases";

describe("hostBindingPolicy 监听地址判定", () => {
  it("回环地址识别覆盖大小写与空白", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
    expect(isLoopbackHost("  127.0.0.1  ")).toBe(true);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost(ALL_INTERFACES_HOST)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  it("normalizeHost 统一小写并裁剪", () => {
    expect(normalizeHost("  0.0.0.0 ")).toBe(ALL_INTERFACES_HOST);
    expect(normalizeHost(null)).toBe("");
  });

  it("0.0.0.0 与具体局域网地址区分开", () => {
    expect(isAllInterfacesHost(ALL_INTERFACES_HOST)).toBe(true);
    expect(isAllInterfacesHost("192.168.1.10")).toBe(false);
  });
});

describe("hostBindingPolicy 输入解析", () => {
  it("端口只接受 1~65535 的整数", () => {
    expect(parsePortInput("18080")).toBe(18080);
    expect(parsePortInput(" 1 ")).toBe(1);
    expect(parsePortInput("65535")).toBe(65535);
    expect(parsePortInput("0")).toBeNull();
    expect(parsePortInput("65536")).toBeNull();
    expect(parsePortInput("80.5")).toBeNull();
    expect(parsePortInput("-1")).toBeNull();
    expect(parsePortInput("")).toBeNull();
    expect(parsePortInput("abc")).toBeNull();
  });

  it("CORS 白名单支持中英文逗号、分号与换行", () => {
    expect(parseCorsOrigins("http://a.test, http://b.test")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
    expect(parseCorsOrigins("http://a.test，http://b.test")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
    expect(parseCorsOrigins("http://a.test;http://b.test")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
    expect(parseCorsOrigins("  ")).toEqual([]);
  });

  it("生成的访问凭据长度固定且不重复", () => {
    const first = generateAccessKey();
    const second = generateAccessKey();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(second).not.toBe(first);
  });
});

describe("hostBindingPolicy 评估与启动闸门同源", () => {
  // 这一组是本次改造的核心不变量：界面显示"可以启动"就必须真的能启动。
  const cases: Array<{ host: string; accessKey: string; startable: boolean }> = [
    { host: "127.0.0.1", accessKey: "", startable: true },
    { host: "localhost", accessKey: "", startable: true },
    { host: "::1", accessKey: "", startable: true },
    { host: "192.168.1.10", accessKey: "", startable: false },
    { host: ALL_INTERFACES_HOST, accessKey: "", startable: false },
    { host: "192.168.1.10", accessKey: "x".repeat(32), startable: true },
    { host: ALL_INTERFACES_HOST, accessKey: "x".repeat(32), startable: true },
  ];

  it.each(cases)("$host + key=$accessKey 时界面判定与 headless 闸门一致", ({ host, accessKey, startable }) => {
    const assessment = evaluateHostBinding({
      bindHost: host,
      bindPort: 18080,
      accessKey,
      corsOrigins: [],
    });
    expect(assessment.allowed).toBe(startable);

    let startThrew = false;
    try {
      parseHeadlessConfig({ HEADLESS_HOST: host, HEADLESS_API_KEY: accessKey });
    } catch {
      startThrew = true;
    }
    expect(startThrew).toBe(!startable);
  });

  it("非回环且无凭据时给出 error 级问题", () => {
    const assessment = evaluateHostBinding({
      bindHost: "192.168.1.10",
      bindPort: 18080,
      accessKey: "",
      corsOrigins: [],
    });
    expect(assessment.level).toBe("error");
    expect(assessment.issues.map((issue) => issue.code)).toContain("non_loopback_without_key");
  });

  it("回环 + 无凭据不产生任何问题", () => {
    const assessment = evaluateHostBinding({
      bindHost: "127.0.0.1",
      bindPort: 18080,
      accessKey: "",
      corsOrigins: [],
    });
    expect(assessment.level).toBe("ok");
    expect(assessment.allowed).toBe(true);
    expect(assessment.issues).toHaveLength(0);
  });

  it("地址为空或端口非法时判定为不可启动", () => {
    expect(
      evaluateHostBinding({ bindHost: "", bindPort: 18080, accessKey: "", corsOrigins: [] }).allowed,
    ).toBe(false);
    expect(
      evaluateHostBinding({ bindHost: "127.0.0.1", bindPort: 0, accessKey: "", corsOrigins: [] }).allowed,
    ).toBe(false);
  });

  it("对外监听但凭据过短时降级为 warning 并保留启动能力", () => {
    const assessment = evaluateHostBinding({
      bindHost: "192.168.1.10",
      bindPort: 18080,
      accessKey: "short",
      corsOrigins: [],
    });
    const codes = assessment.issues.map((issue) => issue.code);
    expect(assessment.allowed).toBe(true);
    expect(assessment.level).toBe("warning");
    expect(codes).toContain("weak_access_key");
    expect(codes).toContain("lan_exposed_cleartext");
  });

  it("0.0.0.0 额外提示全网卡暴露风险", () => {
    const codes = evaluateHostBinding({
      bindHost: ALL_INTERFACES_HOST,
      bindPort: 18080,
      accessKey: "x".repeat(32),
      corsOrigins: [],
    }).issues.map((issue) => issue.code);
    expect(codes).toContain("all_interfaces_exposed");
  });

  it("通配 CORS 来源被标记", () => {
    const codes = evaluateHostBinding({
      bindHost: "127.0.0.1",
      bindPort: 18080,
      accessKey: "",
      corsOrigins: parseCorsOrigins("*"),
    }).issues.map((issue) => issue.code);
    expect(codes).toEqual(["wildcard_cors"]);
  });
});

describe("buildHeadlessEnvText", () => {
  it("生成 headless 可直接消费的环境变量块", () => {
    const text = buildHeadlessEnvText({
      bindHost: "192.168.1.10",
      bindPort: 19000,
      accessKey: "abcdef",
      corsOrigins: ["http://a.test", "http://b.test"],
    });
    expect(text).toBe(
      [
        "HEADLESS_HOST=192.168.1.10",
        "HEADLESS_PORT=19000",
        "HEADLESS_API_KEY=abcdef",
        "HEADLESS_CORS_ORIGINS=http://a.test,http://b.test",
      ].join("\n"),
    );
    const parsed = parseHeadlessConfig({
      HEADLESS_HOST: "192.168.1.10",
      HEADLESS_PORT: "19000",
      HEADLESS_API_KEY: "abcdef",
      HEADLESS_CORS_ORIGINS: "http://a.test,http://b.test",
    });
    expect(parsed.host).toBe("192.168.1.10");
    expect(parsed.port).toBe(19000);
    expect([...parsed.corsOrigins]).toEqual(["http://a.test", "http://b.test"]);
  });

  it("回环 + 空凭据时回落到可安全启动的默认值", () => {
    const text = buildHeadlessEnvText({
      bindHost: "",
      bindPort: 0,
      accessKey: "",
      corsOrigins: [],
    });
    expect(text.split("\n")[0]).toBe("HEADLESS_HOST=127.0.0.1");
    expect(text.split("\n")[1]).toBe("HEADLESS_PORT=18080");
    expect(() => parseHeadlessConfig({
      HEADLESS_HOST: "127.0.0.1",
      HEADLESS_PORT: "18080",
    })).not.toThrow();
  });
});

describe("normalizeHostBaseUrl", () => {
  it("补全协议并去掉尾部斜杠", () => {
    expect(normalizeHostBaseUrl("192.168.1.10:18080")).toBe("http://192.168.1.10:18080");
    expect(normalizeHostBaseUrl(" 192.168.1.10:18080/ ")).toBe("http://192.168.1.10:18080");
    expect(normalizeHostBaseUrl("http://host:18080/")).toBe("http://host:18080");
    expect(normalizeHostBaseUrl("https://host")).toBe("https://host");
    expect(normalizeHostBaseUrl("http://host/base/")).toBe("http://host/base");
  });

  it("拒绝空值与不受支持的协议", () => {
    expect(normalizeHostBaseUrl("")).toBeNull();
    expect(normalizeHostBaseUrl("   ")).toBeNull();
    expect(normalizeHostBaseUrl("ws://host:18080")).toBeNull();
    expect(normalizeHostBaseUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("testHostConnection", () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("地址无法解析时不发起请求", async () => {
    let called = false;
    const result = await testHostConnection(
      { baseUrl: "ws://nope", accessKey: "" },
      {
        fetchImpl: (async () => {
          called = true;
          return jsonResponse(200, {});
        }) as unknown as typeof fetch,
      },
    );
    expect(result.failure).toBe("invalid_url");
    expect(called).toBe(false);
  });

  it("探测成功时带回宿主状态摘要与耗时", async () => {
    const seen: string[] = [];
    const result = await testHostConnection(
      { baseUrl: "192.168.1.10:18080", accessKey: "abc" },
      {
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          seen.push(url);
          if (url.endsWith("/health")) return jsonResponse(200, { ok: true });
          expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer abc");
          return jsonResponse(200, {
            mode: "headless",
            activeProfile: "tavern-agent",
            charactersCount: 3,
            sessionsCount: 7,
          });
        }) as unknown as typeof fetch,
      },
    );
    expect(seen).toEqual(["http://192.168.1.10:18080/health", "http://192.168.1.10:18080/api/host/status"]);
    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.summary).toEqual({
      mode: "headless",
      activeProfile: "tavern-agent",
      charactersCount: 3,
      sessionsCount: 7,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("未带凭据时不发送 Authorization 头", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
      {
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith("/health")) return jsonResponse(200, { ok: true });
          expect(new Headers(init?.headers).has("Authorization")).toBe(false);
          return jsonResponse(200, { mode: "headless" });
        }) as unknown as typeof fetch,
      },
    );
    expect(result.ok).toBe(true);
  });

  it("状态接口返回 401 时判为凭据被拒", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "wrong" },
      {
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/health") ? jsonResponse(200, { ok: true }) : jsonResponse(401, {})
        ) as unknown as typeof fetch,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unauthorized");
    expect(result.statusCode).toBe(401);
  });

  it("健康检查本身被拒时也归为凭据问题", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
      { fetchImpl: (async () => jsonResponse(403, {})) as unknown as typeof fetch },
    );
    expect(result.failure).toBe("unauthorized");
  });

  it("有响应但不是宿主时判为 not_a_host", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
      {
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/health") ? jsonResponse(200, {}) : jsonResponse(404, {})
        ) as unknown as typeof fetch,
      },
    );
    expect(result.failure).toBe("not_a_host");
    expect(result.statusCode).toBe(404);
  });

  it("网络异常与超时统一归为不可达", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
      {
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unreachable");
  });

  it("超时会中止请求而不是一直挂着", async () => {
    const result = await testHostConnection(
      { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
      {
        timeoutMs: 20,
        fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })) as unknown as typeof fetch,
      },
    );
    expect(result.failure).toBe("unreachable");
  });
});
