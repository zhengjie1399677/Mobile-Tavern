import { describe, expect, it } from "vitest";
import {
  createToolPluginSourceSigningPayload,
  parseToolPluginSourceProof,
  TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
  TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
  unsignedToolPluginSource,
} from "../../src/domain/toolPlugins";

const proof = {
  format: TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
  proofVersion: 1,
  plugin: {
    id: "example.text-toolkit",
    version: "1.0.0",
    contentHash: `sha256:${"a".repeat(64)}`,
  },
  signer: {
    id: "example.publisher",
    publicKey: {
      format: "spki",
      value: "A".repeat(120),
    },
  },
  algorithm: TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
  signature: "B".repeat(86),
} as const;

describe("Tool Plugin 来源证明契约", () => {
  it("严格解析签名者、包身份和固定算法", () => {
    expect(parseToolPluginSourceProof(JSON.stringify(proof))).toEqual(proof);
    expect(unsignedToolPluginSource()).toEqual({ trustLevel: "unverified" });
  });

  it("签名载荷不包含 signature 且不受对象字段顺序影响", () => {
    const reordered = {
      signature: proof.signature,
      algorithm: proof.algorithm,
      signer: proof.signer,
      plugin: proof.plugin,
      proofVersion: proof.proofVersion,
      format: proof.format,
    };
    const first = new TextDecoder().decode(createToolPluginSourceSigningPayload(proof));
    const second = new TextDecoder().decode(createToolPluginSourceSigningPayload(reordered));
    expect(first).toBe(second);
    expect(first).not.toContain("signature");
    expect(first).toContain(proof.plugin.contentHash);
  });

  it("拒绝未知算法、未知字段和宽松 Base64", () => {
    expect(() => parseToolPluginSourceProof(JSON.stringify({
      ...proof,
      algorithm: "ES256",
    }))).toThrow("TOOL_PLUGIN_SOURCE_PROOF_INVALID");
    expect(() => parseToolPluginSourceProof(JSON.stringify({
      ...proof,
      signature: "not+base64/value=",
    }))).toThrow("TOOL_PLUGIN_SOURCE_PROOF_INVALID");
    expect(() => parseToolPluginSourceProof(JSON.stringify({
      ...proof,
      sourceUrl: "https://example.com",
    }))).toThrow("TOOL_PLUGIN_SOURCE_PROOF_INVALID");
  });
});
