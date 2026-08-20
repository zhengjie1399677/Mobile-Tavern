/**
 * MemorySummary - 剧情摘要子模块
 *
 * 核心职责：
 *   1. 监测会话未总结消息数，达到阈值时触发 LLM 摘要
 *   2. 生成剧情时间线摘要卡片（SummaryCard）
 *   3. 将摘要持久化保存至存储后端
 */

import { KernelServices } from '../../serviceContracts';
import type {
  IKernel,
  ILLMService,
  IDatabaseService,
} from '../../serviceContracts';
import type {
  ChatSession,
  UserSettings,
  CharacterCard,
  SummaryCard,
  Message,
} from '../../../types';
import type { MemoryStorage } from './MemoryStorage';
import type { MessageRecord } from './types';
import { API_ENDPOINT } from '../../../utils/apiClient';
import { resolveApiCredentials, TrialExhaustedError, TrialKeyFetchError } from '../../../utils/resolveApiCredentials';
import { Logger } from '../../../utils/logger';

const logger = Logger.create('MemorySummary');

// ===== 常量 =====

/** 默认时间标签模板 */
const DEFAULT_TIME_TAG_TEMPLATE = '第{{index}}幕';

/** 默认未总结消息触发阈值（与 recentTurns 一致） */
const DEFAULT_RECENT_TURNS = 6;

/** 触发阈值下限（允许用户配置到最低一轮一结） */
const MIN_TRIGGER_ROUNDS = 1;

/** 摘要温度参数（保守，避免发散） */
const SUMMARY_TEMPERATURE = 0.5;

/** 摘要最大 token 数 */
const SUMMARY_MAX_TOKENS = 500;

/** 兜底地点字符串 */
const FALLBACK_LOCATION = '未知地点';

/** 地点字段最大长度（兜底截断） */
const LOCATION_MAX_LEN = 8;

// ===== 内部工具 =====

/** 生成唯一 ID（与旧服务保持一致的前缀风格） */
function generateUniqueId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 9);
}

// ===== MemorySummary 类 =====

export class MemorySummary {
  /** 持有 MemoryStorage 引用（为未来摘要持久化扩展预留） */
  private storage: MemoryStorage;
  /** 内核引用，用于获取 LLM / Database 服务 */
  private kernel: IKernel | null = null;
  /** 服务级 AbortController */
  private abortController: AbortController | null = null;
  /** 同一会话同一时刻只允许一个总结事务，避免重复卡片和边界竞争。 */
  private summaryTasks = new Map<string, Promise<ChatSession>>();

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * 初始化摘要子模块。
   * 绑定 AbortSignal，供内核销毁时中止进行中的 LLM 调用。
   */
  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
  }

  /**
   * 销毁子模块。
   * 中止进行中的 LLM 调用。
   * 保留已 aborted 的实例（与 MemoryExtractor 一致），让后续调用能识别销毁状态。
   */
  destroy(signal?: AbortSignal): void {
    if (signal) {
      if (signal.aborted) this.abortController?.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
    this.abortController?.abort();
  }

  /**
   * 检测并触发摘要。
   *
   * 触发条件：
   *   - force=true：强制总结当前未总结消息
   *   - 未总结消息数 >= maxAllowedUnsummarized（= triggerRounds × 2）
   *
   * 降级场景：
   *   - 免 Key 模式（apiKey 为空）：force=true 抛错，否则静默跳过
   *   - AbortSignal 触发：返回原 session
   *   - LLM 调用失败：抛错给上层中间件捕获
   *
   * @returns 更新后的 session（若触发摘要）或原 session（未触发）
   */
  async checkAndSummarize(
    session: ChatSession,
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    force: boolean,
    signal?: AbortSignal
  ): Promise<ChatSession> {
    const running = this.summaryTasks.get(session.id);
    if (running) return running;
    const task = this.checkAndSummarizeOnce(
      session,
      settings,
      activeCharacter,
      force,
      signal,
    ).finally(() => {
      if (this.summaryTasks.get(session.id) === task) {
        this.summaryTasks.delete(session.id);
      }
    });
    this.summaryTasks.set(session.id, task);
    return task;
  }

  private async checkAndSummarizeOnce(
    session: ChatSession,
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<ChatSession> {
    if (!this.kernel) {
      throw new Error('[MemorySummary] Not initialized. Call init() first.');
    }

    // 合并外部 signal 与服务级 signal
    const linkedSignal = this.mergeSignal(signal);
    const activeSignal = linkedSignal.signal;
    try {
    if (activeSignal?.aborted) return session;

    // 若未启用自动整理且非强制，直接返回
    const isEnabled = settings.memory?.enableAutoSummary !== false;
    if (!force && !isEnabled) {
      return session;
    }

    // 0. 计算触发阈值
    const summaryTurnsVal = settings?.memory?.summaryTriggerTurns;
    const rawTriggerTurns = summaryTurnsVal ? Number(summaryTurnsVal) : 0;

    const rawRecentTurns = Number(settings?.memory?.recentTurns || DEFAULT_RECENT_TURNS);
    const triggerRounds =
      !isNaN(rawTriggerTurns) && rawTriggerTurns > 0 ? rawTriggerTurns : rawRecentTurns;
    const safeTriggerRounds = Math.max(MIN_TRIGGER_ROUNDS, triggerRounds);
    const maxAllowedUnsummarized = safeTriggerRounds * 2;

    // 1. 只读取上次摘要边界之后、达到本轮阈值所需的消息。
    // UI 会话只持有分页窗口，不能用于判断全量未总结数；同时也无需每轮扫描完整长会话。
    let messages: Message[];
    if (this.storage && typeof this.storage.getMessagesBySession === 'function') {
      let resolvedLastId = session.lastSummarizedMessageId;
      let boundary = resolvedLastId
        ? await this.storage.getMessageById(resolvedLastId)
        : null;
      if ((!boundary || boundary.sessionId !== session.id) && resolvedLastId) {
        resolvedLastId = session.summaries?.at(-1)?.lastMessageId;
        boundary = resolvedLastId
          ? await this.storage.getMessageById(resolvedLastId)
          : null;
      }
      const records: MessageRecord[] = await this.storage.getMessagesBySession(session.id, {
        limit: maxAllowedUnsummarized,
        descending: false,
        minTurnIndexExclusive: boundary?.sessionId === session.id
          ? boundary.turnIndex
          : undefined,
      });
      messages = records.map((record) => ({
        id: record.id,
        sender: record.role === 'user' ? 'user' : record.role === 'system' ? 'system' : 'assistant',
        content: record.content,
        timestamp: record.createdAt,
        extra: record.metadata,
      }));
    } else {
      // 测试 Mock 降级：仅在没有持久化查询能力时使用内存窗口。
      const fallback = session.messages || [];
      const boundaryIndex = session.lastSummarizedMessageId
        ? fallback.findIndex((message) => message.id === session.lastSummarizedMessageId)
        : -1;
      messages = fallback.slice(boundaryIndex + 1, boundaryIndex + 1 + maxAllowedUnsummarized);
    }

    const unsummarizedCount = messages.length;

    // 2. 未达阈值且非强制，直接返回
    if (!force && unsummarizedCount < maxAllowedUnsummarized) {
      return session;
    }

    if (unsummarizedCount === 0) {
      if (force) {
        throw new Error('当前没有未被总结的有效对话。');
      }
      return session;
    }

    const messagesToCompress = messages;

    // 4. 免 Key 模式降级
    if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
      if (force) {
        throw new Error('当前处于免 Key 体验模式下，已自动禁用总结功能以节省频宽额度。');
      }
      return session;
    }

    // 5. 调用 LLM 生成摘要
    if (activeSignal?.aborted) return session;

    const compiledSummary = await this.generateSummary(
      messagesToCompress,
      settings,
      activeCharacter,
      activeSignal
    );

    if (activeSignal?.aborted) return session;

    if (!compiledSummary) {
      throw new Error('记忆整理失败，请检查API连接。');
    }

    // 6. 构造 SummaryCard（瘦身版：砍掉 5 条正则状态抽离）
    const newCard = this.buildSummaryCard(
      compiledSummary,
      session.summaries?.length ?? 0,
      settings,
      activeCharacter,
      messagesToCompress[messagesToCompress.length - 1].id
    );

    if (activeSignal?.aborted) return session;

    // 7. 原子化追加摘要并持久化，同时保留内存中的消息列表以防控制台/UI状态丢失
    const db = this.kernel.getService<IDatabaseService<ChatSession, CharacterCard, SummaryCard>>(
      KernelServices.Database
    );
    const updatedSessionWithoutMsgs = await db.appendSessionSummary(
      session.id,
      newCard,
      activeSignal
    );

    return {
      ...session,
      summaries: updatedSessionWithoutMsgs.summaries,
      lastSummarizedMessageId: updatedSessionWithoutMsgs.lastSummarizedMessageId,
    };
    } finally {
      linkedSignal.dispose();
    }
  }

  /**
   * 调用 LLM 生成摘要正文。
   * 抽出为独立方法，便于未来扩展（如异步队列、重试策略）。
   *
   * @returns 摘要正文文本，失败返回空字符串
   */
  async generateSummary(
    messages: Message[],
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.kernel) {
      throw new Error('[MemorySummary] Not initialized. Call init() first.');
    }

    const cleanContent = (text: string): string => {
      if (!text) return "";
      return text
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*?$/gi, "")
        .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
        .replace(/<memory>[\s\S]*?$/gi, "")
        .replace(/(?:updateRow|insertRow|deleteRow)\s*\(.*?\)/gi, "")
        .trim();
    };

    const promptInstruction = settings?.memory?.summarySystemPrompt || '';
    const contentConcat = messages
      .map(
        (m) =>
          `${m.sender === 'user' ? settings?.userName || 'user' : activeCharacter?.name || '角色'}: ${cleanContent(m.content)}`
      )
      .join('\n');

    // 解析最终 API 参数（含免 Key 模式降级）：收口到 resolveApiCredentials helper。
    // 后台任务：trial 配额耗尽时静默跳过，返回空字符串不阻塞主流程。
    let creds;
    try {
      creds = resolveApiCredentials(settings);
    } catch (e) {
      if (e instanceof TrialExhaustedError) {
        logger.info('Trial quota exhausted, skip summary');
        return '';
      }
      throw e;
    }
    const { apiKey: finalApiKey, baseUrl: finalBaseUrl, model: finalModel, chatPath: finalChatPath } = creds;

    const reqBody = {
      model: finalModel,
      messages: [
        { role: 'system', content: promptInstruction },
        { role: 'user', content: contentConcat },
      ],
      stream: false,
      temperature: SUMMARY_TEMPERATURE,
      max_tokens: SUMMARY_MAX_TOKENS,
    };

    const llm = this.kernel.getService<ILLMService>(KernelServices.LLM);
    let response: Response;
    try {
      response = await llm.universalFetch(
        API_ENDPOINT.ProxyOpenAI,
        {
          baseUrl: finalBaseUrl,
          apiKey: finalApiKey,
          chatPath: finalChatPath,
          reqBody,
          bypassProxy: settings.api.bypassProxy,
          forceBasicParams: settings.api.forceBasicParams,
        },
        signal
      );
    } catch (e) {
      // 后台任务：试用 Key 拉取失败时静默跳过，不阻塞主流程
      if (e instanceof TrialKeyFetchError) {
        logger.info('Trial key fetch failed, skip summary');
        return '';
      }
      throw e;
    }

    if (!response.ok) {
      logger.error('fetch failed with status', undefined, { status: response.status });
      throw new Error(`API 返回错误状态码 ${response.status}`);
    }

    const responseText = await response.text();
    let resData: unknown;
    try {
      resData = JSON.parse(responseText);
    } catch (e) {
      logger.error('JSON parse failed. Response text was', e, { responseText });
      throw new Error('接口返回数据格式错误，解析 JSON 失败');
    }

    if (resData && typeof resData === 'object') {
      const choices = (resData as Record<string, unknown>).choices;
      const first = Array.isArray(choices) ? choices[0] : undefined;
      const message = first && typeof first === 'object'
        ? (first as Record<string, unknown>).message
        : undefined;
      const content = message && typeof message === 'object'
        ? (message as Record<string, unknown>).content
        : undefined;
      if (typeof content === 'string') return content;
    }
    return '';
  }

  /**
   * 构造瘦身版 SummaryCard。
   *
   * 砍掉的字段（不再从 LLM 输出正则抽离）：
   *   - condition / inventory / bonding：始终 undefined
   *
   * 保留的字段：
   *   - timeTag: 基于 index 模板渲染（默认 "第N幕"）
   *   - location: activeCharacter.scenario 前 8 字符兜底（向后兼容旧 UI）
   *   - content: LLM 摘要正文 trim
   *   - lastMessageId: 最后一条被总结的消息 ID
   */
  private buildSummaryCard(
    compiledSummary: string,
    existingSummaryCount: number,
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    lastMessageId: string
  ): SummaryCard {
    const indexVal = existingSummaryCount + 1;
    const timeTagTemplate = settings?.memory?.timeTagTemplate || DEFAULT_TIME_TAG_TEMPLATE;
    const timeTag = timeTagTemplate.replace(/\{\{index\}\}/g, String(indexVal));

    const contentText = compiledSummary.trim();
    const locationStr =
      activeCharacter?.scenario?.slice(0, LOCATION_MAX_LEN) || FALLBACK_LOCATION;

    return {
      id: generateUniqueId('summary_'),
      timeTag,
      location: locationStr,
      content: contentText,
      // 砍掉 5 条正则状态抽离：condition / inventory / bonding 不再生成
      lastMessageId,
    };
  }

  /**
   * 合并外部 signal 与服务级 signal。
   * 任一触发 abort，则合并后的 signal 视为 aborted。
   */
  private mergeSignal(external?: AbortSignal): { signal?: AbortSignal; dispose: () => void } {
    if (!this.abortController) return { signal: external, dispose: () => undefined };
    const internal = this.abortController.signal;
    if (!external) return { signal: internal, dispose: () => undefined };
    // 外部 signal 已 aborted → 直接返回
    if (external.aborted) return { signal: external, dispose: () => undefined };
    // 内部 signal 已 aborted → 直接返回
    if (internal.aborted) return { signal: internal, dispose: () => undefined };

    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    external.addEventListener('abort', relayAbort, { once: true });
    internal.addEventListener('abort', relayAbort, { once: true });
    return {
      signal: controller.signal,
      dispose: () => {
        external.removeEventListener('abort', relayAbort);
        internal.removeEventListener('abort', relayAbort);
      },
    };
  }
}
