import dotenv from "dotenv";
import { loadHeadlessConfig } from "./config";
import { bootstrapHeadlessHost } from "./bootstrap";
import { startHeadlessServer } from "./server";
import { Logger } from "../src/utils/logger";

dotenv.config();
const logger = Logger.create("HeadlessMain");

async function main(): Promise<void> {
  logger.info("Starting Mobile Tavern in Headless Mode...");
  const config = loadHeadlessConfig();
  const hostInstance = await bootstrapHeadlessHost(config);
  const serverHandle = await startHeadlessServer(hostInstance);

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    try {
      await serverHandle.close();
      logger.info("Headless server stopped gracefully.");
      process.exit(0);
    } catch (err) {
      logger.error("Error during graceful shutdown", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Headless server failed to start", err);
  process.exit(1);
});
