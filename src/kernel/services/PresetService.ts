import { IKernelService, IKernel } from "../types";
import {
  getStoredSavedPresets as dbGetStoredSavedPresets,
  saveStoredSavedPresets as dbSaveStoredSavedPresets,
} from "../../utils/localDB";

/**
 * PresetService - 采样器预设包业务服务插件
 *
 * 核心职责：
 *   1. 封装用户自定义预设包 (saved_presets_bundle) 的读写
 *   2. 作为 preset 业务域的统一服务入口，将业务逻辑从 UI/Context 层下沉到独立服务插件
 *
 * 设计遵循 AGENTS.md 准则一/八/十：
 *   - 高内聚：所有 saved_presets 语义的 IDB 操作收敛于此，便于未来抽离为独立微服务插件
 *   - 物理隔离：不侵入 Kernel.ts 底座，不污染通用的 DatabaseService（preset 是业务实体）
 *   - 资源回收：持有服务级 AbortController，destroy 时中止进行中的异步任务
 *
 * 注意：saved_presets_bundle 物理上存储在 settings Store 中（键名独立），
 * 但逻辑上属于独立的 preset 业务域，故独立封装为 PresetService，
 * 遵循准则一「物理层数据严格解耦与隔离」的「分轨存储」精神。
 */
export class PresetService implements IKernelService {
  name = "preset";
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

  async getStoredSavedPresets(): Promise<any[] | null> {
    return dbGetStoredSavedPresets();
  }

  async saveStoredSavedPresets(presets: any[]): Promise<void> {
    return dbSaveStoredSavedPresets(presets);
  }
}
