export type ToolPluginRiskLevel = "low" | "medium" | "high";

export type ToolPluginSideEffect = "none" | "local-write" | "external" | "irreversible";

export type ToolPluginExecutionScope = "turn" | "session" | "memory" | "character" | "external";

export type ToolPluginHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ToolPluginPermission =
  | "character.read"
  | "session.read"
  | "session.write"
  | "memory.read"
  | "memory.write"
  | "network.request";

export interface ToolPluginJsonSchema {
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, ToolPluginJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: ToolPluginJsonSchema;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ToolPluginNetworkRequest {
  readonly method: ToolPluginHttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly credentialIds?: readonly string[];
}

export interface ToolPluginNetworkResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: unknown;
}

export interface ToolPluginWorkerHost {
  network(request: ToolPluginNetworkRequest): Promise<ToolPluginNetworkResponse>;
}

export type ToolPluginWorkerHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  host: ToolPluginWorkerHost,
) => TOutput | Promise<TOutput>;

export type ToolPluginWorkerHandlers = Readonly<Record<string, ToolPluginWorkerHandler>>;

export interface ToolPluginManifestDefinition {
  readonly format: "mobile-tavern.tool-plugin";
  readonly manifestVersion: 2;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly source: {
    readonly label: string;
    readonly url?: string;
  };
  readonly runtime: {
    readonly minVersion: string;
    readonly execution: "worker";
    readonly entry?: string;
    readonly timeoutMs?: number;
  };
  readonly network?: {
    readonly allowedOrigins: readonly string[];
    readonly allowedMethods: readonly ToolPluginHttpMethod[];
    readonly maxRequestsPerCall: number;
    readonly maxRequestBytes: number;
    readonly maxResponseBytes: number;
  };
  readonly credentials?: readonly {
    readonly id: string;
    readonly label: string;
    readonly required: boolean;
    readonly injection: {
      readonly location: "header" | "query";
      readonly name: string;
      readonly prefix?: string;
    };
  }[];
  readonly targetProfiles: readonly string[];
  readonly dependencies: readonly {
    readonly id: string;
    readonly version: string;
  }[];
  readonly permissions: readonly {
    readonly id: ToolPluginPermission;
    readonly reason: string;
    readonly riskLevel: ToolPluginRiskLevel;
    readonly optional?: boolean;
  }[];
  readonly tools: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly inputSchema: ToolPluginJsonSchema;
    readonly outputSchema: ToolPluginJsonSchema;
    readonly permissions: readonly ToolPluginPermission[];
    readonly riskLevel: ToolPluginRiskLevel;
    readonly sideEffect: ToolPluginSideEffect;
    readonly executionScope: ToolPluginExecutionScope;
    readonly composerCommand?: {
      readonly name: string;
      readonly inputProperty?: string;
      readonly outputProperty: string;
    };
    readonly handler:
      | {
          readonly kind: "http";
          readonly request: ToolPluginNetworkRequest;
        }
      | {
          readonly kind: "worker";
          readonly exportName: string;
        }
      | {
          readonly kind: "host";
          readonly capability:
            | "memory.write"
            | "system.time"
            | "random.dice"
            | "random.coin"
            | "random.pick"
            | "text.count";
        };
  }[];
  readonly cleanup: {
    readonly onDisable: "revoke-runtime";
    readonly onPermissionRevoke: "disable-dependent-tools";
    readonly onUninstall: readonly ["registrations", "credentials", "plugin-data"];
  };
}

export function defineToolPluginManifest<const TManifest extends ToolPluginManifestDefinition>(
  manifest: TManifest,
): TManifest {
  return manifest;
}

export function defineToolPluginHandlers<const THandlers extends ToolPluginWorkerHandlers>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export function registerToolPlugin(handlers: ToolPluginWorkerHandlers): void {
  const target = globalThis as typeof globalThis & {
    MobileTavernToolPlugin?: { readonly tools: ToolPluginWorkerHandlers };
  };
  target.MobileTavernToolPlugin = Object.freeze({ tools: Object.freeze({ ...handlers }) });
}
