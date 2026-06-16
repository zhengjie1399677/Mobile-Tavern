// Simulating mobile client environment (Tauri WebView)
(global as any).window = {
  location: {
    protocol: "tauri:",
    hostname: "tauri.localhost"
  },
  __TAURI_INTERNALS__: {}
};

import { apiClient } from "../src/utils/apiClient";
import json5 from "json5"; // standard dependency in the project

async function run() {
  console.log("================================================");
  printUtf8("🚀 Running mobile client sendCatbotRequest test...");
  console.log("================================================");

  const content = "你好喵！你喜欢吃小鱼干吗？🐾";
  const history: any[] = [];
  const clientContext = {
    deviceId: "mobile_test_device_js_client",
    userName: "移动端测试玩家",
    platform: "Android",
    language: "zh-CN",
    timezone: "Asia/Shanghai"
  };

  try {
    printUtf8(`Sending message: "${content}"`);
    const startTime = Date.now();
    
    const res = await apiClient.sendCatbotRequest(content, history, clientContext);
    
    const elapsed = Date.now() - startTime;
    printUtf8(`\nSuccess! Response received in ${elapsed}ms:`);
    printUtf8(JSON.stringify(res, null, 2));
  } catch (err: any) {
    printUtf8(`\nFailed to receive response: ${err.message || err}`);
  }
}

// Utility to print UTF-8 clearly on Windows shell console
function printUtf8(text: string) {
  try {
    const buf = Buffer.from(text, "utf-8");
    process.stdout.write(buf.toString() + "\n");
  } catch {
    console.log(text);
  }
}

run();
