import type {
  EffectDisposer,
  IEffectScope,
  IKernel,
} from "../../kernel/types";

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
  validateConfig?(config: unknown): void;
  setup(
    context: RuntimePluginContext,
    config: unknown,
  ): void | EffectDisposer | Promise<void | EffectDisposer>;
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
