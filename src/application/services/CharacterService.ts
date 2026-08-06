import { ICharacterService, IKernel } from "../serviceContracts";
import { CharacterCard } from "../../types";
import {
  getAllCharacters,
  getCharacterCatalog,
  getCharacterById,
  saveCharacter as dbSaveCharacter,
  deleteCharacter as dbDeleteCharacter,
  bulkSaveCharacters as dbBulkSaveCharacters,
} from "../../infrastructure/storage/repositories/charactersRepository";
import {
  getStoredDefaultCharactersInitializedFlag,
  saveStoredDefaultCharactersInitializedFlag,
} from "../../infrastructure/storage/repositories/settingsRepository";

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
export class CharacterService implements ICharacterService<CharacterCard> {
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

  async getCharacterCatalog(): Promise<CharacterCard[]> {
    return getCharacterCatalog();
  }

  async getCharacterById(id: string): Promise<CharacterCard | null> {
    return getCharacterById(id);
  }

  async saveCharacter(character: CharacterCard): Promise<void> {
    let toSave = character;
    // 空壳保存守卫（修复：世界书 Tab 基于 catalog 轻量对象回写会覆盖完整角色卡）：
    // catalog 空壳对象（getCharacterCatalog 产物，extensions.__catalogOnly === true）缺少
    // personality/scenario/first_mes/mes_example/system_prompt 与真实 extensions，若直接
    // store.put 会以空字段覆盖 characters store 中的完整记录。落盘前先按主键重灌完整记录，
    // 仅让空壳上可能真实改动的展示字段（name/description/avatar/creator/tags）与
    // 业务字段（lorebookEntries/isWorldbookGlobal）覆盖回合并对象，其余字段以完整记录为准。
    if (character.extensions?.__catalogOnly) {
      const full = await getCharacterById(character.id);
      if (full) {
        toSave = {
          ...character,
          ...full,
          id: character.id,
          name: character.name ?? full.name,
          description: character.description ?? full.description,
          avatar: character.avatar ?? full.avatar,
          creator: character.creator ?? full.creator,
          tags: character.tags ?? full.tags,
          lorebookEntries:
            character.lorebookEntries ?? full.lorebookEntries ?? [],
          isWorldbookGlobal:
            character.isWorldbookGlobal ?? full.isWorldbookGlobal ?? false,
        };
      }
    }
    return dbSaveCharacter(toSave);
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
