import type { IKernel, IKernelService } from "@/src/application/serviceContracts";
import {
  MEMORY_PERSISTENCE_SERVICE,
  type MemoryDictEntry,
  type MemoryFragment,
  type MemoryFragmentStatus,
  type MemoryPersistencePort,
  type MessageRecord,
  type TemporalFact,
  type TemporalFactStatus,
} from "../../application/services/memory/types";
import {
  appendMessage,
  deleteDictBySession,
  deleteDictEntryById,
  deleteMessagesBySession,
  getDictBySession,
  getDictEntryById,
  getMessageById,
  getMessagesBySession,
  getMessagesByTag,
  updateMessageExtraction,
  upsertDictEntry,
  upsertFragment,
  getFragmentById,
  getFragmentsBySession,
  getFragmentsByTags,
  supersedeFragment,
  updateFragmentStatus,
  deleteFragmentsBySession,
  evolveTemporalFact,
  getTemporalFactsBySession,
  getTemporalFactsByEntities,
  updateTemporalFactStatus,
  deleteTemporalFactsBySession,
} from "./indexedDbMemoryStore";
import { getDB } from "./idbConnection";

/**
 * IndexedDB 对记忆领域持久化端口的实现。
 * 这里只做类型转换、生命周期信号传导与物理存储委托，不承载召回、摘要等业务规则。
 */
export class IndexedDbMemoryPersistenceService
  implements IKernelService, MemoryPersistencePort
{
  readonly name = MEMORY_PERSISTENCE_SERVICE;
  readonly isCritical = true;
  private abortController: AbortController | null = null;

  async init(_kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort(), { once: true });
    }
    await getDB();
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  appendMessage(message: MessageRecord, signal?: AbortSignal): Promise<void> {
    return appendMessage(message, this.resolveSignal(signal));
  }

  updateMessageExtraction(
    id: string,
    tags: string[],
    extractSource: string,
    metadata?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void> {
    return updateMessageExtraction(
      id,
      tags,
      extractSource,
      metadata,
      this.resolveSignal(signal)
    );
  }

  getMessageById(id: string): Promise<MessageRecord | null> {
    return getMessageById(id);
  }

  getMessagesBySession(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
      descending?: boolean;
      minTurnIndexExclusive?: number;
      maxTurnIndexExclusive?: number;
    }
  ): Promise<MessageRecord[]> {
    return getMessagesBySession(sessionId, options);
  }

  getMessagesByTag(
    sessionId: string,
    tags: string[],
    limit?: number
  ): Promise<MessageRecord[]> {
    return getMessagesByTag(sessionId, tags, limit);
  }

  deleteMessagesBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return deleteMessagesBySession(sessionId, this.resolveSignal(signal));
  }

  upsertDictEntry(
    entry: Parameters<MemoryPersistencePort["upsertDictEntry"]>[0],
    signal?: AbortSignal
  ): Promise<boolean> {
    return upsertDictEntry(entry, this.resolveSignal(signal));
  }

  getDictEntryById(id: string): Promise<MemoryDictEntry | null> {
    return getDictEntryById(id);
  }

  getDictBySession(sessionId: string): Promise<MemoryDictEntry[]> {
    return getDictBySession(sessionId);
  }

  deleteDictBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return deleteDictBySession(sessionId, this.resolveSignal(signal));
  }

  deleteDictEntryById(id: string, signal?: AbortSignal): Promise<void> {
    return deleteDictEntryById(id, this.resolveSignal(signal));
  }

  upsertFragment(
    fragment: MemoryFragment,
    signal?: AbortSignal,
    options?: { requireSourceMessages?: boolean },
  ): Promise<void> {
    return upsertFragment(fragment, this.resolveSignal(signal), options);
  }

  getFragmentById(id: string): Promise<MemoryFragment | null> {
    return getFragmentById(id);
  }

  getFragmentsBySession(sessionId: string): Promise<MemoryFragment[]> {
    return getFragmentsBySession(sessionId);
  }

  getFragmentsByTags(
    sessionId: string,
    tags: string[],
    limit?: number
  ): Promise<MemoryFragment[]> {
    return getFragmentsByTags(sessionId, tags, limit);
  }

  supersedeFragment(
    originalId: string,
    replacement: MemoryFragment,
    signal?: AbortSignal
  ): Promise<void> {
    return supersedeFragment(originalId, replacement, this.resolveSignal(signal));
  }

  updateFragmentStatus(
    id: string,
    status: MemoryFragmentStatus,
    signal?: AbortSignal
  ): Promise<void> {
    return updateFragmentStatus(id, status, this.resolveSignal(signal));
  }

  deleteFragmentsBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return deleteFragmentsBySession(sessionId, this.resolveSignal(signal));
  }

  evolveTemporalFact(
    fact: TemporalFact,
    signal?: AbortSignal,
    options?: { requireSourceMessage?: boolean },
  ): Promise<{ changed: boolean; fact: TemporalFact }> {
    return evolveTemporalFact(fact, this.resolveSignal(signal), options);
  }

  getTemporalFactsBySession(
    sessionId: string,
    options?: { activeOnly?: boolean }
  ): Promise<TemporalFact[]> {
    return getTemporalFactsBySession(sessionId, options);
  }

  getTemporalFactsByEntities(
    sessionId: string,
    entities: string[],
    limit?: number
  ): Promise<TemporalFact[]> {
    return getTemporalFactsByEntities(sessionId, entities, limit);
  }

  updateTemporalFactStatus(
    id: string,
    status: TemporalFactStatus,
    signal?: AbortSignal
  ): Promise<void> {
    return updateTemporalFactStatus(id, status, this.resolveSignal(signal));
  }

  deleteTemporalFactsBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return deleteTemporalFactsBySession(sessionId, this.resolveSignal(signal));
  }

  private resolveSignal(external?: AbortSignal): AbortSignal | undefined {
    return external ?? this.abortController?.signal;
  }
}
