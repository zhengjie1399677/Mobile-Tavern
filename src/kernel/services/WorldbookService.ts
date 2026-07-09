import { IKernelService, IKernel } from "../types";
import { LorebookEntry, CustomWorldbook } from "../../types";
import {
  getGlobalLorebook as dbGetGlobalLorebook,
  saveGlobalLorebook as dbSaveGlobalLorebook,
  getCustomWorldbooks as dbGetCustomWorldbooks,
  saveCustomWorldbooks as dbSaveCustomWorldbooks,
} from "../../utils/localDB";

/**
 * WorldbookService - 世界书业务服务插件
 *
 * 核心职责：
 *   1. 封装全局世界书（global_lorebook）读写（lorebooks Store）
 *   2. 封装自定义世界书集（custom_worldbooks）读写（worldbooks Store）
 *   3. 作为 worldbook 业务域的统一服务入口，将业务逻辑从 UI/Context 层下沉到独立服务插件
 *
 * 设计遵循 AGENTS.md 准则一/八/十：
 *   - 高内聚：所有 worldbook 语义的 IDB 操作收敛于此
 *   - 物理隔离：不侵入 Kernel.ts 底座，不污染通用的 DatabaseService
 *   - 资源回收：持有服务级 AbortController，destroy 时中止进行中的异步任务
 */
export class WorldbookService implements IKernelService {
  name = "worldbook";
  isCritical = false;
  // 依赖 DatabaseService 先完成 IDB schema 就绪
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

  async getGlobalLorebook(): Promise<LorebookEntry[]> {
    return dbGetGlobalLorebook();
  }

  async saveGlobalLorebook(entries: LorebookEntry[]): Promise<void> {
    return dbSaveGlobalLorebook(entries);
  }

  async getCustomWorldbooks(): Promise<Record<string, CustomWorldbook>> {
    return dbGetCustomWorldbooks();
  }

  async saveCustomWorldbooks(
    worldbooks: Record<string, CustomWorldbook>
  ): Promise<void> {
    return dbSaveCustomWorldbooks(worldbooks);
  }
}
