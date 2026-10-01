import express from "express";
import type { Server } from "node:http";
import type { HeadlessHostInstance } from "./bootstrap";
import { handleListModels, handleChatCompletions } from "./gateway/openAiAdapter";
import { createHostProtocolRouter } from "./gateway/hostProtocolRouter";
import { Logger } from "../src/utils/logger";

const logger = Logger.create("HeadlessServer");

export interface HeadlessServerHandle {
  readonly app: express.Express;
  readonly server: Server;
  close(): Promise<void>;
}

export function createHeadlessServer(instance: HeadlessHostInstance): express.Express {
  const app = express();
  const { config, kernel } = instance;

  // 1. 全局 CORS 中间件：仅在 HEADLESS_CORS_ORIGINS 明确列出该 Origin 时才回显。
  // 不再使用 "*"：跨源响应一旦被别人读到，配合无鉴权即等于数据泄露。
  // 非浏览器客户端（APK / curl / SDK）不受 CORS 影响，无需白名单。
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Session-Id, X-Requested-With",
      );
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // 2. 请求体解析（提高上限以允许大角色卡与备份导入）
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 3. 访问鉴权中间件（若配置了 HEADLESS_API_KEY 则强制校验 Bearer 凭据）
  if (config.apiKey) {
    app.use((req, res, next) => {
      // 探活健康检查端点豁免鉴权
      if (req.path === "/health") {
        next();
        return;
      }
      const rawHeader = req.headers["authorization"] || req.headers["Authorization"];
      const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;

      if (!token || token !== config.apiKey) {
        res.status(401).json({
          error: {
            message: "Unauthorized: Invalid or missing API Key in Authorization header",
            type: "authentication_error",
            code: 401,
          },
        });
        return;
      }
      next();
    });
  }

  // 4. 健康检查端点
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      mode: "headless",
      timestamp: Date.now(),
    });
  });

  // 5. OpenAI 兼容协议路由
  app.get("/v1/models", (req, res) => {
    void handleListModels(kernel, req, res);
  });
  app.post("/v1/chat/completions", (req, res) => {
    void handleChatCompletions(kernel, req, res);
  });

  // 6. Mobile Tavern 原生 Host 协议路由
  app.use("/api/host", createHostProtocolRouter(kernel, config));

  return app;
}

export async function startHeadlessServer(
  instance: HeadlessHostInstance,
): Promise<HeadlessServerHandle> {
  const app = createHeadlessServer(instance);
  const { port, host } = instance.config;

  if (!instance.config.apiKey) {
    logger.warn(
      "未配置 HEADLESS_API_KEY：本实例没有任何鉴权，仅因监听回环地址而未被外部访问。请勿把 HEADLESS_HOST 改为对外地址。",
    );
  }
  if (instance.config.corsOrigins.length === 0) {
    logger.info("未配置 HEADLESS_CORS_ORIGINS：不回显任何 CORS 头（APK / curl / SDK 不受影响）。");
  }

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, host, () => {
        logger.info(`Headless API Server listening at: http://${host}:${port}`);
        logger.info(`  OpenAI Endpoints: http://${host}:${port}/v1/chat/completions`);
        logger.info(`  Host Protocol:    http://${host}:${port}/api/host/status`);
        resolve({
          app,
          server,
          close: async () => {
            await new Promise<void>((resClose) => {
              server.close(() => resClose());
            });
            await instance.dispose();
          },
        });
      });

      server.on("error", (err) => {
        logger.error("Failed to bind headless server port", err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}
