import type {
  ToolPluginManifest,
  ToolPluginSourceProof,
  ToolPluginSourceVerification,
  ToolPluginTrustedSigner,
} from "../../domain/toolPlugins";
import { createToolPluginSourceSigningPayload } from "../../domain/toolPlugins";

const ECDSA_IMPORT_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_VERIFY_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

export async function verifyToolPluginSourceProof(
  manifest: ToolPluginManifest,
  proof: ToolPluginSourceProof,
  trustedSigners: readonly ToolPluginTrustedSigner[] = [],
): Promise<ToolPluginSourceVerification> {
  assertProofIdentity(manifest, proof);
  const publicKeyBytes = decodeBase64Url(proof.signer.publicKey.value);
  const signatureBytes = decodeBase64Url(proof.signature);
  if (signatureBytes.byteLength !== 64) throw new Error("TOOL_PLUGIN_SOURCE_SIGNATURE_INVALID");

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyBytes,
      ECDSA_IMPORT_ALGORITHM,
      false,
      ["verify"],
    );
  } catch {
    throw new Error("TOOL_PLUGIN_SOURCE_PUBLIC_KEY_INVALID");
  }
  const valid = await crypto.subtle.verify(
    ECDSA_VERIFY_ALGORITHM,
    publicKey,
    signatureBytes,
    createToolPluginSourceSigningPayload(proof),
  );
  if (!valid) throw new Error("TOOL_PLUGIN_SOURCE_SIGNATURE_INVALID");

  const keyFingerprint = await computeToolPluginKeyFingerprint(publicKeyBytes);
  const matchingIds = trustedSigners.filter((signer) => signer.id === proof.signer.id);
  if (matchingIds.length > 1) throw new Error("TOOL_PLUGIN_TRUST_STORE_INVALID");
  const trusted = matchingIds[0];
  if (trusted && trusted.keyFingerprint !== keyFingerprint) {
    throw new Error("TOOL_PLUGIN_SOURCE_SIGNER_KEY_MISMATCH");
  }
  return trusted
    ? {
        trustLevel: trusted.trustLevel,
        verificationMethod: "package-signature",
        signerId: trusted.id,
        signerLabel: trusted.label,
        keyFingerprint,
      }
    : {
        trustLevel: "signed",
        verificationMethod: "package-signature",
        signerId: proof.signer.id,
        keyFingerprint,
      };
}

export async function computeToolPluginKeyFingerprint(
  publicKeyBytes: Uint8Array,
): Promise<`sha256:${string}`> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyBytes));
  return `sha256:${[...digest].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function assertProofIdentity(manifest: ToolPluginManifest, proof: ToolPluginSourceProof): void {
  if (
    proof.plugin.id !== manifest.id
    || proof.plugin.version !== manifest.version
    || proof.plugin.contentHash !== manifest.contentHash
  ) {
    throw new Error("TOOL_PLUGIN_SOURCE_PROOF_IDENTITY_MISMATCH");
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  let decoded: string;
  try {
    decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new Error("TOOL_PLUGIN_SOURCE_PROOF_BASE64_INVALID");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
