/**
 * 外部能力源的应用层编排：校验配置、解析 driver、绑定生命周期。
 * 协议细节（含 MCP）不得越过本层；取消与资源释放在这里统一收口。
 */
import {
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  externalCapabilitySourceSchema,
  type ConnectedSource,
  type ConnectorDeps,
  type ExternalCapabilitySnapshot,
  type ExternalCapabilitySource,
} from "../../domain/externalSources/contracts";
import type { ConnectorRegistry } from "../../domain/externalSources/registry";

export interface OpenExternalSourceOptions {
  readonly registry: ConnectorRegistry;
  /** 调用方 Scope 的取消信号；连接与能力发现都受它约束。 */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly deps?: ConnectorDeps;
}

export interface OpenedExternalSource {
  readonly source: ExternalCapabilitySource;
  readonly snapshot: ExternalCapabilitySnapshot;
  readonly connected: ConnectedSource;
  /** 幂等：重复调用只释放一次。 */
  dispose(): Promise<void>;
}

/**
 * 打开一个外部能力源。
 *
 * 配置非法、kind/transport 未注册、连接失败或能力发现失败都会抛出；
 * 失败路径保证不残留连接，调用方无需再次清理。
 */
export async function openExternalSource(
  input: unknown,
  options: OpenExternalSourceOptions,
): Promise<OpenedExternalSource> {
  const source = externalCapabilitySourceSchema.parse(input);
  if (!source.enabled) {
    throw new Error(`EXTERNAL_SOURCE_DISABLED:${source.id}`);
  }
  const driver = options.registry.assertSupported(source);
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const connected = await driver.connect(
    source,
    { signal, timeoutMs: options.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS },
    options.deps ?? {},
  );

  let disposed = false;
  return {
    source,
    snapshot: connected.snapshot,
    connected,
    async dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      await connected.dispose();
    },
  };
}
