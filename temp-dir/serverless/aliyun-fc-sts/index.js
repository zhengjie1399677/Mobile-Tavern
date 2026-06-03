const Core = require('@alicloud/pop-core');

// 1. 初始化 RAM Client (利用配置在 FC 环境变量中的主账户或权限较高的 RAM AKSK)
// 注意：千万不要在这里硬编码明文 AKSK，务必在 FC 控制台 -> 环境变量 中配置
let client;
try {
  client = new Core({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    endpoint: 'https://sts.aliyuncs.com',
    apiVersion: '2015-04-01',
  });
} catch (err) {
  console.error("Failed to initialize Core client:", err);
}

// 2. 简单的内存级 IP 频率控制防刷保护
// 说明: 单实例 FC 通过内存 Map 控制。如果您使用了极高并发或多实例 FC，
// 内存 Map 会由于实例隔离而不够精确（同一 IP 可能去不同实例）。
// 若要求极其严谨的防刷，建议替换为阿里云 Redis，或者在 FC 前方叠加 WAF 防火墙代理。
const ipCache = new Map();
const RPM_LIMIT = 5;         // 每个 IP 一分钟内最多请求次数
const WINDOW_MS = 60 * 1000; // 时间窗口 1分钟

/**
 * 阿里云 HTTP 函数入口
 */
exports.handler = async (req, resp, context) => {
  // 设置 CORS 头，允许客户端前端调用
  resp.setHeader('Access-Control-Allow-Origin', '*');
  resp.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  resp.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 对预检请求直接返回
  if (req.method === 'OPTIONS') {
    resp.setStatusCode(200);
    resp.send('');
    return;
  }

  // --- 安全检查：频率限制 (Rate Limiting) ---
  const clientIP = req.clientIP || req.headers['x-forwarded-for'] || 'unknown-ip';
  const now = Date.now();
  const record = ipCache.get(clientIP) || { count: 0, firstSeen: now };
  
  if (now - record.firstSeen > WINDOW_MS) {
     record.firstSeen = now;
     record.count = 0;
  }
  
  if (record.count >= RPM_LIMIT) {
     resp.setStatusCode(429);
     resp.send(JSON.stringify({ 
       error: "Too Many Requests", 
       message: "Your IP has requested tokens too frequently. Please try again later."
     }));
     return;
  }
  
  record.count += 1;
  ipCache.set(clientIP, record);
  // --- 频率限制结束 ---

  // --- 签发 STS 逻辑 ---
  if (!client) {
    resp.setStatusCode(500);
    resp.send(JSON.stringify({ error: "Server Configuration Error: Missing AKSK." }));
    return;
  }

  const roleArn = process.env.STS_ROLE_ARN; 
  if (!roleArn) {
    resp.setStatusCode(500);
    resp.send(JSON.stringify({ error: "Server Configuration Error: Missing STS_ROLE_ARN." }));
    return;
  }

  try {
    const params = {
      "Action": "AssumeRole",
      // 配置的 RAM 角色 ARN，只拥有允许目标 Logstore PutLogs 操作的最小权限策略
      "RoleArn": roleArn,
      "RoleSessionName": `client-${clientIP.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      "DurationSeconds": 3600 // 凭证有效期 1 小时 (必须在 15min ~ 12h 之间)
    };

    const requestOption = { method: 'POST' };
    const stsResponse = await client.request('AssumeRole', params, requestOption);
    
    resp.setStatusCode(200);
    resp.setHeader('Content-Type', 'application/json');
    // 发送仅含 STS Token 的精简对象给前端
    resp.send(JSON.stringify({
      AccessKeyId: stsResponse.Credentials.AccessKeyId,
      AccessKeySecret: stsResponse.Credentials.AccessKeySecret,
      SecurityToken: stsResponse.Credentials.SecurityToken,
      Expiration: stsResponse.Credentials.Expiration,
      // 附加 SLS 配置信息，从而减少前端的环境变量依赖
      SlsEndpoint: process.env.SLS_ENDPOINT || "", // 例如: https://cn-beijing.log.aliyuncs.com
      SlsProject: process.env.SLS_PROJECT || "",
      SlsLogstore: process.env.SLS_LOGSTORE || ""
    }));
  } catch (error) {
    console.error("STS AssumeRole Error:", error);
    resp.setStatusCode(500);
    resp.send(JSON.stringify({ error: error.message || "Failed to issue STS token" }));
  }
};
