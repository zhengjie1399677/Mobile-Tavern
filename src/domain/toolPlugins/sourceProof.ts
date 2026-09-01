import { z } from "zod";
import { canonicalizeToolPluginValue } from "./manifestParser";

export const TOOL_PLUGIN_SOURCE_PROOF_PATH = "provenance.json";
export const TOOL_PLUGIN_SOURCE_PROOF_FORMAT = "mobile-tavern.tool-plugin-provenance";
export const TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM = "ECDSA-P256-SHA256";

export type ToolPluginSourceTrustLevel = "unverified" | "signed" | "trusted" | "official";

export interface ToolPluginSourceProof {
  readonly format: typeof TOOL_PLUGIN_SOURCE_PROOF_FORMAT;
  readonly proofVersion: 1;
  readonly plugin: {
    readonly id: string;
    readonly version: string;
    readonly contentHash: `sha256:${string}`;
  };
  readonly signer: {
    readonly id: string;
    readonly publicKey: {
      readonly format: "spki";
      readonly value: string;
    };
  };
  readonly algorithm: typeof TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM;
  readonly signature: string;
}

export interface ToolPluginTrustedSigner {
  readonly id: string;
  readonly label: string;
  readonly keyFingerprint: `sha256:${string}`;
  readonly trustLevel: "trusted" | "official";
}

export interface ToolPluginSourceVerification {
  readonly trustLevel: ToolPluginSourceTrustLevel;
  readonly signerId?: string;
  readonly signerLabel?: string;
  readonly keyFingerprint?: `sha256:${string}`;
}

const runtimeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/);
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

const sourceProofSchema = z.object({
  format: z.literal(TOOL_PLUGIN_SOURCE_PROOF_FORMAT),
  proofVersion: z.literal(1),
  plugin: z.object({
    id: runtimeIdSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  }).strict(),
  signer: z.object({
    id: runtimeIdSchema,
    publicKey: z.object({
      format: z.literal("spki"),
      value: base64UrlSchema.min(80).max(512),
    }).strict(),
  }).strict(),
  algorithm: z.literal(TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM),
  signature: base64UrlSchema.min(80).max(256),
}).strict();

export function parseToolPluginSourceProof(input: string | ArrayBuffer | Uint8Array): ToolPluginSourceProof {
  const text = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true }).decode(
      input instanceof Uint8Array ? input : new Uint8Array(input),
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("TOOL_PLUGIN_SOURCE_PROOF_INVALID_JSON");
  }
  const parsed = sourceProofSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`TOOL_PLUGIN_SOURCE_PROOF_INVALID:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return structuredClone(parsed.data) as ToolPluginSourceProof;
}

export function createToolPluginSourceSigningPayload(proof: ToolPluginSourceProof): Uint8Array {
  const { signature: _signature, ...signable } = proof;
  return new TextEncoder().encode(canonicalizeToolPluginValue(signable));
}

export function unsignedToolPluginSource(): ToolPluginSourceVerification {
  return { trustLevel: "unverified" };
}
