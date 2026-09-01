import { describe, expect, it } from "vitest";
import {
  BRAVE_SEARCH_TOOL_NAME,
  BRAVE_SEARCH_TOOL_PLUGIN_ID,
  listOfficialToolPluginInspections,
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
  });
});
