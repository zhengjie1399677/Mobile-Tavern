import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolPluginPackage } from "../../sdk/tool-plugin/src/packageBuilder";
import { textToolkitManifest } from "../../examples/tool-plugin-text-toolkit/manifest";
import { textToolkitHandlers } from "../../examples/tool-plugin-text-toolkit/src";
import { parseToolPluginPackage } from "../../src/domain/toolPlugins";

describe("官方文本工具箱 Tool Plugin 示例", () => {
  it("提供确定性的文本统计和空白整理", () => {
    expect(textToolkitHandlers.textStats({ text: "雪团 hello\r\nworld" }))
      .toEqual({ characters: 15, words: 3, lines: 2 });
    expect(textToolkitHandlers.normalizeWhitespace({ text: "a  \r\n\r\n\r\nb\t" }))
      .toEqual({ text: "a\n\nb" });
  });

  it("仓库内 mttool 与 SDK 构建结果一致且可被运行时解析", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mobile-tavern-tool-example-"));
    const outputFile = join(directory, "text-toolkit.mttool");
    try {
      await buildToolPluginPackage({
        manifest: textToolkitManifest,
        entryPoint: resolve("examples/tool-plugin-text-toolkit/src/index.ts"),
        outputFile,
      });
      const committed = await readFile(resolve("examples/tool-plugin-text-toolkit/text-toolkit.mttool"));
      const rebuilt = await readFile(outputFile);
      expect(rebuilt).toEqual(committed);

      const inspection = await parseToolPluginPackage(rebuilt);
      expect(inspection.manifest).toMatchObject({
        id: "example.text-toolkit",
        manifestVersion: 2,
        targetProfiles: ["*"],
      });
      expect(inspection.manifest.permissions).toEqual([]);
      expect(inspection.manifest.tools).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
