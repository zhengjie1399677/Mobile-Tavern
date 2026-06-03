import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // We are behind a reverse proxy, trust the first proxy to enable express-rate-limit 
  app.set('trust proxy', 1);

  // Use JSON parser with higher limits for backups and character cards
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ===== Rate Limiting =====
  // 通用 API 限流：每 IP 每分钟最多 100 次请求
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "请求过于频繁，请稍后再试 (Rate Limit Exceeded)。",
    },
  });

  // 严格限流：每 IP 每分钟最多 20 次，用于 chat completions
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "对话请求过于频繁，请稍后再试 (Rate Limit Exceeded)。",
    },
  });

  // 宽松限流：每 IP 每分钟最多 300 次，用于 models/test-connection
  const apiQueryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "请求过于频繁，请稍后再试 (Rate Limit Exceeded)。",
    },
  });

  // API 2: Test connection for API config
  app.post("/api/test-connection", apiQueryLimiter, async (req, res) => {
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
  app.post("/api/proxy/openai", chatLimiter, async (req, res) => {
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
  app.post("/api/proxy/models", apiQueryLimiter, async (req, res) => {
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
