import "fake-indexeddb/auto";
import { globalKernel } from "../src/kernel/Kernel";
import type { IKernel, ISettingsService } from "../src/application/serviceContracts";
import { KernelServices } from "../src/application/serviceContracts";
import {
  initializeApplicationRuntime,
  getActiveRuntimeProfileSnapshot,
  getRuntimeProfileStartupDiagnostics,
} from "../src/application/runtime";
import { registerDefaultPipelines } from "../src/application/bootstrap/registerDefaultPipelines";
import { Logger } from "../src/utils/logger";
import type { HeadlessConfig } from "./config";
import {
  loadPersistedSnapshot,
  savePersistedSnapshot,
} from "./storageDriver";
import type { UserSettings } from "../src/types";

const logger = Logger.create("HeadlessBootstrap");

export interface HeadlessHostInstance {
  readonly kernel: IKernel;
  readonly config: HeadlessConfig;
  readonly activeProfile: ReturnType<typeof getActiveRuntimeProfileSnapshot>;
  readonly startupDiagnostics: ReturnType<typeof getRuntimeProfileStartupDiagnostics>;
  saveSnapshot(): Promise<string>;
  dispose(): Promise<void>;
}

export async function bootstrapHeadlessHost(
  config: HeadlessConfig,
): Promise<HeadlessHostInstance> {
  logger.info("Initializing Headless Host application runtime...");

  // 1. 初始化应用运行时组合根（加载默认 profile、挂载核心应用服务）
  await initializeApplicationRuntime();
  const kernel = globalKernel;

  // 2. 装配通用输出管线中间件（tableMemory, mvuScript, bisonMode）
  registerDefaultPipelines(kernel);

  // 3. 从数据目录加载持久化快照（若存在）
  const hasLoadedSnapshot = await loadPersistedSnapshot(
    kernel,
    config.absoluteDataDir,
  );
  if (!hasLoadedSnapshot) {
    logger.info("Fresh headless host environment ready.");
  }

  // 4. 若环境变量中配置了外部 LLM 端点或凭据，同步至全局用户设置
  if (config.llmBaseUrl || config.llmApiKey || config.llmModel) {
    try {
      const settingsService = kernel.getService<ISettingsService<UserSettings>>(KernelServices.Settings);
      const currentSettings = (await settingsService.getStoredSettings()) || ({} as UserSettings);
      const updatedApi = {
        ...currentSettings.api,
        baseUrl: config.llmBaseUrl || currentSettings.api?.baseUrl || "",
        apiKey: config.llmApiKey || currentSettings.api?.apiKey || "",
        modelName: config.llmModel || currentSettings.api?.modelName || "gpt-4o",
      };
      await settingsService.saveStoredSettings({
        ...currentSettings,
        api: updatedApi,
      });
      logger.info("Applied LLM configuration overrides from headless config.");
    } catch (err) {
      logger.warn("Failed to apply LLM configuration overrides", { error: err });
    }
  }

  const activeProfile = getActiveRuntimeProfileSnapshot();
  const startupDiagnostics = getRuntimeProfileStartupDiagnostics();

  logger.info(`Headless Host initialized successfully with profile: ${activeProfile?.profileId ?? "none"}`);

  let isDisposed = false;

  return {
    kernel,
    config,
    activeProfile,
    startupDiagnostics,
    saveSnapshot: async () => {
      return savePersistedSnapshot(kernel, config.absoluteDataDir);
    },
    dispose: async () => {
      if (isDisposed) return;
      isDisposed = true;
      logger.info("Disposing Headless Host...");
      try {
        await savePersistedSnapshot(kernel, config.absoluteDataDir);
      } catch (err) {
        logger.error("Failed to save snapshot during dispose", err);
      }
      await kernel.destroy();
      logger.info("Headless Host disposed cleanly.");
    },
  };
}
