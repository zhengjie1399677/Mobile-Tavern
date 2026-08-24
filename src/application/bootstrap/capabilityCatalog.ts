import { KernelServices } from "../serviceContracts";
import type { CapabilityDescriptor } from "../../domain/capabilities";
import { assertUniqueCapabilityIds } from "../../domain/capabilities";
import { MEMORY_PERSISTENCE_SERVICE } from "../services/memory/types";

export const defaultCapabilityCatalog = [
  {
    id: "llm.provider",
    kind: "provider",
    providedBy: KernelServices.LLM,
    permissions: [],
    lifecycle: "boot",
  },
  {
    id: "tts.provider",
    kind: "provider",
    providedBy: KernelServices.Tts,
    permissions: [],
    lifecycle: "boot",
  },
  {
    id: "asr.provider",
    kind: "provider",
    providedBy: KernelServices.Asr,
    permissions: [],
    lifecycle: "boot",
  },
  {
    id: "storage.memory",
    kind: "storage",
    providedBy: MEMORY_PERSISTENCE_SERVICE,
    permissions: [],
    lifecycle: "boot",
  },
  {
    id: "plugin.fullscreen",
    kind: "plugin-host",
    providedBy: "Plugin Host RPC",
    permissions: ["context.read", "chat.action", "chat.send", "llm.chat", "llm.chatStream", "llm.preset.list"],
    lifecycle: "on-demand",
  },
  {
    id: "native.file",
    kind: "native",
    providedBy: "AndroidThemeBridge",
    permissions: [],
    lifecycle: "on-demand",
  },
  {
    id: "native.orientation",
    kind: "native",
    providedBy: "AndroidThemeBridge",
    permissions: [],
    lifecycle: "on-demand",
  },
  {
    id: "prompt.composition",
    kind: "runtime",
    providedBy: KernelServices.Prompt,
    permissions: [],
    lifecycle: "boot",
  },
] as const satisfies readonly CapabilityDescriptor[];

assertUniqueCapabilityIds(defaultCapabilityCatalog);
