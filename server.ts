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
      res.json({ pkgVersion: pkg.version || "1.4.0" });
    } catch (e) {
      res.json({ pkgVersion: "1.4.0" });
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

  const HOST = process.env.TAURI_DEV_HOST || "127.0.0.1";
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

startServer();
