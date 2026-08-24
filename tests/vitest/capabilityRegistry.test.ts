import { describe, expect, it } from "vitest";
import { defaultCapabilityCatalog } from "../../src/application/bootstrap/capabilityCatalog";
import {
  listRuntimeCapabilities,
  registerRuntimeCapabilities,
} from "../../src/application/bootstrap/capabilityRegistry";
import { createKernel } from "../../src/kernel/Kernel";
import { CAPABILITY_EXTENSION_POINT, type CapabilityDescriptor } from "../../src/domain/capabilities";

describe("运行时能力登记", () => {
  it("默认能力清单覆盖第一批内部能力索引", () => {
    const ids = defaultCapabilityCatalog.map((capability) => capability.id);

    expect(ids).toEqual([
      "llm.provider",
      "tts.provider",
      "asr.provider",
      "storage.memory",
      "plugin.fullscreen",
      "compat.sillytavern",
      "native.file",
      "native.orientation",
      "prompt.composition",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("注册后可通过 Kernel 扩展点检查能力快照", async () => {
    const kernel = createKernel();
    const dispose = registerRuntimeCapabilities(kernel);

    const extensions = kernel.getExtensions<CapabilityDescriptor>(CAPABILITY_EXTENSION_POINT);
    expect(extensions).toHaveLength(defaultCapabilityCatalog.length);
    expect(extensions.map((extension) => extension.id)).toContain("llm.provider");

    const capabilities = listRuntimeCapabilities(kernel);
    expect(capabilities.map((capability) => capability.id)).toEqual([
      "asr.provider",
      "compat.sillytavern",
      "llm.provider",
      "native.file",
      "native.orientation",
      "plugin.fullscreen",
      "prompt.composition",
      "storage.memory",
      "tts.provider",
    ]);
    expect(capabilities.find((capability) => capability.id === "plugin.fullscreen")?.permissions)
      .toContain("llm.chatStream");

    await dispose();
    expect(kernel.getExtensions(CAPABILITY_EXTENSION_POINT)).toEqual([]);
  });

  it("拒绝重复 capability id，避免后注册项静默覆盖", () => {
    const kernel = createKernel();
    const duplicate = {
      id: "demo.capability",
      kind: "runtime",
      providedBy: "test",
      permissions: [],
      lifecycle: "boot",
    } as const satisfies CapabilityDescriptor;

    expect(() => registerRuntimeCapabilities(kernel, [duplicate, duplicate]))
      .toThrow("Duplicate capability descriptor: demo.capability");
  });
});
