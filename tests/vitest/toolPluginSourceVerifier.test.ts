import { describe, expect, it } from "vitest";
import type {
  ToolPluginSourceProof,
  ToolPluginTrustedSigner,
} from "../../src/domain/toolPlugins";
import {
  createToolPluginSourceSigningPayload,
  TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
  TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
} from "../../src/domain/toolPlugins";
import {
  computeToolPluginKeyFingerprint,
  verifyToolPluginSourceProof,
} from "../../src/infrastructure/toolPlugins/toolPluginSourceVerifier";
import { toolPluginManagementUseCases } from "../../src/application/useCases/toolPluginManagementUseCases";
import { parseToolPluginPackage } from "../../src/domain/toolPlugins";
import { createV2WorkerPackage } from "./helpers/toolPluginFixture";

describe("Tool Plugin 包签名验证", () => {
  it("区分有效未知签名与宿主可信签名", async () => {
    const inspection = await parseToolPluginPackage(await createV2WorkerPackage());
    const { proof, fingerprint } = await createSignedProof(inspection.manifest);

    await expect(verifyToolPluginSourceProof(inspection.manifest, proof)).resolves.toMatchObject({
      trustLevel: "signed",
      verificationMethod: "package-signature",
      signerId: "example.publisher",
      keyFingerprint: fingerprint,
    });
    const trusted: ToolPluginTrustedSigner = {
      id: "example.publisher",
      label: "示例发布者",
      keyFingerprint: fingerprint,
      trustLevel: "trusted",
    };
    await expect(verifyToolPluginSourceProof(inspection.manifest, proof, [trusted])).resolves.toEqual({
      trustLevel: "trusted",
      verificationMethod: "package-signature",
      signerId: "example.publisher",
      signerLabel: "示例发布者",
      keyFingerprint: fingerprint,
    });
  });

  it("拒绝身份错配、签名篡改和可信 ID 的密钥替换", async () => {
    const inspection = await parseToolPluginPackage(await createV2WorkerPackage());
    const { proof, fingerprint } = await createSignedProof(inspection.manifest);
    await expect(verifyToolPluginSourceProof(inspection.manifest, {
      ...proof,
      plugin: { ...proof.plugin, version: "2.0.0" },
    })).rejects.toThrow("TOOL_PLUGIN_SOURCE_PROOF_IDENTITY_MISMATCH");
    await expect(verifyToolPluginSourceProof(inspection.manifest, {
      ...proof,
      signature: `${proof.signature[0] === "A" ? "B" : "A"}${proof.signature.slice(1)}`,
    })).rejects.toThrow("TOOL_PLUGIN_SOURCE_SIGNATURE_INVALID");
    await expect(verifyToolPluginSourceProof(inspection.manifest, proof, [{
      id: "example.publisher",
      label: "示例发布者",
      keyFingerprint: `sha256:${"0".repeat(64)}`,
      trustLevel: "official",
    }])).rejects.toThrow("TOOL_PLUGIN_SOURCE_SIGNER_KEY_MISMATCH");
    expect(fingerprint).not.toBe(`sha256:${"0".repeat(64)}`);
  });

  it("在文件审阅边界验证签名，未签名包明确降级", async () => {
    const unsignedBytes = await createV2WorkerPackage();
    const manifest = (await parseToolPluginPackage(unsignedBytes)).manifest;
    const { proof } = await createSignedProof(manifest);
    const signedBytes = await createV2WorkerPackage(undefined, proof);

    await expect(toolPluginManagementUseCases.inspectFile(
      new File([signedBytes], "signed.mttool"),
    )).resolves.toMatchObject({
      sourceVerification: {
        trustLevel: "signed",
        verificationMethod: "package-signature",
        signerId: "example.publisher",
      },
    });
    await expect(toolPluginManagementUseCases.inspectFile(
      new File([unsignedBytes], "unsigned.mttool"),
    )).resolves.toMatchObject({
      sourceVerification: {
        trustLevel: "unverified",
        verificationMethod: "unsigned",
      },
    });
  });
});

async function createSignedProof(
  manifest: Awaited<ReturnType<typeof parseToolPluginPackage>>["manifest"],
): Promise<{ proof: ToolPluginSourceProof; fingerprint: `sha256:${string}` }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const unsigned: ToolPluginSourceProof = {
    format: TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
    proofVersion: 1,
    plugin: {
      id: manifest.id,
      version: manifest.version,
      contentHash: manifest.contentHash,
    },
    signer: {
      id: "example.publisher",
      publicKey: { format: "spki", value: encodeBase64Url(publicKeyBytes) },
    },
    algorithm: TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
    signature: "A".repeat(86),
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    createToolPluginSourceSigningPayload(unsigned),
  ));
  return {
    proof: { ...unsigned, signature: encodeBase64Url(signature) },
    fingerprint: await computeToolPluginKeyFingerprint(publicKeyBytes),
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
