import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ssrfGuard } from "./src/utils/security";

dotenv.config();

const resolvedFilename = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const resolvedDirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(resolvedFilename);

interface ProxyRequestConfig {
  baseUrl: string;
  routePath: string;
  apiKey?: string;
}

function prepareProxyRequest({ baseUrl, routePath, apiKey }: ProxyRequestConfig) {
  if (!baseUrl || (typeof baseUrl === "string" && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://"))) {
    throw new Error("Invalid baseUrl protocol. Only http:// and https:// are allowed.");
  }
  const sanitizedBaseUrl = baseUrl.replace(/\/$/, "");
  const sanitizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const targetUrl = `${sanitizedBaseUrl}${sanitizedRoute}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    const cleanKey = apiKey.trim();
    console.log(`[Proxy Request] API Key loaded, prefix: "${cleanKey.substring(0, 15)}...", length: ${cleanKey.length}, suffix: "...${cleanKey.substring(Math.max(0, cleanKey.length - 6))}"`);
  } else {
    console.log(`[Proxy Request] No API Key loaded in proxy header!`);
  }

  return { targetUrl, headers };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON parser with higher limits for backups and character cards
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API 1: Version checking
  app.get("/version", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    try {
      const pkgPath = path.join(resolvedDirname, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      res.json({ pkgVersion: pkg.version || "1.5.5" });
    } catch (e) {
      res.json({ pkgVersion: "1.5.5" });
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
      console.log(`[Proxy TestConnection] Target URL: ${targetUrl}`);

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
      console.log(`[Proxy OpenAI] Target URL: ${targetUrl}, isStream: ${isStream}`);

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
      console.error("OpenAI Proxy Chat Error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || "Failed to make proxied request.",
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
      console.error("Models Proxy Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch models.",
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
      console.warn(`[Catbot Proxy] 转发至云端 FC 失败 (${err.message})，降级为本地处理器。`);
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
      console.error("Catbot server fallback error:", e);

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
          reply = "唔……今天解答的技术问题太多啦，本喵的脑瓜转不动了，明天再来问本喵关于设置和配置的事喵~ 💤";
        }
        return res.json({
          reply,
          expression: "sleep"
        });
      }

      res.status(500).json({
        reply: `喵呜……本喵的本地脑回路好像烧坏了，报错信息：${e.message}喵。`,
        expression: "sleepy"
      });
    }
  });

  // Vite development middleware vs Static Production files serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const HOST = process.env.TAURI_DEV_HOST || "0.0.0.0";
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

startServer();
