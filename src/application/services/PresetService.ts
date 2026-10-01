import { IPresetService, IKernel } from "../serviceContracts";
import type { PresetBundleV2 } from "../../domain/presets/contracts";
import {
  getStoredSavedPresets as dbGetStoredSavedPresets,
  saveStoredSavedPresets as dbSaveStoredSavedPresets,
} from "../../infrastructure/storage/repositories/settingsRepository";

/**
 * PresetService - 预设实体业务服务。
 *
 * 核心职责：
 *   1. 封装预设实体列表（`saved_presets_bundle`）的读写
 *   2. 作为 preset 业务域的统一服务入口，把业务逻辑从 UI/Context 层下沉到应用服务
 *
 * 设计遵循 AGENTS.md 的 `ARCH-KERNEL` 与 `ARCH-FLOW`：
 *   - 高内聚：所有 saved_presets 语义的 IDB 操作收敛于此，便于未来抽离为独立应用服务
 *   - 物理隔离：不侵入 Kernel，不污染通用的 DatabaseService（preset 是业务实体）
 *   - 资源回收：持有服务级 AbortController，destroy 时中止进行中的异步任务
 *
 * 实体版本：对外只有 `PresetBundleV2`。v1 记录在**存储读取边界**经
 * `domain/presets/bundleMigration` 迁移（能读就不能失效），因此本服务不再做 v1 归一化，
 * 写入也永远只有 v2 形态。
 *
 * 注意：saved_presets_bundle 物理上存储在 settings Store 中（键名独立），
 * 但逻辑上属于独立的 preset 业务域，故独立封装为 PresetService，
 * 遵循 `ARCH-FLOW` 的「分轨存储」精神。
 */
export class PresetService implements IPresetService<PresetBundleV2> {
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

  async getStoredSavedPresets(): Promise<PresetBundleV2[] | null> {
    return dbGetStoredSavedPresets();
  }

  async saveStoredSavedPresets(presets: PresetBundleV2[]): Promise<void> {
    return dbSaveStoredSavedPresets(presets);
  }
}
