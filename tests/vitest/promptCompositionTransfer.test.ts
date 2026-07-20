import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../src/domain/prompt-composition";
import {
  createPromptCompositionFileName,
  parsePromptCompositionTemplate,
  serializePromptCompositionTemplate,
} from "../../src/components/presetForm/promptCompositionTransfer";

const composition: PromptComposition = {
  id: "transfer-test",
  name: "迁移 / 测试",
  version: 1,
  blocks: [{
    id: "system-block",
    name: "系统消息",
    enabled: true,
    role: "system",
    source: { type: "template" },
    template: "{{character.description}}",
    order: 100,
    placement: { type: "ordered" },
    compatibility: {
      source: "sillytavern",
      originalIdentifier: "main",
      originalFields: { future: true },
    },
  }],
  compatibility: {
    source: "sillytavern",
    preservedRootFields: { future_root: { enabled: true } },
  },
};

describe("PromptComposition JSON 模板迁移", () => {
  it("使用带格式与版本标识的信封导出，并无损保留兼容元数据", () => {
    const serialized = serializePromptCompositionTemplate(composition, "2026-07-20T00:00:00.000Z");
    const envelope = JSON.parse(serialized) as Record<string, unknown>;

    expect(envelope.format).toBe("mobile-tavern.prompt-composition");
    expect(envelope.version).toBe(1);
    expect(parsePromptCompositionTemplate(serialized)).toEqual(composition);
  });

  it("兼容导入旧的裸 PromptComposition JSON", () => {
    expect(parsePromptCompositionTemplate(JSON.stringify(composition))).toEqual(composition);
  });

  it("拒绝未知模板版本", () => {
    expect(() => parsePromptCompositionTemplate(JSON.stringify({
      format: "mobile-tavern.prompt-composition",
      version: 99,
      composition,
    }))).toThrow("PROMPT_COMPOSITION_TEMPLATE_UNSUPPORTED_VERSION");
  });

  it("生成不包含路径字符的 JSON 文件名", () => {
    expect(createPromptCompositionFileName(composition.name)).toBe("迁移_测试.prompt-composition.json");
  });
});
