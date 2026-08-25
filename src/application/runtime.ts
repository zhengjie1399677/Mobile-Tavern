/**
 * 应用运行时组合根。
 *
 * 这里负责把 Mobile Tavern 的应用服务和默认 Pipeline 装配到通用 Kernel。
 * Kernel 本身不知道角色、Prompt、记忆、数据库或任何其他业务服务。
 */
import { globalKernel } from "../kernel/Kernel";
import { createKernelLifecycleController } from "../kernel/KernelLifecycle";
import { createEffectScope } from "../kernel/EffectScope";
import type { EffectDisposer, IEffectScope } from "../kernel/types";
import { bindRuntimeKernel } from "../kernel/runtimeKernel";
import { configureKernelValidators } from "../kernel/validation";
import {
  legacyRuntimePluginCatalog,
  mountRuntimeProfile,
  type ResolvedRuntimeProfileSnapshot,
} from "./runtimePlugins";
import { resolveRuntimeProfileSelection } from "./runtimeProfiles/catalog";
import type { RuntimeProfileResolutionDiagnostic } from "./runtimeProfiles/contracts";
import { readRuntimeProfilePreferences } from "../infrastructure/runtimeProfiles/runtimeProfilePreferences";
import {
  validateMessage,
  validateService,
  validateServiceRetrieval,
} from "./serviceSchemas";

bindRuntimeKernel(globalKernel);
configureKernelValidators({
  validateMessage,
  validateService,
  validateServiceRetrieval,
});

let runtimeScope: IEffectScope | null = null;
let activeRuntimeProfileSnapshot: ResolvedRuntimeProfileSnapshot | null = null;
let runtimeProfileStartupDiagnostics: readonly RuntimeProfileResolutionDiagnostic[] = [];

async function destroyScopedApplicationRuntime(): Promise<void> {
  const scope = runtimeScope;
  runtimeScope = null;
  activeRuntimeProfileSnapshot = null;
  runtimeProfileStartupDiagnostics = [];
  let scopeError: unknown;
  try {
    await scope?.dispose();
  } catch (error: unknown) {
    scopeError = error;
  }

  try {
    await globalKernel.destroy();
  } catch (kernelError: unknown) {
    if (scopeError !== undefined) {
      throw new AggregateError(
        [scopeError, kernelError],
        "APPLICATION_RUNTIME_DESTROY_FAILED",
      );
    }
    throw kernelError;
  }

  if (scopeError !== undefined) throw scopeError;
}

const lifecycle = createKernelLifecycleController({ destroy: destroyScopedApplicationRuntime }, async () => {
  const scope = createEffectScope("application.runtime");
  runtimeScope = scope;
  const storedPreference = readRuntimeProfilePreferences();
  const selectedProfile = resolveRuntimeProfileSelection(
    storedPreference.state,
    storedPreference.invalidStoredValue,
  );
  const mountedProfile = await mountRuntimeProfile({
    kernel: globalKernel,
    profile: selectedProfile.definition,
    plugins: legacyRuntimePluginCatalog,
    parentScope: scope,
  });
  activeRuntimeProfileSnapshot = mountedProfile.snapshot;
  runtimeProfileStartupDiagnostics = selectedProfile.diagnostics;
});

/** 把应用组合层的后注册 Effect 纳入当前 Application Scope。 */
export function addApplicationRuntimeEffect(disposer: EffectDisposer): EffectDisposer {
  if (!runtimeScope || runtimeScope.state !== "active") {
    throw new Error("APPLICATION_RUNTIME_SCOPE_NOT_ACTIVE");
  }
  return runtimeScope.add(disposer);
}

/** 当前已解析的运行时 Profile；快照不包含插件配置或秘密。 */
export function getActiveRuntimeProfileSnapshot(): ResolvedRuntimeProfileSnapshot | null {
  return activeRuntimeProfileSnapshot;
}

export function getRuntimeProfileStartupDiagnostics(): readonly RuntimeProfileResolutionDiagnostic[] {
  return runtimeProfileStartupDiagnostics;
}

export function initializeApplicationRuntime(): Promise<void> {
  return lifecycle.initialize();
}

export function destroyApplicationRuntime(): Promise<void> {
  return lifecycle.destroy();
}
