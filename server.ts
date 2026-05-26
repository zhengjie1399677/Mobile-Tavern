import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini client lazily to avoid startup crashes if key is missing during container boot
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please configure it in Settings > Secrets.");
    }
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return geminiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON parser with higher limits for backups and character cards
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API 1: Out-of-the-box Gemini Chat proxy
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { systemInstruction, contents, config, modelName, apiKey } = req.body;
      const client = apiKey ? new GoogleGenAI({ apiKey }) : getGeminiClient();

      console.log("[Gemini Chat Proxy] Raw contents received:", JSON.stringify(contents, null, 2));

      // Normalize contents payload to strict @google/genai SDK structure
      let formattedContents: any = contents;
      if (Array.isArray(contents)) {
        formattedContents = contents.map((item: any) => {
          if (typeof item === "string") {
            return { role: "user", parts: [{ text: item }] };
          }
          if (item && typeof item === "object") {
            const rawText = item.text || item.content || "";
            const parts = item.parts || [{ text: String(rawText) }];
            const cleanedParts = parts.map((p: any) => {
              if (typeof p === "string") return { text: p };
              if (p && typeof p === "object") {
                if (p.text !== undefined) return { text: String(p.text) };
                if (p.inlineData) return p;
              }
              return { text: "" };
            }).filter((p: any) => p.text !== "" || p.inlineData);

            let role = item.role || "user";
            if (role === "assistant" || role === "model") {
              role = "model";
            } else {
              role = "user";
            }
            return { role, parts: cleanedParts };
          }
          return { role: "user", parts: [{ text: "" }] };
        });
      } else if (typeof contents === "string") {
        formattedContents = [{ role: "user", parts: [{ text: contents }] }];
      } else if (contents && typeof contents === "object") {
        const rawText = contents.text || contents.content || "";
        const parts = contents.parts || [{ text: String(rawText) }];
        let role = contents.role || "user";
        if (role === "assistant" || role === "model") {
          role = "model";
        } else {
          role = "user";
        }
        formattedContents = [{ role, parts }];
      }
      
      console.log("[Gemini Chat Proxy] Formatted contents for SDK:", JSON.stringify(formattedContents, null, 2));

      
      const isStream = req.body.stream === true;
      
      if (isStream) {
        const responseStream = await client.models.generateContentStream({
          model: modelName || "gemini-3.5-flash",
          contents: formattedContents,
          config: {
            systemInstruction: systemInstruction || undefined,
            temperature: config?.temperature !== undefined ? Number(config.temperature) : undefined,
            topP: config?.topP !== undefined ? Number(config.topP) : undefined,
            topK: config?.topK !== undefined ? Number(config.topK) : undefined,
            maxOutputTokens: config?.maxOutputTokens !== undefined ? Number(config.maxOutputTokens) : undefined,
          },
        });
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        for await (const chunk of responseStream) {
          const payload = {
            text: chunk.text || "",
            usage: chunk.usageMetadata ? { promptTokens: chunk.usageMetadata.promptTokenCount, completionTokens: chunk.usageMetadata.candidatesTokenCount } : null
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const response = await client.models.generateContent({
        model: modelName || "gemini-3.5-flash",
        contents: formattedContents,
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature: config?.temperature !== undefined ? Number(config.temperature) : undefined,
          topP: config?.topP !== undefined ? Number(config.topP) : undefined,
          topK: config?.topK !== undefined ? Number(config.topK) : undefined,
          maxOutputTokens: config?.maxOutputTokens !== undefined ? Number(config.maxOutputTokens) : undefined,
        },
      });

      res.json({
        success: true,
        text: response.text || "",
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0
        }
      });
    } catch (error: any) {
      console.error("Gemini chat error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "An error occurred during Gemini API call.",
      });
    }
  });

  // API 2: Test connection for API config
  app.post("/api/test-connection", async (req, res) => {
    try {
      const { type, baseUrl, apiKey, modelName } = req.body;

      if (type === "gemini-builtin") {
        try {
          const client = apiKey ? new GoogleGenAI({ apiKey }) : getGeminiClient();
          const response = await client.models.generateContent({
            model: "gemini-3.5-flash",
            contents: "Hi",
          });
          return res.json({ success: true, message: "Built-in Gemini connected successfully!" });
        } catch (e: any) {
          return res.json({ success: false, error: e.message || "Built-in Gemini key configuration error" });
        }
      }

      // Otherwise proxy OpenAI-compatible API
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

      if (type === "gemini-builtin") {
        if (!apiKey) {
          return res.status(400).json({ success: false, error: "Custom API Key is required to fetch models." });
        }
        // Fetch from standard REST endpoint
        const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(targetUrl, { method: "GET" });
        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).json({ success: false, error: errText });
        }
        const data = await response.json();
        const models = (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => ({ id: m.name.replace("models/", "") }));
        return res.json({ success: true, models });
      }

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
      const models = data.data || [];
      res.json({ success: true, models: models.map((m: any) => ({ id: m.id })) });
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
