import type { EffectDisposer, IEffectScope, IKernel } from "../../kernel/types";
import { registerRuntimeCapabilities } from "../bootstrap/capabilityRegistry";
import { registerCoreServices } from "../bootstrap/registerCoreServices";
import { registerDefaultPipelines } from "../bootstrap/registerDefaultPipelines";
import type {
  RuntimePluginDefinition,
  RuntimeProfileDefinition,
} from "./contracts";

export const LEGACY_RUNTIME_PLUGIN_ID = "mobile-tavern.legacy-runtime";

export interface LegacyRuntimeRegistrars {
  registerCoreServices(kernel: IKernel): Promise<EffectDisposer>;
  registerDefaultPipelines(kernel: IKernel): EffectDisposer;
  registerRuntimeCapabilities(kernel: IKernel): EffectDisposer;
}

const defaultLegacyRuntimeRegistrars: LegacyRuntimeRegistrars = {
  registerCoreServices,
  registerDefaultPipelines,
  registerRuntimeCapabilities,
};

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

export const legacyRuntimeProfileDefinition: RuntimeProfileDefinition = {
  id: "mobile-tavern.legacy",
  version: 1,
  plugins: [{ id: LEGACY_RUNTIME_PLUGIN_ID, version: "1.0.0" }],
};

export const legacyRuntimePluginCatalog: readonly RuntimePluginDefinition[] = [
  legacyRuntimePlugin,
];
