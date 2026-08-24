const RUNTIME_CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

declare const runtimeCapabilityValue: unique symbol;

export type RuntimeCapabilityCardinality = "single" | "multiple";

/**
 * Application 层的类型化能力槽位。
 *
 * TValue 只用于在插件作者侧约束贡献类型；Token 本身不保存服务实例，
 * 解析快照仍只记录稳定 ID。
 */
export interface RuntimeCapabilityToken<TValue> {
  readonly id: string;
  readonly cardinality: RuntimeCapabilityCardinality;
  readonly required: boolean;
  readonly [runtimeCapabilityValue]?: TValue;
}

export interface RuntimeCapabilityDeclaration {
  readonly token: RuntimeCapabilityToken<unknown>;
  readonly kind: "provider" | "contribution";
  readonly valueId: string;
}

export function createRuntimeCapabilityToken<TValue>(options: {
  readonly id: string;
  readonly cardinality: RuntimeCapabilityCardinality;
  readonly required?: boolean;
}): RuntimeCapabilityToken<TValue> {
  assertRuntimeCapabilityId(options.id, "RUNTIME_CAPABILITY_SLOT_ID_INVALID");
  if (options.cardinality === "multiple" && options.required === true) {
    throw new Error(`RUNTIME_CAPABILITY_MULTIPLE_REQUIRED_UNSUPPORTED: ${options.id}`);
  }
  return Object.freeze({
    id: options.id,
    cardinality: options.cardinality,
    required: options.required === true,
  });
}

/** 声明一个单例 Slot 的候选 Provider。 */
export function provideRuntimeCapability<TValue>(
  token: RuntimeCapabilityToken<TValue>,
  providerId: string,
): RuntimeCapabilityDeclaration {
  if (token.cardinality !== "single") {
    throw new Error(`RUNTIME_CAPABILITY_PROVIDER_CARDINALITY_INVALID: ${token.id}`);
  }
  return createDeclaration(token, "provider", providerId);
}

/** 声明一个多贡献 Slot 的可选贡献。 */
export function contributeRuntimeCapability<TValue>(
  token: RuntimeCapabilityToken<TValue>,
  contributionId: string,
): RuntimeCapabilityDeclaration {
  if (token.cardinality !== "multiple") {
    throw new Error(`RUNTIME_CAPABILITY_CONTRIBUTION_CARDINALITY_INVALID: ${token.id}`);
  }
  return createDeclaration(token, "contribution", contributionId);
}

function createDeclaration<TValue>(
  token: RuntimeCapabilityToken<TValue>,
  kind: RuntimeCapabilityDeclaration["kind"],
  valueId: string,
): RuntimeCapabilityDeclaration {
  assertRuntimeCapabilityId(valueId, "RUNTIME_CAPABILITY_VALUE_ID_INVALID");
  return Object.freeze({
    token: token as RuntimeCapabilityToken<unknown>,
    kind,
    valueId,
  });
}

export function assertRuntimeCapabilityId(id: string, code: string): void {
  if (!RUNTIME_CAPABILITY_ID_PATTERN.test(id)) {
    throw new Error(`${code}: ${id}`);
  }
}
