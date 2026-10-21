import { describe, expect, it } from "vitest";
import {
  BRAVE_SEARCH_TOOL_NAME,
  DEEPSEEK_FETCH_TOOL_NAME,
  DEEPSEEK_SEARCH_TOOL_NAME,
  DEVICE_TIME_TOOL_NAME,
  listOfficialToolPluginInspections,
  MEMORY_WRITE_TOOL_NAME,
  readOfficialToolAutoInvoke,
} from "../../src/application/toolPlugins/officialCatalog";
import { parseToolPluginManifest } from "../../src/domain/toolPlugins";
import { computeToolPluginManifestHash } from "../../src/domain/toolPlugins/manifestParser";

/**
 * `autoInvoke` 决定工具是否进入模型工具列表（2026-10-22）。
 *
 * 产品约束：收费或高成本的外部能力只能由用户手动触发，不能由模型自行决定花钱；
 * 本地、无外部副作用的工具保持默认可自动调用。
 */
describe("工具自动调用声明", () => {
  it("收费联网检索在官方目录中声明 autoInvoke:false", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const byName = new Map(
      inspections.flatMap((inspection) => inspection.manifest.tools.map((tool) => [
        `ext.${inspection.manifest.id}.${tool.id}`,
        tool,
      ] as const)),
    );

    expect(byName.get(BRAVE_SEARCH_TOOL_NAME)?.autoInvoke).toBe(false);
    expect(byName.get(DEEPSEEK_SEARCH_TOOL_NAME)?.autoInvoke).toBe(false);
    expect(byName.get(DEEPSEEK_FETCH_TOOL_NAME)?.autoInvoke).toBe(false);
  });

  it("本地与需确认的写入工具不声明 autoInvoke（保持默认可自动调用）", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const byName = new Map(
      inspections.flatMap((inspection) => inspection.manifest.tools.map((tool) => [
        `ext.${inspection.manifest.id}.${tool.id}`,
        tool,
      ] as const)),
    );

    expect(byName.get(MEMORY_WRITE_TOOL_NAME)?.autoInvoke).toBeUndefined();
    expect(byName.get(DEVICE_TIME_TOOL_NAME)?.autoInvoke).toBeUndefined();
  });

  it("官方内置插件以随包目录为准，已安装的旧 manifest 不含该字段也不会退化成可自动调用", () => {
    // 已安装副本与内容哈希绑定、不会随 App 升级改写，所以这层覆盖是必要的。
    expect(readOfficialToolAutoInvoke("official.deepseek-web", "web.search")).toBe(false);
    expect(readOfficialToolAutoInvoke("official.deepseek-web", "web.fetch")).toBe(false);
    expect(readOfficialToolAutoInvoke("official.brave-search", "web.search")).toBe(false);
    // 本地工具仍为可自动调用
    expect(readOfficialToolAutoInvoke("official.memory", "memory.write")).toBe(true);
    expect(readOfficialToolAutoInvoke("official.device-time", "system.time")).toBe(true);
    // 非官方插件不覆盖，交由已安装 manifest 决定
    expect(readOfficialToolAutoInvoke("com.example.custom", "web.search")).toBeUndefined();
  });

  it("manifest 校验接受布尔 autoInvoke，并把非布尔值判为无效", async () => {
    const [inspection] = await listOfficialToolPluginInspections();

    // 内容哈希不包含 contentHash 字段本身；改动后必须去掉旧值再重算，否则先被哈希校验拦下。
    const stripHash = <T extends { contentHash?: string }>(value: T): Omit<T, "contentHash"> => {
      const { contentHash, ...rest } = value;
      void contentHash;
      return rest;
    };

    const accepted = JSON.parse(JSON.stringify(inspection.manifest)) as {
      tools: Array<Record<string, unknown>>;
      contentHash?: string;
    };
    accepted.tools[0].autoInvoke = true;
    const acceptedBody = stripHash(accepted);
    const parsed = await parseToolPluginManifest(JSON.stringify({
      ...acceptedBody,
      contentHash: await computeToolPluginManifestHash(acceptedBody),
    }));
    expect(parsed.tools[0].autoInvoke).toBe(true);

    const rejected = JSON.parse(JSON.stringify(inspection.manifest)) as {
      tools: Array<Record<string, unknown>>;
      contentHash?: string;
    };
    rejected.tools[0].autoInvoke = "yes";
    const rejectedBody = stripHash(rejected);
    await expect(parseToolPluginManifest(JSON.stringify({
      ...rejectedBody,
      contentHash: await computeToolPluginManifestHash(rejectedBody),
    }))).rejects.toThrow();
  });
});
