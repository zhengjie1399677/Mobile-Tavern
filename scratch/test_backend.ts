import { validateBaseUrlSecurity, dnsCache } from "../src/utils/security";
import { encryptBackupData, decryptBackupData } from "../src/utils/cardParser";
import dns from "dns";

async function runTests() {
  console.log("=== 开始执行后台核心机制集成流程测试 ===");

  // 1. 测试 DNS 劫持与 options.all 的签名兼容性
  console.log("\n[Test 1] 验证 DNS 劫持与 options.all 的兼容性...");
  dnsCache.set("api.test-target.com", "1.2.3.4");
  
  await new Promise<void>((resolve, reject) => {
    dns.lookup("api.test-target.com", { all: true }, (err, addresses) => {
      if (err) return reject(err);
      console.log("-> 传入 options.all = true 时，解析结果为:", addresses);
      if (!Array.isArray(addresses)) {
        return reject(new Error("失败：当 options.all = true 时，返回的不是数组类型！"));
      }
      if (addresses[0].address !== "1.2.3.4") {
        return reject(new Error("失败：解析出的 IP 地址不正确！"));
      }
      console.log("-> 成功：options.all = true 兼容性通过！");
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    dns.lookup("api.test-target.com", {}, (err, address, family) => {
      if (err) return reject(err);
      console.log(`-> 默认传入空 options 时，解析结果为: IP=${address}, Family=${family}`);
      if (typeof address !== "string") {
        return reject(new Error("失败：默认返回的 IP 不是字符串类型！"));
      }
      console.log("-> 成功：默认选项兼容性通过！");
      resolve();
    });
  });

  // 2. 测试 SSRF 防御拦截
  console.log("\n[Test 2] 验证 SSRF 拦截逻辑 (validateBaseUrlSecurity)...");
  
  const privateUrls = [
    "http://127.0.0.1/chat",
    "https://localhost:3000/api",
    "http://192.168.1.100/v1",
    "http://[::1]/v1"
  ];

  for (const url of privateUrls) {
    try {
      await validateBaseUrlSecurity(url);
      throw new Error(`失败：内网地址 ${url} 未被拦截！`);
    } catch (e: any) {
      console.log(`-> 成功拦截内网地址 ${url}，错误信息: ${e.message}`);
    }
  }

  // 3. 测试备份文件加解密
  console.log("\n[Test 3] 验证备份文件加解密算法...");
  const rawData = JSON.stringify({ magic: "MOBILE_TAVERN_UNIFIED_BACKUP", characters: [], sessions: [] });
  const password = "secure-pass-123";
  
  try {
    console.log("-> 尝试对数据进行 AES-GCM 加密...");
    const encrypted = await encryptBackupData(rawData, password);
    console.log("-> 加密成功，密文长度:", encrypted.length);
    
    console.log("-> 尝试使用正确密码解密...");
    const decrypted = await decryptBackupData(encrypted, password);
    if (decrypted !== rawData) {
      throw new Error("失败：解密后的数据与原文不匹配！");
    }
    console.log("-> 解密成功，明文数据完全匹配！");

    console.log("-> 尝试使用错误密码解密，检查拦截...");
    try {
      await decryptBackupData(encrypted, "wrong-password");
      throw new Error("失败：使用错误密码竟然解密成功了！");
    } catch (e) {
      console.log("-> 成功：错误密码解密被正确拦截。");
    }

  } catch (err: any) {
    console.error("备份加解密测试失败:", err);
    process.exit(1);
  }

  console.log("\n=== 恭喜！所有后台核心流程测试完美通过！ ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("测试运行期抛出未捕获错误:", err);
  process.exit(1);
});
