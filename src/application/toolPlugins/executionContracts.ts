import type {
  ToolPluginCredentialDeclaration,
  ToolPluginHttpMethod,
  ToolPluginNetworkPolicy,
} from "../../domain/toolPlugins";

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

export interface ToolPluginNetworkContext {
  readonly pluginId: string;
  readonly policy: ToolPluginNetworkPolicy;
  readonly credentials: readonly ToolPluginCredentialDeclaration[];
  readonly resolveCredential: (credentialId: string) => Promise<string>;
  readonly signal: AbortSignal;
}

export interface ToolPluginHttpPort {
  request(request: ToolPluginNetworkRequest, context: ToolPluginNetworkContext): Promise<ToolPluginNetworkResponse>;
}

export interface ToolPluginWorkerExecution {
  readonly pluginId: string;
  readonly entryCode: string;
  readonly exportName: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
  readonly maxRequests: number;
  readonly network: (request: ToolPluginNetworkRequest) => Promise<ToolPluginNetworkResponse>;
}

export interface ToolPluginWorkerPort {
  execute(request: ToolPluginWorkerExecution): Promise<unknown>;
  getActiveWorkerCount(): number;
  destroy(): void;
}
