import type {
  AgentToolExecutionScope,
  AgentToolRiskLevel,
  AgentToolSideEffect,
} from "../agents/contracts";
import type { ToolPluginSourceProof, ToolPluginSourceVerification } from "./sourceProof";

export type ToolPluginExecutionTarget = "worker" | "sandbox";
export type ToolPluginHostCapability = "memory.write";

export type ToolPluginHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ToolPluginPermission =
  | "character.read"
  | "session.read"
  | "session.write"
  | "memory.read"
  | "memory.write"
  | "network.request";

export interface ToolPluginPermissionDeclaration {
  readonly id: ToolPluginPermission;
  readonly reason: string;
  readonly riskLevel: AgentToolRiskLevel;
  readonly optional?: boolean;
}

export interface ToolPluginToolDeclaration {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly permissions: readonly ToolPluginPermission[];
  readonly riskLevel: AgentToolRiskLevel;
  readonly sideEffect: AgentToolSideEffect;
  readonly executionScope: AgentToolExecutionScope;
  readonly handler?:
    | {
        readonly kind: "http";
        readonly request: ToolPluginHttpRequestTemplate;
      }
    | {
        readonly kind: "worker";
        readonly exportName: string;
      }
    | {
        readonly kind: "host";
        readonly capability: ToolPluginHostCapability;
      };
}

export interface ToolPluginHttpRequestTemplate {
  readonly method: ToolPluginHttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly credentialIds?: readonly string[];
}

export interface ToolPluginCredentialDeclaration {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly injection: {
    readonly location: "header" | "query";
    readonly name: string;
    readonly prefix?: string;
  };
}

export interface ToolPluginNetworkPolicy {
  readonly allowedOrigins: readonly string[];
  readonly allowedMethods: readonly ToolPluginHttpMethod[];
  readonly maxRequestsPerCall: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
}

export interface ToolPluginManifest {
  readonly format: "mobile-tavern.tool-plugin";
  readonly manifestVersion: 1 | 2;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly source: {
    readonly label: string;
    readonly url?: string;
  };
  /** v1 校验规范化 Manifest；v2 `.mttool` 同时覆盖除 manifest.json 外的包文件。 */
  readonly contentHash: `sha256:${string}`;
  readonly runtime: {
    readonly minVersion: string;
    readonly execution: ToolPluginExecutionTarget;
    readonly entry?: string;
    readonly timeoutMs?: number;
  };
  readonly network?: ToolPluginNetworkPolicy;
  readonly credentials?: readonly ToolPluginCredentialDeclaration[];
  readonly targetProfiles: readonly string[];
  readonly dependencies: readonly {
    readonly id: string;
    readonly version: string;
  }[];
  readonly permissions: readonly ToolPluginPermissionDeclaration[];
  readonly tools: readonly ToolPluginToolDeclaration[];
  readonly cleanup: {
    readonly onDisable: "revoke-runtime";
    readonly onPermissionRevoke: "disable-dependent-tools";
    readonly onUninstall: readonly ("registrations" | "credentials" | "plugin-data")[];
  };
}

export interface ToolPluginVersionSnapshot {
  readonly manifest: ToolPluginManifest;
  readonly archivedAt: number;
}

export interface ToolPluginArtifact {
  readonly pluginId: string;
  readonly contentHash: `sha256:${string}`;
  readonly entryCode?: string;
  readonly sourceProof?: ToolPluginSourceProof;
  readonly installedAt: number;
}

export interface ToolPluginInspection {
  readonly manifest: ToolPluginManifest;
  readonly artifact?: ToolPluginArtifact;
  readonly sourceProof?: ToolPluginSourceProof;
  readonly sourceVerification?: ToolPluginSourceVerification;
}

export interface InstalledToolPlugin {
  readonly id: string;
  readonly manifest: ToolPluginManifest;
  readonly installedAt: number;
  readonly updatedAt: number;
  readonly enabled: boolean;
  readonly grantedPermissions: readonly ToolPluginPermission[];
  readonly history: readonly ToolPluginVersionSnapshot[];
}

export interface ToolPluginCredentialStatus {
  readonly id: string;
  readonly configured: boolean;
  readonly updatedAt?: number;
}

export interface ToolPluginRuntimeDiagnostics {
  readonly registeredPlugins: readonly string[];
  readonly registeredTools: readonly string[];
  readonly activeWorkers: number;
  readonly failures: Readonly<Record<string, string>>;
}
