import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ssrfGuard } from "./server/security";
import crypto from "crypto";

dotenv.config();

let resolvedDirname = "";
try {
  resolvedDirname = __dirname;
} catch (e) {
  resolvedDirname = process.cwd();
}

function sanitizeSensitiveData(input: string): string {
  if (!input) return "";
  return input
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[MASKED_KEY]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{12,}\b/g, "[MASKED_KEY]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9_.-]+/gi, "$1[MASKED_KEY]");
}

/**
 * 按数字逐段比较语义化版本号。
 * 解决字符串比较导致的 '1.10.0' < '1.6.0' 误判问题。
 * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
 */
function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => v.split('.').map((seg) => {
    const n = parseInt(seg, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

interface ProxyRequestConfig {
  baseUrl: string;
  routePath: string;
  apiKey?: string;
}

/**
 * 简单的内存速率限制器（基于 IP）。
 * 用于 /api/check-update 端点的防刷兜底。
 * 注意：仅适用于单实例开发服务端；生产环境由阿里云 FC 网关层限流。
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const updateCheckRateLimitMap = new Map<string, RateLimitEntry>();
const UPDATE_CHECK_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟窗口
const UPDATE_CHECK_RATE_LIMIT_MAX_REQUESTS = 10;     // 每窗口最多 10 次

function checkUpdateRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = updateCheckRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    updateCheckRateLimitMap.set(ip, { count: 1, resetAt: now + UPDATE_CHECK_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }
  entry.count += 1;
  if (entry.count > UPDATE_CHECK_RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function prepareProxyRequest({ baseUrl, routePath, apiKey }: ProxyRequestConfig) {
  if (!baseUrl || (typeof baseUrl === "string" && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://"))) {
    throw new Error("Invalid baseUrl protocol. Only http:// and https:// are allowed.");
  }
  const sanitizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const sanitizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const targetUrl = `${sanitizedBaseUrl}${sanitizedRoute}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    console.log(`[Proxy Request] API Key loaded into authorization header.`);
  } else {
    console.log(`[Proxy Request] No API Key loaded in proxy header!`);
  }

  return { targetUrl, headers };
}

async function startServer() {
  console.log("[Local Server] startServer invoked.");
  const app = express();
  const PORT = 3000;

  // Use JSON parser with higher limits for backups and character cards
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API 1.5: Issue Self-Signed Token (Stateless)
  app.post("/api/issue-token", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    try {
      const { deviceId } = req.body || {};
      const devIdHeader = req.headers["x-device-id"];
      const finalDeviceId = deviceId || (Array.isArray(devIdHeader) ? devIdHeader[0] : devIdHeader);
      if (!finalDeviceId) {
        return res.status(400).json({ error: "deviceId is required" });
      }
      const cleanDeviceId = String(finalDeviceId).replace(/[^a-zA-Z0-9_]/g, "_");
      const exp = Math.floor(Date.now() / 1000) + 30 * 60; // 30 mins
      const payload = {
        deviceId: cleanDeviceId,
        exp,
      };
      const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signKey = process.env.HMAC_SIGN_KEY || "default_local_hmac_sign_key_123456";
      const signature = crypto
        .createHmac("sha256", signKey)
        .update(payloadStr)
        .digest("base64url");
      const token = `${payloadStr}.${signature}`;
      res.json({
        token,
        expiresAt: exp * 1000,
      });
    } catch (err: any) {
      console.error("[Local Server] Issue Token Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 1.6: Get Encrypted API Key (Stateless)
  app.post("/api/get-key", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    try {
      const authHeader = req.headers["authorization"];
      let token = "";
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
      if (!token) {
        return res.status(401).json({ error: "Authorization token is required" });
      }
      const parts = token.split(".");
      if (parts.length !== 2) {
        return res.status(401).json({ error: "Invalid token format" });
      }
      const [payloadStr, signature] = parts;
      const signKey = process.env.HMAC_SIGN_KEY || "default_local_hmac_sign_key_123456";
      const expectedSignature = crypto
        .createHmac("sha256", signKey)
        .update(payloadStr)
        .digest("base64url");

      const sigBuffer = Buffer.from(signature);
      const expBuffer = Buffer.from(expectedSignature);
      if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
        return res.status(401).json({ error: "Invalid token signature" });
      }
      const payloadJson = Buffer.from(payloadStr, "base64url").toString("utf8");
      const payload = JSON.parse(payloadJson);
      if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
        return res.status(401).json({ error: "Token has expired" });
      }
      const realApiKey = process.env.REAL_API_KEY || process.env.TRIAL_OPENROUTER_KEY || "sk-or-v1-TRIAL_KEY_PLACEHOLDER_LOCAL_DEVELOPMENT_FALLBACK";
      const aesKeyHex = process.env.AES_ENCRYPT_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const keyBytes = Buffer.from(aesKeyHex, "hex");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes, iv);
      let encrypted = cipher.update(realApiKey, "utf8", "hex");
      encrypted += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");
      res.json({
        ciphertext: encrypted,
        iv: iv.toString("hex"),
        tag: tag,
      });
    } catch (err: any) {
      console.error("[Local Server] Get Key Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 1: Version checking
  app.get("/version", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    try {
      const pkgPath = path.join(resolvedDirname, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      res.json({ pkgVersion: pkg.version || "1.6.1" });
    } catch (e) {
      res.json({ pkgVersion: "1.6.1" });
    }
  });

  // API 2: Test connection for API config
  app.post("/api/test-connection", ssrfGuard, async (req, res) => {
    try {
      const { type, baseUrl, apiKey, modelName, chatPath } = req.body || {};
      const { targetUrl, headers } = prepareProxyRequest({
        baseUrl,
        routePath: chatPath || "/chat/completions",
        apiKey,
      });
      console.log(`[Proxy TestConnection] Target URL: ${sanitizeSensitiveData(targetUrl)}`);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelName || "gpt-3.5-turbo",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        res.json({ success: true, message: "Connected successfully!", data });
      } else {
        const errText = await response.text();
        res.json({ success: false, error: `HTTP ${response.status}: ${errText}` });
      }
    } catch (e: any) {
      res.json({ success: false, error: e.message });
    }
  });

  // API 3: OpenAI API Proxy (CORS Bypass for mobile/iframe compatibility)
  app.post("/api/proxy/openai", ssrfGuard, async (req, res) => {
    const controller = new AbortController();
    req.on("close", () => {
      controller.abort();
    });

    try {
      const { baseUrl, apiKey, reqBody = {}, chatPath } = req.body || {};
      const { targetUrl, headers } = prepareProxyRequest({
        baseUrl,
        routePath: chatPath || "/chat/completions",
        apiKey,
      });

      const isStream = reqBody.stream === true;
      console.log(`[Proxy OpenAI] Target URL: ${sanitizeSensitiveData(targetUrl)}, isStream: ${isStream}`);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `API returned error [${response.status}]: ${errorText}`,
        });
      }

      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      if (req.destroyed || res.writableEnded) {
        console.log("OpenAI Proxy Chat connection closed by client.");
        return;
      }
      console.error("OpenAI Proxy Chat Error:", sanitizeSensitiveData(error.stack || error.message || String(error)));
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: sanitizeSensitiveData(error.message || "Failed to make proxied request."),
        });
      } else {
        res.end();
      }
    }
  });

  // API 4: Models Fetch Proxy
  app.post("/api/proxy/models", ssrfGuard, async (req, res) => {
    try {
      const { type, baseUrl, apiKey, modelsPath } = req.body || {};
      const { targetUrl, headers } = prepareProxyRequest({
        baseUrl,
        routePath: modelsPath || "/models",
        apiKey,
      });

      const response = await fetch(targetUrl, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `API returned error [${response.status}]: ${errorText}`,
        });
      }

      const data = await response.json();
      let modelsArray = [];
      if (Array.isArray(data)) {
        modelsArray = data;
      } else if (data.data && Array.isArray(data.data)) {
        modelsArray = data.data;
      } else if (data.models && Array.isArray(data.models)) {
        modelsArray = data.models;
      } else if (typeof data === "object") {
        modelsArray = Object.values(data).filter((v: any) => v && (v.id || v.name));
      }
      res.json({ success: true, models: modelsArray.map((m: any) => ({ id: m.id || m.name })) });
    } catch (error: any) {
      console.error("Models Proxy Error:", sanitizeSensitiveData(error.stack || error.message || String(error)));
      res.status(500).json({
        success: false,
        error: sanitizeSensitiveData(error.message || "Failed to fetch models."),
      });
    }
  });

  // API 5: Catbot interaction with intent determination & classification
  app.post("/api/catbot", async (req, res) => {
    const { content, history = [], clientContext } = req.body || {};
    const deviceId = clientContext?.deviceId || req.headers["x-device-id"] || "local_dev_user";

    // 优先转发到阿里云 FC 真实云端客服服务（解决本地 Web 调试由于跨域无法直连云端的问题）
    const cloudFcUrl = process.env.CATBOT_FC_URL || "https://catbot-gmkodirnhh.cn-hangzhou.fcapp.run/api/catbot";
    console.log(`[Catbot Proxy] 收到本地请求，尝试转发到云端 FC: ${cloudFcUrl}`);

    try {
      const controller = new AbortController();
      const fcTimeout = setTimeout(() => controller.abort(), 12000); // 12秒云端超时限制

      const response = await fetch(cloudFcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId as string
        },
        body: JSON.stringify({
          content,
          history,
          clientContext: {
            ...clientContext,
            device_id: deviceId
          }
        }),
        signal: controller.signal
      });

      clearTimeout(fcTimeout);

      if (response.ok) {
        const cloudData: any = await response.json();
        console.log(`[Catbot Proxy] 云端 FC 响应成功:`, JSON.stringify(cloudData));

        // 根据云端返回的 category 精准映射前端小猫所需的情绪表情
        let expression = "idle";
        const cat = cloudData.category || "chat";
        if (cat === "bug") {
          expression = "sleepy"; // 犯困/半躺半睡表情，契合 Bug 卡住状态
        } else if (cat === "tech") {
          expression = "thinking"; // 歪头思考问号表情
        } else {
          // 闲聊时有概率给点舒服舔毛表情，增强动感
          expression = Math.random() > 0.5 ? "relax" : "idle";
        }

        return res.json({
          reply: cloudData.reply,
          expression: expression,
          category: cloudData.category,
          quota: cloudData.quota,
          bugReported: cloudData.bugReported,
          fromCloud: true
        });
      } else {
        const errBody = await response.text();
        console.warn(`[Catbot Proxy] 云端 FC 返回 HTTP 错误码 ${response.status}: ${errBody}，准备降级为本地处理器`);

        const errLower = errBody.toLowerCase();
        if (
          response.status === 429 ||
          errLower.includes("quota") ||
          errLower.includes("limit") ||
          errLower.includes("insufficient") ||
          errLower.includes("exceeded") ||
          errLower.includes("balance") ||
          errLower.includes("funds") ||
          errLower.includes("次数用尽") ||
          errLower.includes("额度已满") ||
          errLower.includes("不够") ||
          errLower.includes("欠费")
        ) {
          const text = (content || "").toLowerCase();
          const bugKeywords = /闪退|崩溃|报错|打不开|显示不了|无法导入|卡死|黑屏|同步失败|数据丢失|白屏|错误|异常|bug/i;
          const techKeywords = /怎么|如何|哪里|配置|设置|怎么用|怎么导入|怎么备份|格式|指南|使用方法|教程|导入/i;
          let estimated_category = "chat";
          if (bugKeywords.test(text)) {
            estimated_category = "bug";
          } else if (techKeywords.test(text)) {
            estimated_category = "tech";
          }

          let reply = "呜呜，今天找本喵聊天的次数已经用光光了，本喵累了要去睡觉了喵……明天再来找我玩吧喵💤";
          if (estimated_category === "bug") {
            reply = "喵呜……今天帮本喵记 Bug 的次数已经用光了，本喵的小本本都已经写满啦！明天再来告诉本喵关于 Bug 的事情吧喵~ 🐾";
          } else if (estimated_category === "tech") {
            reply = "唔……今天解答的技术问题太多啦，本喵的脑瓜转不动了，明天再来问本喵关于设置和配置的事喵~ 💤";
          }
          return res.json({
            reply,
            expression: "sleep"
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Catbot Proxy] 转发至云端 FC 失败 (${sanitizeSensitiveData(err.message)})，降级为本地处理器。`);
    }

    // ================== 本地处理器降级兜底逻辑 ==================
    try {
      if (clientContext) {
        console.log(`[Catbot Server Fallback] Received client device context:`, JSON.stringify(clientContext, null, 2));
      }
      const apiKey = process.env.DASHSCOPE_API_KEY;

      if (!apiKey) {
        // Fallback: Local rule-based keyword matcher if no API key is provided
        const text = (content || "").toLowerCase();
        let reply = "喵呜，本喵现在无法连上云端脑区，先用本地的小脑袋回答你喵！\n\n";
        let expression = "talking";

        if (text.includes("api") || text.includes("key") || text.includes("接口") || text.includes("连接") || text.includes("设置")) {
          reply += "关于 API 密钥配置，请在下方“设置”中找到“API服务端点配置”面板进行填写喵！确认无误后可以点击测试连接。";
          expression = "thinking";
        } else if (text.includes("卡") || text.includes("角色") || text.includes("导入")) {
          reply += "要导入角色卡，只需要在“角色馆”页面点击右上角的“+”号选择你的角色卡 JSON 文件或带 EXIF PNG 的角色图片即可喵！";
          expression = "talking";
        } else if (text.includes("世界") || text.includes("设定") || text.includes("词条")) {
          reply += "点进【世界书】页签后，默认只显示各个角色卡或全局词库的折叠标题喵。你需要点击一下大类名称（例如 '雪团'、'莉莉丝' 或 '🌎 全局共享词库'），才会展开看到它专属的词条列表与详细内容喵！";
          expression = "thinking";
        } else if (text.includes("报错") || text.includes("闪退") || text.includes("错误")) {
          reply += "如果遇到连接报错，可以尝试去设置里清理一下缓存，或者检查当前所用的 API Key / 代理服务器是否可达喵。";
          expression = "sleepy";
        } else {
          const randomReplies = [
            "唔，你在说什么高深的技术话题喵？本喵有点听不懂，不过本喵在认真听哦！",
            "酒馆里有好多秘密喵，比如下方第三项是世界书，可以帮你设定各种复杂背景喵~",
            "（用爪子刨了刨地板）今天又是和平的一天，要不要去和你的虚拟角色聊聊天喵？",
            "喵呜~ 听说酒馆里有很多厉害的设定，去角色馆选一个聊聊看吧喵！"
          ];
          reply = randomReplies[Math.floor(Math.random() * randomReplies.length)];
          expression = "idle";
        }

        return res.json({ reply, expression });
      }

      // 本地有 API Key 时的备用直连 DashScope 逻辑
      const systemPrompt = `你是一只傲娇又博学的雪团助手猫咪（名字叫“雪团”）。你的职责是解答用户关于 Mobile Tavern (移动酒馆) 软件的使用疑问，或者进行日常的幽默闲聊。
核心性格：说话轻快活泼，喜欢带“喵~”的语气助词，带有一点点猫咪特有的高傲与温柔。
要求：对用户的输入进行分析，判断问题类型，并选择一个合适的猫咪情绪表情（从 "idle"(清醒端坐待机), "thinking"(端坐思考), "relax"(舒服地笑眯眯舔毛洗澡), "sleepy"(半躺半睡犯困), "sleep"(完全闭眼躺平睡觉) 中选择）。

请必须且只能返回符合以下 JSON 格式的单行文本，千万不要包含任何 \`\`\`json 等 markdown 标记或换行，直接输出一个纯 JSON 字符串：
{ "reply": "你的猫咪口吻回复内容", "expression": "对应的情绪代码" }`;

      const formattedMessages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-6).map((m: any) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content
        }))
      ];

      const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: formattedMessages,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`DashScope API returned HTTP ${response.status}`);
      }

      const resData: any = await response.json();
      const rawText = resData.choices?.[0]?.message?.content || "{}";

      let parsed = { reply: "喵呜，云端传输的数据出现了一些格式解析错误喵……", expression: "sleepy" };
      try {
        parsed = JSON.parse(rawText.trim());
      } catch (err) {
        console.warn("Failed to parse JSON reply from LLM, text:", rawText);
        parsed = { reply: rawText, expression: "idle" };
      }

      res.json(parsed);
    } catch (e: any) {
      console.error("Catbot server fallback error:", sanitizeSensitiveData(e.stack || e.message || String(e)));

      const errMsgLower = (e.message || "").toLowerCase();
      if (
        errMsgLower.includes("429") ||
        errMsgLower.includes("quota") ||
        errMsgLower.includes("limit") ||
        errMsgLower.includes("insufficient") ||
        errMsgLower.includes("exceeded") ||
        errMsgLower.includes("balance") ||
        errMsgLower.includes("funds") ||
        errMsgLower.includes("次数用尽") ||
        errMsgLower.includes("额度已满") ||
        errMsgLower.includes("不够") ||
        errMsgLower.includes("欠费") ||
        errMsgLower.includes("充值")
      ) {
        let reply = "呜呜，今天找本喵聊天的次数已经用光光了，本喵累了要去睡觉了喵……明天再来找我玩吧喵💤";
        const text = (content || "").toLowerCase();
        const bugKeywords = /闪退|崩溃|报错|打不开|显示不了|无法导入|卡死|黑屏|同步失败|数据丢失|白屏|错误|异常|bug/i;
        const techKeywords = /怎么|如何|哪里|配置|设置|怎么用|怎么导入|怎么备份|格式|指南|使用方法|教程|导入/i;
        if (bugKeywords.test(text)) {
          reply = "喵呜……今天帮本喵记 Bug 的次数已经用光了，本喵的小本本都已经写满啦！明天再来告诉本喵关于 Bug 的事情吧喵~ 🐾";
        } else if (techKeywords.test(text)) {
          reply = "唔……今天解答的技术问题太多啦，本喵的脑瓜转不动了，明天再来问本喵关于设置 and 配置的事喵~ 💤";
        }
        return res.json({
          reply,
          expression: "sleep"
        });
      }

      res.status(500).json({
        reply: `喵呜……本喵的本地脑回路好像烧坏了，报错信息：${sanitizeSensitiveData(e.message)}喵。`,
        expression: "sleepy"
      });
    }
  });

  // API 6: Check Update & generate 60s expired Aliyun OSS download URL
  // 注意：客户端不再参与签名计算（移动端密钥可被逆向提取，签名验证形同虚设）。
  // 防刷与防重放由本端点基于 IP 限流 + 时间戳校验统一负责。
  app.post("/api/check-update", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    try {
      const { clientVersion, userCredential, timestamp } = req.body || {};
      console.log(`[Check Update] Request clientVersion: ${clientVersion}, credential: ${userCredential}`);

      // 1. 必填参数校验（不再要求 encryptedAlgorithm 签名字段）
      if (!clientVersion || !userCredential || !timestamp) {
        return res.status(400).json({ success: false, error: "Missing required update parameters" });
      }

      // 2. 基于 IP 的速率限制（防刷兜底，每分钟 10 次）
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        || req.socket.remoteAddress
        || "unknown";
      const rateLimitResult = checkUpdateRateLimit(clientIp);
      if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil(rateLimitResult.retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        console.warn(`[Check Update] Rate limit exceeded for IP: ${clientIp}`);
        return res.status(429).json({
          success: false,
          error: `Too many update check requests. Please retry after ${retryAfterSec}s.`,
        });
      }

      // 3. 时间戳防重放校验（5 分钟有效期）
      const timeDiff = Math.abs(Date.now() - Number(timestamp));
      if (timeDiff > 5 * 60 * 1000) {
        return res.status(403).json({ success: false, error: "Forbidden: Request timestamp has expired" });
      }

      // 4. 软件版本校验：按数字逐段比较，避免字符串比较导致 '1.10.0' < '1.6.1' 的误判
      const latestVersion = "1.6.1";
      const hasUpdate = compareVersions(clientVersion, latestVersion) < 0;

      if (!hasUpdate) {
        return res.json({ success: false, message: "当前已是最新版本" });
      }

      // 5. 模拟阿里云 FC 返回的响应结构 (由 FC 计算好 120s 签名的 downloadUrl)
      const downloadUrl = `http://${req.headers.host || "127.0.0.1:3000"}/updates/app-release-v1.6.1.apk`;

      res.json({
        success: true,
        data: {
          latestVersion: latestVersion,
          fileName: "apk/app-release-v1.6.1.apk",
          fileSize: 15458920,
          fileSizeMB: "14.74",
          downloadUrl: downloadUrl,
          expiresInSeconds: 120,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120 * 1000).toISOString(),
          enablePush: true
        },
        message: "下载链接生成成功，请尽快使用"
      });

    } catch (err: any) {
      console.error("[Check Update Error]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Vite development middleware vs Static Production files serving
  if (process.env.NODE_ENV !== "production") {
    console.log("[Local Server] Creating Vite server...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    console.log("[Local Server] Vite server created.");
    app.use(vite.middlewares);
  } else {
    console.log("[Local Server] Production mode: serving static files from dist/");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const HOST = process.env.TAURI_DEV_HOST || "0.0.0.0";
  console.log(`[Local Server] Attempting to listen on ${HOST}:${PORT}...`);
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

startServer();
