import { createEffectScope } from "../../kernel/EffectScope";
import type { IEffectScope } from "../../kernel/types";
import type {
  MountRuntimeProfileOptions,
  MountedRuntimeProfile,
  ResolvedRuntimeProfileSnapshot,
  RuntimePluginDefinition,
  RuntimePluginReference,
  RuntimeProfileDefinition,
} from "./contracts";

const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

interface ResolvedRuntimePlugin {
  readonly definition: RuntimePluginDefinition;
  readonly reference: RuntimePluginReference;
}

interface ResolvedRuntimeProfile {
  readonly snapshot: ResolvedRuntimeProfileSnapshot;
  readonly plugins: readonly ResolvedRuntimePlugin[];
}

function assertRuntimeId(id: string, kind: "PROFILE" | "PLUGIN"): void {
  if (!RUNTIME_ID_PATTERN.test(id)) {
    throw new Error(`RUNTIME_${kind}_ID_INVALID: ${id}`);
  }
}

function indexPluginCatalog(
  plugins: readonly RuntimePluginDefinition[],
): Map<string, RuntimePluginDefinition> {
  const catalog = new Map<string, RuntimePluginDefinition>();
  for (const plugin of plugins) {
    assertRuntimeId(plugin.id, "PLUGIN");
    if (!plugin.version.trim()) {
      throw new Error(`RUNTIME_PLUGIN_VERSION_INVALID: ${plugin.id}`);
    }
    if (catalog.has(plugin.id)) {
      throw new Error(`RUNTIME_PLUGIN_DEFINITION_DUPLICATE: ${plugin.id}`);
    }
    catalog.set(plugin.id, plugin);
  }
  return catalog;
}

function resolveRuntimeProfilePlan(
  profile: RuntimeProfileDefinition,
  plugins: readonly RuntimePluginDefinition[],
): ResolvedRuntimeProfile {
  assertRuntimeId(profile.id, "PROFILE");
  if (!Number.isInteger(profile.version) || profile.version <= 0) {
    throw new Error(`RUNTIME_PROFILE_VERSION_INVALID: ${profile.version}`);
  }

  const catalog = indexPluginCatalog(plugins);
  const references = new Map<string, RuntimePluginReference>();
  const declaredOrder = new Map<string, number>();

  profile.plugins.forEach((reference, index) => {
    assertRuntimeId(reference.id, "PLUGIN");
    if (references.has(reference.id)) {
      throw new Error(`RUNTIME_PLUGIN_REFERENCE_DUPLICATE: ${reference.id}`);
    }
    const definition = catalog.get(reference.id);
    if (!definition) {
      throw new Error(`RUNTIME_PLUGIN_NOT_FOUND: ${reference.id}`);
    }
    if (reference.version !== undefined && reference.version !== definition.version) {
      throw new Error(
        `RUNTIME_PLUGIN_VERSION_MISMATCH: ${reference.id} `
          + `(expected ${reference.version}, received ${definition.version})`,
      );
    }
    references.set(reference.id, reference);
    declaredOrder.set(reference.id, index);
  });

  const incoming = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const reference of profile.plugins) {
    incoming.set(reference.id, 0);
    dependents.set(reference.id, []);
  }

  for (const reference of profile.plugins) {
    const definition = catalog.get(reference.id)!;
    const uniqueRequirements = new Set<string>();
    for (const dependencyId of definition.requires ?? []) {
      assertRuntimeId(dependencyId, "PLUGIN");
      if (uniqueRequirements.has(dependencyId)) {
        throw new Error(
          `RUNTIME_PLUGIN_DEPENDENCY_DUPLICATE: ${reference.id} -> ${dependencyId}`,
        );
      }
      uniqueRequirements.add(dependencyId);
      if (!references.has(dependencyId)) {
        throw new Error(
          `RUNTIME_PLUGIN_DEPENDENCY_MISSING: ${reference.id} -> ${dependencyId}`,
        );
      }
      incoming.set(reference.id, (incoming.get(reference.id) ?? 0) + 1);
      dependents.get(dependencyId)!.push(reference.id);
    }
  }

  const byDeclaredOrder = (left: string, right: string): number =>
    declaredOrder.get(left)! - declaredOrder.get(right)!;
  const ready = profile.plugins
    .filter((reference) => incoming.get(reference.id) === 0)
    .map((reference) => reference.id)
    .sort(byDeclaredOrder);
  const orderedIds: string[] = [];

  while (ready.length > 0) {
    const currentId = ready.shift()!;
    orderedIds.push(currentId);
    for (const dependentId of dependents.get(currentId) ?? []) {
      const remaining = (incoming.get(dependentId) ?? 0) - 1;
      incoming.set(dependentId, remaining);
      if (remaining === 0) {
        ready.push(dependentId);
        ready.sort(byDeclaredOrder);
      }
    }
  }

  if (orderedIds.length !== profile.plugins.length) {
    const cyclicIds = profile.plugins
      .map((reference) => reference.id)
      .filter((id) => !orderedIds.includes(id));
    throw new Error(`RUNTIME_PLUGIN_DEPENDENCY_CYCLE: ${cyclicIds.join(", ")}`);
  }

  const resolvedPlugins = orderedIds.map((id) => ({
    definition: catalog.get(id)!,
    reference: references.get(id)!,
  }));
  for (const resolved of resolvedPlugins) {
    resolved.definition.validateConfig?.(resolved.reference.config);
  }

  const providerBindings = normalizeBindings(profile.bindings);
  const contributionOrder = normalizeContributions(profile.contributions);

  const snapshot: ResolvedRuntimeProfileSnapshot = Object.freeze({
    profileId: profile.id,
    profileVersion: profile.version,
    plugins: Object.freeze(resolvedPlugins.map(({ definition }) => Object.freeze({
      id: definition.id,
      version: definition.version,
    }))),
    providerBindings,
    contributionOrder,
  });

  return { snapshot, plugins: resolvedPlugins };
}

function normalizeBindings(
  bindings: RuntimeProfileDefinition["bindings"],
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [slotId, providerId] of Object.entries(bindings ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    assertRuntimeId(slotId, "PLUGIN");
    assertRuntimeId(providerId, "PLUGIN");
    normalized[slotId] = providerId;
  }
  return Object.freeze(normalized);
}

function normalizeContributions(
  contributions: RuntimeProfileDefinition["contributions"],
): Readonly<Record<string, readonly string[]>> {
  const normalized: Record<string, readonly string[]> = {};
  for (const [slotId, contributionIds] of Object.entries(contributions ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    assertRuntimeId(slotId, "PLUGIN");
    const uniqueIds = new Set<string>();
    for (const contributionId of contributionIds) {
      assertRuntimeId(contributionId, "PLUGIN");
      if (uniqueIds.has(contributionId)) {
        throw new Error(`RUNTIME_CONTRIBUTION_DUPLICATE: ${slotId} -> ${contributionId}`);
      }
      uniqueIds.add(contributionId);
    }
    normalized[slotId] = Object.freeze([...uniqueIds]);
  }
  return Object.freeze(normalized);
}

/** 校验 Profile 并返回不含插件配置和秘密的稳定解析快照。 */
export function resolveRuntimeProfile(
  profile: RuntimeProfileDefinition,
  plugins: readonly RuntimePluginDefinition[],
): ResolvedRuntimeProfileSnapshot {
  return resolveRuntimeProfilePlan(profile, plugins).snapshot;
}

function createProfileScope(
  profile: RuntimeProfileDefinition,
  parentScope?: IEffectScope,
): IEffectScope {
  const scopeId = `runtime.profile.${profile.id}.v${profile.version}`;
  return parentScope?.fork(scopeId) ?? createEffectScope(scopeId);
}

async function addReturnedPluginEffect(
  scope: IEffectScope,
  disposer: Exclude<Awaited<ReturnType<RuntimePluginDefinition["setup"]>>, void>,
): Promise<void> {
  try {
    scope.add(disposer);
  } catch (registrationError: unknown) {
    try {
      await disposer();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [registrationError, cleanupError],
        `RUNTIME_PLUGIN_EFFECT_REGISTRATION_FAILED: ${scope.id}`,
      );
    }
    throw registrationError;
  }
}

function assertScopeActive(scope: IEffectScope): void {
  if (scope.state !== "active") {
    throw new Error(`EFFECT_SCOPE_NOT_ACTIVE: ${scope.id} (${scope.state})`);
  }
}

/** 解析并装载一个 Profile；任何阶段失败都会逆序回滚已产生的 Effect。 */
export async function mountRuntimeProfile(
  options: MountRuntimeProfileOptions,
): Promise<MountedRuntimeProfile> {
  const resolved = resolveRuntimeProfilePlan(options.profile, options.plugins);
  const scope = createProfileScope(options.profile, options.parentScope);

  try {
    for (const plugin of resolved.plugins) {
      const pluginScope = scope.fork(`runtime.plugin.${plugin.definition.id}`);
      const disposer = await plugin.definition.setup(
        {
          kernel: options.kernel,
          scope: pluginScope,
          profile: resolved.snapshot,
        },
        plugin.reference.config,
      );
      if (disposer) await addReturnedPluginEffect(pluginScope, disposer);
      assertScopeActive(scope);
      assertScopeActive(pluginScope);
    }
  } catch (setupError: unknown) {
    try {
      await scope.dispose();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [setupError, cleanupError],
        `RUNTIME_PROFILE_MOUNT_ROLLBACK_FAILED: ${options.profile.id}`,
      );
    }
    throw setupError;
  }

  return {
    snapshot: resolved.snapshot,
    scope,
    dispose: () => scope.dispose(),
  };
}
