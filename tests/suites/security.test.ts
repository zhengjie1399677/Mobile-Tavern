/**
 * SSRF 防护测试套件
 *
 * 验证 validateBaseUrlSecurity 能正确拦截本地/内网地址段，
 * 并放行公网合法地址。
 */

import { validateBaseUrlSecurity } from "../../server/security";
import { assert } from "./testUtils";

export async function testSsrfGuard() {
  console.log("\n--- Running SSRF Guard Verification ---");

  // Test cases that MUST be blocked
  const blockedCases = [
    "http://127.0.0.1",
    "http://localhost",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fd00::1]",
    "http://[::ffff:127.0.0.1]", // IPv4-mapped loopback bypass check
    "http://[::ffff:7f00:0001]", // hex IPv4-mapped loopback check
    "http://[::ffff:10.0.0.1]", // IPv4-mapped private check
    "http://0177.0.0.01", // octal format
    "http://0x7f000001", // hex format
    "http://2130706433", // decimal format
  ];

  // Test cases that MUST be allowed
  const allowedCases = [
    "http://172.32.0.1",
    "http://8.8.8.8",
    "https://github.com",
  ];

  for (const tc of blockedCases) {
    try {
      await validateBaseUrlSecurity(tc);
      throw new Error(`Bypass allowed on: ${tc}`);
    } catch (err: any) {
      assert(err.message.includes("restricted") || err.message.includes("Forbidden"), `Blocked correctly: ${tc}`);
      console.log(`✔ Correctly blocked: ${tc}`);
    }
  }

  for (const tc of allowedCases) {
    try {
      await validateBaseUrlSecurity(tc);
      console.log(`✔ Correctly allowed: ${tc}`);
    } catch (err: any) {
      throw new Error(`Valid target blocked: ${tc} - ${err.message}`);
    }
  }

  console.log("✔ SSRF Guard test suite passed!");
}
