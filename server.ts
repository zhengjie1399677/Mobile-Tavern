import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import ALY from "aliyun-sdk";

dotenv.config();
if (!process.env.ALIYUN_ACCESS_KEY_ID) {
  dotenv.config({ path: ".env.example" });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedSTS: {
  AccessKeyId: string;
  AccessKeySecret: string;
  SecurityToken: string;
  expiresAt: number;
} | null = null;

async function getSTSCredentials(): Promise<{
  AccessKeyId: string;
  AccessKeySecret: string;
  SecurityToken?: string;
} | null> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const stsEndpoint = process.env.ALIYUN_STS_ENDPOINT || "sts.aliyuncs.com";
  const roleArn = process.env.ALIYUN_ROLE_ARN;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  // If roleArn is not provided, use sub-user credentials directly
  if (!roleArn) {
    return {
      AccessKeyId: accessKeyId,
      AccessKeySecret: secretAccessKey,
    };
  }

  // Check if we have a valid cached token
  const now = Date.now();
  if (cachedSTS && cachedSTS.expiresAt > now + 300 * 1000) { // Valid for at least 5 minutes
    return cachedSTS;
  }

  // Fetch a new STS Token using ALY.STS
  return new Promise((resolve) => {
    const sts = new ALY.STS({
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      endpoint: `https://${stsEndpoint.replace(/^https?:\/\//, "")}`,
      apiVersion: "2015-04-01"
    });

    sts.assumeRole({
      RoleArn: roleArn,
      RoleSessionName: "serverProxySession",
      DurationSeconds: 3600
    }, function(err, data) {
      if (err) {
        console.error("[STS AssumeRole Error in Telemetry Proxy]:", err.message);
        // Fallback to sub-user credentials
        resolve({
          AccessKeyId: accessKeyId,
          AccessKeySecret: secretAccessKey,
        });
        return;
      }

      cachedSTS = {
        AccessKeyId: data.Credentials.AccessKeyId,
        AccessKeySecret: data.Credentials.AccessKeySecret,
        SecurityToken: data.Credentials.SecurityToken,
        expiresAt: Date.now() + 3600 * 1000 // Valid for 1 hour
      };
      
      resolve(cachedSTS);
    });
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // We are behind a reverse proxy, trust the first proxy to enable express-rate-limit 
  app.set('trust proxy', 1);

  // Use JSON parser with higher limits for backups and character cards
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API 2: Test connection for API config
  app.post("/api/test-connection", async (req, res) => {
    try {
      const { type, baseUrl, apiKey, modelName } = req.body;

      // Proxy OpenAI-compatible API
      const targetUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      const fetchHeaders: any = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: fetchHeaders,
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
  app.post("/api/proxy/openai", async (req, res) => {
    try {
      const { baseUrl, apiKey, reqBody } = req.body;
      if (!baseUrl) {
        return res.status(400).json({ success: false, error: "baseUrl is required" });
      }

      const targetUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      const fetchHeaders: any = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      
      const isStream = reqBody.stream === true;
      
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: fetchHeaders,
        body: JSON.stringify(reqBody),
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
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
        return;
      }


      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("OpenAI Proxy Chat Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to make proxied request.",
      });
    }
  });

  // API 4: Models Fetch Proxy
  app.post("/api/proxy/models", async (req, res) => {
    try {
      const { type, baseUrl, apiKey } = req.body;



      if (!baseUrl) {
        return res.status(400).json({ success: false, error: "baseUrl is required for standard proxy" });
      }

      const targetUrl = `${baseUrl.replace(/\/$/, "")}/models`;
      const fetchHeaders: any = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: fetchHeaders,
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

  // API 5: Get Aliyun STS Token
  app.get("/api/sts/token", async (req, res) => {
    try {
      const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
      const secretAccessKey = process.env.ALIYUN_ACCESS_KEY_SECRET;
      const stsEndpoint = process.env.ALIYUN_STS_ENDPOINT || "sts.aliyuncs.com";
      const roleArn = process.env.ALIYUN_ROLE_ARN;

      if (!accessKeyId || !secretAccessKey || !roleArn) {
        return res.status(400).json({ success: false, error: "Missing STS configuration on server (ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_ROLE_ARN)" });
      }

      const sts = new ALY.STS({
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
        endpoint: `https://${stsEndpoint.replace(/^https?:\/\//, '')}`,
        apiVersion: "2015-04-01"
      });

      sts.assumeRole({
        RoleArn: roleArn,
        RoleSessionName: 'webClientSession',
        DurationSeconds: 3600
      }, function(err, data) {
        if (err) {
          console.error("STS Error:", err.message, err.code);
          return res.status(500).json({ success: false, error: err.message || "Failed to generate STS token" });
        }
        res.json({ success: true, credentials: data.Credentials });
      });
    } catch (error: any) {
      console.error("STS Route Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Rate limit for SLS
  const slsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100, // 100 req per minute per IP
    message: { success: false, error: "Too many requests to telemetry proxy" }
  });

  // API 5: SLS Telemetry Proxy (Bypass CORS and avoid GET)
  app.post("/api/proxy/sls", slsLimiter, async (req, res) => {
    try {
      const payload = req.body.payload;
      
      // 读取服务端的环境变量，绝不允许客户端直接指定路由节点 (修复安全漏洞 SSRF / 凭据泄露)
      const project = process.env.VITE_ALIYUN_SLS_PROJECT || process.env.ALIYUN_SLS_PROJECT;
      const endpoint = process.env.VITE_ALIYUN_SLS_ENDPOINT || process.env.ALIYUN_SLS_ENDPOINT;
      const logstore = process.env.VITE_ALIYUN_SLS_LOGSTORE || process.env.ALIYUN_SLS_LOGSTORE;

      const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
      const secretAccessKey = process.env.ALIYUN_ACCESS_KEY_SECRET;
      const securityToken = process.env.ALIYUN_STS_TOKEN;

      if (!project || !endpoint || !logstore || !payload) {
        return res.status(400).json({ success: false, error: "Missing SLS config on server or payload" });
      }

      const host = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
      
      // Check for available key credentials via getSTSCredentials helper
      const credentials = await getSTSCredentials();
      
      if (credentials) {
        const sls = new ALY.SLS({
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.AccessKeySecret,
          securityToken: credentials.SecurityToken || "",
          endpoint: `https://${host}`,
          apiVersion: "2015-06-01"
        });

        // 转换 web_client 传过来的 __logs__ 格式为 SDK 需要的 logs 格式
        const logs = Array.isArray(payload.__logs__) ? payload.__logs__.map(logObj => {
          const contents = [];
          for (const key in logObj) {
            if (Object.prototype.hasOwnProperty.call(logObj, key)) {
              contents.push({ key: String(key), value: String(logObj[key]) });
            }
          }
          return {
            time: Math.floor(Date.now() / 1000), // SDK demands UTC seconds timestamp
            contents: contents
          };
        }) : [];

        sls.putLogs({
          projectName: project,
          logStoreName: logstore,
          logGroup: {
            logs: logs,
            source: payload.__source__ || "web-client",
            topic: payload.__tags__?.platform || "" // Optionally push tags into topic or serialize to contents
          }
        }, function(err, data) {
          if (err) {
            console.error("SLS SDK Error:", err.message, err.code);
            return res.status(500).json({ success: false, error: err.message });
          }
          return res.json({ success: true });
        });
      } else {
        // Fallback to WebTracking (No authentication, needs WebTracking enabled on logstore)
        const slsUrl = `https://${project}.${host}/logstores/${logstore}/track`;
        const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
  
        const response = await fetch(slsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-log-apiversion": "0.6.0",
            "x-log-bodyrawsize": String(Buffer.byteLength(payloadString, 'utf8'))
          },
          body: payloadString
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 401 && errorText.includes("web tracking api")) {
             console.warn(`[Telemetry] SLS WebTracking is disabled for ${logstore}. Please set ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET in the environment/secrets to use the SDK, or enable Web Tracking on the logstore.`);
             return res.status(401).json({ success: false, error: "SLS WebTracking disabled and missing Server Credentials" });
          }
          console.error("SLS error details:", errorText);
          return res.status(response.status).json({ success: false, error: errorText });
        }
  
        res.json({ success: true });
      }
    } catch (error: any) {
      console.error("SLS Proxy Error:", error);
      res.status(500).json({ success: false, error: error.message });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
