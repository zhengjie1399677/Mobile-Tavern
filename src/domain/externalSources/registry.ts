/**
 * Connector 注册表：把「协议种类 + 传输方式」映射到具体 driver。
 *
 * 注册是增量且可撤销的；任何消费者都只能通过本注册表解析 driver，
 * 不得直接 import 具体协议实现（由架构守卫强制）。
 */
import type {
  ConnectorDriver,
  ExternalCapabilitySource,
  ExternalSourceKind,
  ExternalTransportId,
} from "./contracts";

export interface ExternalSourceKindDescriptor {
  readonly kind: ExternalSourceKind;
  readonly transports: readonly ExternalTransportId[];
}

export interface ConnectorRegistry {
  /** 注册 driver；返回注销函数，重复注册同一 kind 会抛错。 */
  register(driver: ConnectorDriver): () => void;
  resolve(kind: ExternalSourceKind): ConnectorDriver | undefined;
  listKinds(): readonly ExternalSourceKindDescriptor[];
  /** 校验来源的 kind/transport 组合；不合法时抛出带稳定错误码的错误。 */
  assertSupported(
    source: Pick<ExternalCapabilitySource, "kind" | "transport">,
  ): ConnectorDriver;
}

export function externalSourceError(code: string, detail: string): Error {
  return new Error(`${code}:${detail}`);
}

export function createConnectorRegistry(): ConnectorRegistry {
  const drivers = new Map<ExternalSourceKind, ConnectorDriver>();

  const registry: ConnectorRegistry = {
    register(driver) {
      if (drivers.has(driver.kind)) {
        throw externalSourceError(
          "EXTERNAL_SOURCE_KIND_ALREADY_REGISTERED",
          driver.kind,
        );
      }
      drivers.set(driver.kind, driver);
      return () => {
        if (drivers.get(driver.kind) === driver) drivers.delete(driver.kind);
      };
    },

    resolve(kind) {
      return drivers.get(kind);
    },

    listKinds() {
      return [...drivers.values()].map((driver) =>
        Object.freeze({ kind: driver.kind, transports: [...driver.transports] }),
      );
    },

    assertSupported(source) {
      const driver = drivers.get(source.kind);
      if (!driver) {
        throw externalSourceError(
          "EXTERNAL_SOURCE_KIND_UNSUPPORTED",
          source.kind,
        );
      }
      if (!driver.transports.includes(source.transport)) {
        throw externalSourceError(
          "EXTERNAL_SOURCE_TRANSPORT_UNSUPPORTED",
          `${source.kind}/${source.transport}`,
        );
      }
      return driver;
    },
  };

  return registry;
}
