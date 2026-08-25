import type {
  EffectDisposer,
  IEffectScope,
  IKernel,
} from "../../kernel/types";
import type { z } from "zod";
import type {
  RuntimeCapabilityDeclaration,
  RuntimeCapabilityToken,
} from "./capabilityTokens";

/** Profile 中对一个插件及其公开配置的声明。配置不会进入运行快照。 */
export interface RuntimePluginReference {
  readonly id: string;
  readonly version?: string;
  readonly config?: unknown;
}

/** 一组可复现的运行时插件组合。 */
export interface RuntimeProfileDefinition {
  readonly id: string;
  readonly version: number;
  readonly plugins: readonly RuntimePluginReference[];
  /** 单例 Slot 的显式选择；值只保存稳定 Provider/Driver ID。 */
  readonly bindings?: Readonly<Record<string, string>>;
  /** 多贡献 Slot 的稳定顺序。 */
  readonly contributions?: Readonly<Record<string, readonly string[]>>;
}

export interface ResolvedRuntimePluginSnapshot {
  readonly id: string;
  readonly version: string;
}

/**
 * 可安全记录的 Profile 快照。
 *
 * 这里只保存插件身份、版本和解析后的顺序，禁止保存 config、令牌或凭据。
 */
export interface ResolvedRuntimeProfileSnapshot {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly plugins: readonly ResolvedRuntimePluginSnapshot[];
  readonly providerBindings: Readonly<Record<string, string>>;
  readonly contributionOrder: Readonly<Record<string, readonly string[]>>;
}

export interface RuntimePluginContext {
  readonly kernel: IKernel;
  readonly scope: IEffectScope;
  readonly profile: ResolvedRuntimeProfileSnapshot;
}

/** Application 层的运行时插件定义；Kernel 不理解此业务语义。 */
export interface RuntimePluginDefinition {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly string[];
  readonly configSchema: z.ZodType<unknown>;
  readonly capabilitySlots?: readonly RuntimeCapabilityToken<unknown>[];
  readonly capabilities?: readonly RuntimeCapabilityDeclaration[];
  setup(
    context: RuntimePluginContext,
    config: unknown,
  ): void | EffectDisposer | Promise<void | EffectDisposer>;
}

export interface RuntimePluginAuthorDefinition<TConfig>
  extends Omit<RuntimePluginDefinition, "configSchema" | "setup"> {
  readonly configSchema: z.ZodType<TConfig>;
  setup(
    context: RuntimePluginContext,
    config: TConfig,
  ): void | EffectDisposer | Promise<void | EffectDisposer>;
}

/** 用 Zod Schema 保持插件配置的输入校验与 setup 类型一致。 */
export function defineRuntimePlugin<TConfig>(
  definition: RuntimePluginAuthorDefinition<TConfig>,
): RuntimePluginDefinition {
  return Object.freeze({
    ...definition,
    configSchema: definition.configSchema as unknown as z.ZodType<unknown>,
    setup(context: RuntimePluginContext, config: unknown) {
      return definition.setup(context, config as TConfig);
    },
  });
}

export interface MountedRuntimeProfile {
  readonly snapshot: ResolvedRuntimeProfileSnapshot;
  readonly scope: IEffectScope;
  dispose(): Promise<void>;
}

export interface MountRuntimeProfileOptions {
  readonly kernel: IKernel;
  readonly profile: RuntimeProfileDefinition;
  readonly plugins: readonly RuntimePluginDefinition[];
  readonly parentScope?: IEffectScope;
}
