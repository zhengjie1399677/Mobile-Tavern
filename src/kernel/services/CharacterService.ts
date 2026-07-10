import { IKernelService, IKernel } from "../types";
import { CharacterCard } from "../../types";
import {
  getAllCharacters,
  saveCharacter as dbSaveCharacter,
  deleteCharacter as dbDeleteCharacter,
  bulkSaveCharacters as dbBulkSaveCharacters,
  getStoredDefaultCharactersInitializedFlag,
  saveStoredDefaultCharactersInitializedFlag,
} from "../../utils/localDB";

/**
 * CharacterService - 角色卡业务服务插件
 *
 * 核心职责：
 *   1. 封装角色卡的 CRUD 与批量写入（characters Store）
 *   2. 封装默认角色卡初始化标志位读写（settings Store）
 *   3. 作为 character 业务域的统一服务入口，将业务逻辑从 UI/Context 层下沉到独立服务插件
 *
 * 设计遵循 AGENTS.md 准则一/八/十：
 *   - 高内聚：所有 character 语义的 IDB 操作收敛于此，便于未来抽离为独立微服务插件
 *   - 物理隔离：不侵入 Kernel.ts 底座，不污染通用的 DatabaseService（character 是业务实体）
 *   - 资源回收：持有服务级 AbortController，destroy 时中止进行中的异步任务
 */
export class CharacterService implements IKernelService {
  name = "character";
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

  async getAllCharacters(): Promise<CharacterCard[]> {
    return getAllCharacters();
  }

  async saveCharacter(character: CharacterCard): Promise<void> {
    return dbSaveCharacter(character);
  }

  async deleteCharacter(id: string): Promise<void> {
    return dbDeleteCharacter(id);
  }

  async bulkSaveCharacters(charactersList: CharacterCard[]): Promise<void> {
    return dbBulkSaveCharacters(charactersList);
  }

  async getStoredDefaultCharactersInitializedFlag(): Promise<boolean> {
    return getStoredDefaultCharactersInitializedFlag();
  }

  async saveStoredDefaultCharactersInitializedFlag(
    initialized: boolean
  ): Promise<void> {
    return saveStoredDefaultCharactersInitializedFlag(initialized);
  }
}
