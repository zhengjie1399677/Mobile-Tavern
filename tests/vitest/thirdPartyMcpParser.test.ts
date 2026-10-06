import { describe, expect, it } from "vitest";
import {
  parseThirdPartyMcpConfig,
  candidateToExternalSource,
  formValuesToCandidate,
  presetToFormValues,
  THIRD_PARTY_MCP_PRESETS,
} from "../../src/application/externalSources/thirdPartyMcpParser";

describe("thirdPartyMcpParser (第三方 MCP 配置解析与预置模板)", () => {
  it("支持单行 HTTP/HTTPS URL 快捷解析", () => {
    const result = parseThirdPartyMcpConfig("https://mcp.deepwiki.com/mcp");
    expect(result.valid).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].endpoint).toBe("https://mcp.deepwiki.com/mcp");
    expect(result.candidates[0].displayName).toBe("mcp.deepwiki.com");
    expect(result.candidates[0].era).toBe("auto");
  });

  it("支持解析 Claude Desktop / Cursor 标准 mcpServers 结构", () => {
    const json = JSON.stringify({
      mcpServers: {
        "deepwiki-remote": {
          url: "https://mcp.deepwiki.com/mcp",
        },
        "brave-search": {
          url: "https://api.search.brave.com/mcp",
          headers: {
            "x-subscription-token": "secret-brave-token-123",
          },
        },
        "stdio-service": {
          command: "npx",
          args: ["-y", "sqlite-mcp"],
        },
      },
    });

    const result = parseThirdPartyMcpConfig(json);
    expect(result.valid).toBe(true);
    expect(result.candidates).toHaveLength(2);

    const deepwiki = result.candidates.find((c) => c.id === "deepwiki-remote");
    expect(deepwiki).toBeDefined();
    expect(deepwiki?.endpoint).toBe("https://mcp.deepwiki.com/mcp");

    const brave = result.candidates.find((c) => c.id === "brave-search");
    expect(brave).toBeDefined();
    expect(brave?.endpoint).toBe("https://api.search.brave.com/mcp");
    expect(brave?.authHeader).toBe("x-subscription-token");
    expect(brave?.rawSecret).toBe("secret-brave-token-123");

    // stdio 服务应被安全拦截并在 skipped 中给出明确原因
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].key).toBe("stdio-service");
    expect(result.skipped[0].reason).toContain("stdio 本地进程在移动端不可运行");
  });

  it("能正确提取 Bearer Authorization 请求头并剥离 Bearer 前缀", () => {
    const json = JSON.stringify({
      mcpServers: {
        secureServer: {
          url: "https://api.example.com/mcp",
          headers: {
            Authorization: "Bearer token-xyz-789",
          },
        },
      },
    });

    const result = parseThirdPartyMcpConfig(json);
    expect(result.valid).toBe(true);
    expect(result.candidates[0].authHeader).toBe("Authorization");
    expect(result.candidates[0].authScheme).toBe("bearer");
    expect(result.candidates[0].rawSecret).toBe("token-xyz-789");
  });

  it("能通过 candidateToExternalSource 转化为合规的 ExternalCapabilitySource", () => {
    const parsed = parseThirdPartyMcpConfig("https://example.com/mcp").candidates[0];
    const source = candidateToExternalSource(parsed);
    expect(source.schemaVersion).toBe(1);
    expect(source.kind).toBe("mcp");
    expect(source.transport).toBe("streamable-http");
    expect(source.enabled).toBe(true);
    expect(source.endpoint).toBe("https://example.com/mcp");
  });

  it("预置模板库数据完整且符合只读规范", () => {
    expect(THIRD_PARTY_MCP_PRESETS.length).toBeGreaterThanOrEqual(2);
    const deepwiki = THIRD_PARTY_MCP_PRESETS.find((p) => p.id === "deepwiki");
    expect(deepwiki).toBeDefined();
    expect(deepwiki?.endpoint).toBe("https://mcp.deepwiki.com/mcp");
    expect(deepwiki?.requiresAuth).toBe(false);
  });

  it("预置模板 → 表单 → 候选：鉴权头、鉴权方案与占位提示必须一路带出", () => {
    const brave = THIRD_PARTY_MCP_PRESETS.find((p) => p.id === "brave-search");
    expect(brave).toBeDefined();
    if (!brave) return;

    const form = presetToFormValues(brave);
    expect(form.authHeader).toBe("x-subscription-token");
    expect(form.authScheme).toBe("raw");
    expect(form.authPlaceholder).toContain("Brave Search API Key");

    const candidate = formValuesToCandidate({ ...form, token: "  BSA-key-123  " });
    expect(candidate.authHeader).toBe("x-subscription-token");
    expect(candidate.authScheme).toBe("raw");
    // 秘密必须去空白后再交出去，避免把尾部空格写进请求头
    expect(candidate.rawSecret).toBe("BSA-key-123");

    const saved = candidateToExternalSource(candidate);
    expect(saved.authHeader).toBe("x-subscription-token");
    expect(saved.authScheme).toBe("raw");
  });

  it("无鉴权模板与留空 Token 都不产生凭据字段", () => {
    const deepwiki = THIRD_PARTY_MCP_PRESETS.find((p) => p.id === "deepwiki");
    expect(deepwiki).toBeDefined();
    if (!deepwiki) return;

    const candidate = formValuesToCandidate({ ...presetToFormValues(deepwiki), token: "   " });
    expect(candidate.authHeader).toBeUndefined();
    expect(candidate.authScheme).toBeUndefined();
    expect(candidate.rawSecret).toBeUndefined();

    const saved = candidateToExternalSource(candidate);
    expect(saved.authHeader).toBeUndefined();
    expect(saved.authScheme).toBeUndefined();
  });
});
