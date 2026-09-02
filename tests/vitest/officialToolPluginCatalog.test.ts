import { describe, expect, it } from "vitest";
import {
  BRAVE_SEARCH_TOOL_NAME,
  BRAVE_SEARCH_TOOL_PLUGIN_ID,
  DEVICE_TIME_TOOL_NAME,
  DEVICE_TIME_TOOL_PLUGIN_ID,
  listOfficialToolPluginInspections,
  MEMORY_TOOL_PLUGIN_ID,
  MEMORY_WRITE_TOOL_NAME,
  UTILITY_COIN_TOOL_NAME,
  UTILITY_COUNT_TOOL_NAME,
  UTILITY_DICE_TOOL_NAME,
  UTILITY_PICK_TOOL_NAME,
  UTILITY_TOOL_PLUGIN_ID,
} from "../../src/application/toolPlugins/officialCatalog";
import { parseToolPluginManifest } from "../../src/domain/toolPlugins";

describe("官方 Tool Plugin 目录", () => {
  it("提供通过严格校验的 Brave 搜索连接器", async () => {
    const [inspection] = await listOfficialToolPluginInspections();
    const parsed = await parseToolPluginManifest(JSON.stringify(inspection.manifest));

    expect(parsed).toMatchObject({
      id: BRAVE_SEARCH_TOOL_PLUGIN_ID,
      manifestVersion: 2,
      targetProfiles: ["*"],
      network: {
        allowedOrigins: ["https://api.search.brave.com"],
        allowedMethods: ["GET"],
        maxRequestsPerCall: 1,
      },
      credentials: [{
        id: "brave-api-key",
        required: true,
        injection: { location: "header", name: "X-Subscription-Token" },
      }],
    });
    expect(`ext.${parsed.id}.${parsed.tools[0].id}`).toBe(BRAVE_SEARCH_TOOL_NAME);
    expect(inspection.sourceVerification).toEqual({
      trustLevel: "official",
      verificationMethod: "bundled",
      signerId: "mobile-tavern.bundled-catalog",
      signerLabel: "Mobile Tavern 内置目录",
    });
  });

  it("提供高风险、逐次确认的长期记忆写入能力", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const inspection = inspections.find((item) => item.manifest.id === MEMORY_TOOL_PLUGIN_ID)!;
    const parsed = await parseToolPluginManifest(JSON.stringify(inspection.manifest));

    expect(parsed).toMatchObject({
      targetProfiles: ["*"],
      permissions: [{ id: "memory.write", riskLevel: "high" }],
      tools: [{
        id: "memory.write",
        permissions: ["memory.write"],
        riskLevel: "high",
        sideEffect: "local-write",
        executionScope: "memory",
        handler: { kind: "host", capability: "memory.write" },
      }],
    });
    expect(`ext.${parsed.id}.${parsed.tools[0].id}`).toBe(MEMORY_WRITE_TOOL_NAME);
  });

  it("提供无权限的设备时间能力和 /time 输入框命令", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const inspection = inspections.find((item) => item.manifest.id === DEVICE_TIME_TOOL_PLUGIN_ID)!;
    const parsed = await parseToolPluginManifest(JSON.stringify(inspection.manifest));

    expect(parsed).toMatchObject({
      targetProfiles: ["*"],
      permissions: [],
      tools: [{
        id: "system.time",
        permissions: [],
        riskLevel: "low",
        sideEffect: "none",
        executionScope: "turn",
        composerCommand: { name: "time", outputProperty: "text" },
        handler: { kind: "host", capability: "system.time" },
      }],
    });
    expect(`ext.${parsed.id}.${parsed.tools[0].id}`).toBe(DEVICE_TIME_TOOL_NAME);
  });

  it("提供本地实用工具包，暴露四个无权限输入框命令", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const inspection = inspections.find((item) => item.manifest.id === UTILITY_TOOL_PLUGIN_ID)!;
    const parsed = await parseToolPluginManifest(JSON.stringify(inspection.manifest));

    expect(parsed).toMatchObject({ targetProfiles: ["*"], permissions: [] });
    expect(parsed.tools.map((tool) => tool.composerCommand?.name))
      .toEqual(["dice", "coin", "pick", "count"]);
    expect(parsed.tools.map((tool) => tool.handler)).toEqual([
      { kind: "host", capability: "random.dice" },
      { kind: "host", capability: "random.coin" },
      { kind: "host", capability: "random.pick" },
      { kind: "host", capability: "text.count" },
    ]);
    expect(parsed.tools.every((tool) => (
      tool.permissions.length === 0
      && tool.riskLevel === "low"
      && tool.sideEffect === "none"
      && tool.executionScope === "turn"
    ))).toBe(true);

    expect(`ext.${parsed.id}.${parsed.tools[0].id}`).toBe(UTILITY_DICE_TOOL_NAME);
    expect(`ext.${parsed.id}.${parsed.tools[1].id}`).toBe(UTILITY_COIN_TOOL_NAME);
    expect(`ext.${parsed.id}.${parsed.tools[2].id}`).toBe(UTILITY_PICK_TOOL_NAME);
    expect(`ext.${parsed.id}.${parsed.tools[3].id}`).toBe(UTILITY_COUNT_TOOL_NAME);
  });
});
