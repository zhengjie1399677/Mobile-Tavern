import type { EffectDisposer, IEffectScope, IKernel } from "../../kernel/types";
import { registerRuntimeCapabilities } from "../bootstrap/capabilityRegistry";
import { registerCoreServices } from "../bootstrap/registerCoreServices";
import { registerDefaultPipelines } from "../bootstrap/registerDefaultPipelines";
import type {
  RuntimePluginDefinition,
  RuntimeProfileDefinition,
} from "./contracts";
import { agentSpineRuntimePlugin, AGENT_SPINE_RUNTIME_PLUGIN_ID } from "./agentSpineRuntimePlugin";
import {
  sillyTavernCompatibilityRuntimePlugin,
} from "./sillyTavernCompatibilityRuntimePlugin";
import { SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID } from "../compatibility/contracts";
import { KernelServices } from "../serviceContracts";
import type { CapabilityDescriptor } from "../../domain/capabilities";
import { assertUniqueCapabilityIds } from "../../domain/capabilities";
import { MEMORY_PERSISTENCE_SERVICE } from "../services/memory/types";

export const LEGACY_RUNTIME_PLUGIN_ID = "mobile-tavern.legacy-runtime";

export interface LegacyRuntimeRegistrars {
  registerCoreServices(kernel: IKernel): Promise<EffectDisposer>;
  registerDefaultPipelines(kernel: IKernel): EffectDisposer;
  registerRuntimeCapabilities(kernel: IKernel): EffectDisposer;
}

const defaultLegacyRuntimeRegistrars: LegacyRuntimeRegistrars = {
  registerCoreServices,
  registerDefaultPipelines,
  registerRuntimeCapabilities: (kernel) => registerRuntimeCapabilities(kernel, coreRuntimeCapabilities),
};

/** 通用能力由核心 Runtime Plugin 自己声明，不再通过全局静态 catalog 隐式注册。 */
export const coreRuntimeCapabilities = [
  { id: "llm.provider", kind: "provider", providedBy: KernelServices.LLM, permissions: [], lifecycle: "boot" },
  { id: "tts.provider", kind: "provider", providedBy: KernelServices.Tts, permissions: [], lifecycle: "boot" },
  { id: "asr.provider", kind: "provider", providedBy: KernelServices.Asr, permissions: [], lifecycle: "boot" },
  { id: "storage.memory", kind: "storage", providedBy: MEMORY_PERSISTENCE_SERVICE, permissions: [], lifecycle: "boot" },
  {
    id: "plugin.fullscreen",
    kind: "plugin-host",
    providedBy: "Plugin Host RPC",
    permissions: ["context.read", "chat.action", "chat.send", "llm.chat", "llm.chatStream", "llm.preset.list"],
    lifecycle: "on-demand",
  },
  { id: "native.file", kind: "native", providedBy: "AndroidThemeBridge", permissions: [], lifecycle: "on-demand" },
  { id: "native.orientation", kind: "native", providedBy: "AndroidThemeBridge", permissions: [], lifecycle: "on-demand" },
  { id: "prompt.composition", kind: "runtime", providedBy: KernelServices.Prompt, permissions: [], lifecycle: "boot" },
] as const satisfies readonly CapabilityDescriptor[];

assertUniqueCapabilityIds(coreRuntimeCapabilities);

async function addLegacyRuntimeEffect(
  scope: IEffectScope,
  disposer: EffectDisposer,
): Promise<void> {
  try {
    scope.add(disposer);
  } catch (registrationError: unknown) {
    try {
      await disposer();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [registrationError, cleanupError],
        `LEGACY_RUNTIME_EFFECT_REGISTRATION_FAILED: ${scope.id}`,
      );
    }
    throw registrationError;
  }
}

/**
 * 把迁移前的核心服务、默认 Pipeline 和能力清单包装为一个应用层插件。
 * 后续能力可逐个从这里拆成独立插件，而无需继续扩大组合根。
 */
export function createLegacyRuntimePlugin(
  registrars: LegacyRuntimeRegistrars = defaultLegacyRuntimeRegistrars,
): RuntimePluginDefinition {
  return {
    id: LEGACY_RUNTIME_PLUGIN_ID,
    version: "1.0.0",
    validateConfig(config: unknown): void {
      if (config !== undefined) {
        throw new Error("LEGACY_RUNTIME_PLUGIN_CONFIG_UNSUPPORTED");
      }
    },
    async setup({ kernel, scope }): Promise<void> {
      await addLegacyRuntimeEffect(
        scope,
        await registrars.registerCoreServices(kernel),
      );
      await addLegacyRuntimeEffect(
        scope,
        registrars.registerDefaultPipelines(kernel),
      );
      await addLegacyRuntimeEffect(
        scope,
        registrars.registerRuntimeCapabilities(kernel),
      );
    },
  };
}

export const legacyRuntimePlugin = createLegacyRuntimePlugin();

const basePlugins: RuntimeProfileDefinition["plugins"] = [
  { id: LEGACY_RUNTIME_PLUGIN_ID, version: "1.0.0" },
  { id: AGENT_SPINE_RUNTIME_PLUGIN_ID, version: "1.0.0" },
];

const baseBindings = {
  "agent.driver": "mobile-tavern.chat.driver",
  "llm.route": "provider.openai-compatible",
} as const;

const baseContributions = {
  tool: [],
  "media.processor": ["media.audio.asr", "media.video.keyframes"],
} as const;

/** 不装载任何生态兼容实现的基础 Agent Host Profile。 */
export const baseRuntimeProfileDefinition: RuntimeProfileDefinition = {
  id: "mobile-tavern.base",
  version: 1,
  plugins: basePlugins,
  bindings: baseBindings,
  contributions: baseContributions,
};

/** 当前默认 Tavern Profile；Compatibility Runtime 可从 Profile 中独立移除。 */
export const legacyRuntimeProfileDefinition: RuntimeProfileDefinition = {
  id: "mobile-tavern.tavern",
  version: 3,
  plugins: [
    { id: LEGACY_RUNTIME_PLUGIN_ID, version: "1.0.0" },
    { id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID, version: "1.0.0" },
    { id: AGENT_SPINE_RUNTIME_PLUGIN_ID, version: "1.0.0" },
  ],
  bindings: baseBindings,
  contributions: {
    ...baseContributions,
    "compat.codec": ["compat.sillytavern.codec.prompt-preset"],
    "compat.prompt-section": ["compat.sillytavern.prompt.mvu-state"],
    "compat.context-source": ["compat.sillytavern.context.mvu-state"],
    "compat.transform": ["compat.sillytavern.transform.regex"],
    "compat.state-reducer": ["compat.sillytavern.state.mvu"],
    "compat.renderer": ["compat.sillytavern.renderer"],
  },
};

export const legacyRuntimePluginCatalog: readonly RuntimePluginDefinition[] = [
  legacyRuntimePlugin,
  sillyTavernCompatibilityRuntimePlugin,
  agentSpineRuntimePlugin,
];
