import { IKernel, ISettingsService } from "../types";
import { UserSettings } from "../../types";
import {
  getStoredSettings as dbGetStoredSettings,
  saveStoredSettings as dbSaveStoredSettings,
} from "../../utils/localDB";

/**
 * SettingsService - 用户设置业务服务插件
 *
 * 核心职责：
 *   1. 封装用户全局设置 (user_settings) 的读写（settings Store 中的核心键）
 *   2. 作为 settings 业务域的统一服务入口，将业务逻辑从 UI/Context 层下沉到独立服务插件
 *
 * 设计遵循 AGENTS.md 准则一/八/十：
 *   - 高内聚：所有 user_settings 语义的 IDB 操作收敛于此，便于未来抽离为独立微服务插件
 *   - 物理隔离：不侵入 Kernel.ts 底座，不污染通用的 DatabaseService（settings 是业务实体）
 *   - 资源回收：持有服务级 AbortController，destroy 时中止进行中的异步任务
 *
 * 注意：saved_presets_bundle / global_lorebook / custom_worldbooks 虽然也存储在
 * settings Store 中，但它们属于独立的业务域（预设包 / 世界书），
 * 分别由 PresetService 与 WorldbookService 独立封装，遵循准则一「物理层数据严格解耦与隔离」。
 */
export class SettingsService implements ISettingsService<UserSettings> {
  name = "settings";
  isCritical = false;
  // 依赖 DatabaseService 先完成 IDB schema 就绪（getDB 触发 onupgradeneeded）
  readonly dependencies = ["database"] as const;
  private kernel!: IKernel;
  // 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async getStoredSettings(): Promise<UserSettings | null> {
    return dbGetStoredSettings();
  }

  async saveStoredSettings(settings: UserSettings): Promise<void> {
    return dbSaveStoredSettings(settings);
  }
}
