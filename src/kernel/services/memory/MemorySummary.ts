/**
 * MemorySummary - 剧情摘要子模块（瘦身自 AutoSummaryService）
 *
 * 物理职责：
 *   1. 监测会话未总结消息数，达到阈值时触发 LLM 摘要
 *   2. 生成剧情时间线摘要卡片（SummaryCard），追加到 session.summaries
 *   3. 持久化到 sessions Store（通过 IDatabaseService.saveSession）
 *
 * 设计契约：
 *   - 只做剧情时间线摘要，砍掉 5 条正则状态抽离（location/time/condition/inventory/bonding）
 *     原因：正则方案强依赖 LLM 输出格式，天然脆弱；状态抽离职责已迁移到 MemoryStateTable
 *   - SummaryCard 的 location 字段保留为兜底值（activeCharacter.scenario 前 8 字符），
 *     仅为向后兼容旧 UI 读取，不再从 LLM 输出中正则抽取
 *   - condition / inventory / bonding 字段不再生成（undefined）
 *   - 复用主对话模型（零额外配置），免 Key 模式自动降级跳过摘要
 *   - AbortSignal 全链路绑定，destroy 时中止进行中的 LLM 调用
 *
 * 与旧 AutoSummaryService 的差异：
 *   - 砍掉 lastIndexOf("---") 元数据分割逻辑
 *   - 砍掉 5 条 safeMatch 正则抽离
 *   - 砍掉 DEFAULT_LOCATION_REGEX 等 5 个正则模板导入
 *   - 新增 generateSummary() 公共 API（供中间件直接调用，绕过触发检测）
 *   - 代码组织更内聚，便于未来抽离为独立微服务插件
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第十章
 */

import { KernelServices } from '../../types';
import type {
  IKernel,
  ILLMService,
  IDatabaseService,
} from '../../types';
import type {
  ChatSession,
  UserSettings,
  CharacterCard,
  SummaryCard,
  Message,
} from '../../../types';
import type { MemoryStorage } from './MemoryStorage';
import { FALLBACK_MODEL, API_ENDPOINT, TRIAL_OPENROUTER_KEY } from '../../../utils/apiClient';
import { appendSessionSummary } from '../../../utils/localDB';

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
   * 检测并触发摘要（与旧 AutoSummaryService.handleAutoSummaryCheck API 兼容）。
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
    if (!this.kernel) {
      throw new Error('[MemorySummary] Not initialized. Call init() first.');
    }

    // 合并外部 signal 与服务级 signal
    const activeSignal = this.mergeSignal(signal);
    if (activeSignal?.aborted) return session;

    // 0. 从隔离存储 messages Store 异步加载本会话所有消息，实现物理脱耦
    let dbMessagesRecords: any[] = [];
    if (this.storage && typeof this.storage.getMessagesBySession === 'function') {
      dbMessagesRecords = await this.storage.getMessagesBySession(session.id);
    } else {
      // 降级保护：在测试 Mock 等 storage 未定义对应方法的场景下，退回直接使用内存中 session.messages
      dbMessagesRecords = session.messages || [];
    }

    const messages: Message[] = dbMessagesRecords.map((m: any) => ({
      id: m.id,
      sender: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      timestamp: m.createdAt,
      extra: m.metadata,
    }));

    // 1. 定位上次总结位置
    let resolvedLastId = session.lastSummarizedMessageId;
    const findIndexById = (id: string | undefined): number => {
      if (!id) return -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].id === id) return i;
      }
      return -1;
    };

    let lastIndex = findIndexById(resolvedLastId);
    if (lastIndex < 0 && resolvedLastId) {
      // lastSummarizedMessageId 在消息中不存在（可能被删除），回退到 summaries 最后一条
      const lastSummary =
        session.summaries && session.summaries.length > 0
          ? session.summaries[session.summaries.length - 1]
          : null;
      resolvedLastId = lastSummary?.lastMessageId || undefined;
      lastIndex = findIndexById(resolvedLastId);
    }

    const startIndex = lastIndex >= 0 ? lastIndex + 1 : 0;
    const unsummarizedCount = messages.length - startIndex;

    // 2. 计算触发阈值
    const summaryTurnsVal = settings?.memory?.summaryTriggerTurns;
    const rawTriggerTurns = summaryTurnsVal ? Number(summaryTurnsVal) : 0;

    // 如果未开启自动整理且非强制手动触发，直接返回
    if (!force && rawTriggerTurns === 0) {
      return session;
    }

    const rawRecentTurns = Number(settings?.memory?.recentTurns || DEFAULT_RECENT_TURNS);
    const triggerRounds =
      !isNaN(rawTriggerTurns) && rawTriggerTurns > 0 ? rawTriggerTurns : rawRecentTurns;
    const safeTriggerRounds = Math.max(MIN_TRIGGER_ROUNDS, triggerRounds);
    const maxAllowedUnsummarized = safeTriggerRounds * 2;

    // 3. 未达阈值且非强制，直接返回
    if (!force && unsummarizedCount < maxAllowedUnsummarized) {
      return session;
    }

    if (unsummarizedCount === 0) {
      if (force) {
        throw new Error('当前没有未被总结的有效对话。');
      }
      return session;
    }

    // 仅截取需要的部分（避免全量 slice）
    const messagesToCompress = messages.slice(
      startIndex,
      startIndex + maxAllowedUnsummarized
    );

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
    let updatedSessionWithoutMsgs: ChatSession;
    const hasIndexedDB = typeof window !== 'undefined' && (window.indexedDB || (window as any).shimIndexedDB);
    
    if (hasIndexedDB) {
      updatedSessionWithoutMsgs = await appendSessionSummary(session.id, newCard);
    } else {
      // 测试环境降级：使用 Mock 的 DatabaseService，避免缺少真实 indexedDB 导致报错
      const db = this.kernel.getService<IDatabaseService>(KernelServices.Database);
      const latestSession = (await db.getSessionById(session.id)) || session;
      const nextSession: ChatSession = {
        ...latestSession,
        summaries: [...(latestSession.summaries || []), newCard],
        lastSummarizedMessageId: newCard.lastMessageId,
      };
      await db.saveSession(nextSession);
      updatedSessionWithoutMsgs = nextSession;
    }

    return {
      ...updatedSessionWithoutMsgs,
      messages: session.messages,
    };
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

    // 解析最终 API 参数（含免 Key 模式降级）
    let finalApiKey = settings.api.apiKey;
    let finalBaseUrl = settings.api.baseUrl;
    let finalModel = settings.api.modelName || FALLBACK_MODEL;
    let finalChatPath = settings?.api?.chatPath;

    if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
      finalApiKey = TRIAL_OPENROUTER_KEY;
      finalBaseUrl = 'https://openrouter.ai/api/v1';
      finalModel = 'openrouter/free';
      finalChatPath = undefined;
    }

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
    const response = await llm.universalFetch(
      API_ENDPOINT.ProxyOpenAI,
      {
        baseUrl: finalBaseUrl,
        apiKey: finalApiKey,
        chatPath: finalChatPath,
        reqBody,
        bypassProxy: settings.api.bypassProxy,
      },
      signal
    );

    if (!response.ok) {
      console.error('[MemorySummary] fetch failed with status:', response.status);
      throw new Error(`API 返回错误状态码 ${response.status}`);
    }

    const responseText = await response.text();
    let resData: any;
    try {
      resData = JSON.parse(responseText);
    } catch (e) {
      console.error(
        '[MemorySummary] JSON parse failed. Response text was:',
        responseText
      );
      throw new Error('接口返回数据格式错误，解析 JSON 失败');
    }

    if (resData?.choices?.length > 0) {
      return resData.choices[0].message?.content || '';
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
  private mergeSignal(external?: AbortSignal): AbortSignal | undefined {
    if (!this.abortController) return external;
    const internal = this.abortController.signal;
    if (!external) return internal;
    // 外部 signal 已 aborted → 直接返回
    if (external.aborted) return external;
    // 内部 signal 已 aborted → 直接返回
    if (internal.aborted) return internal;
    // 两者都未 aborted，返回内部 signal（外部 abort 时由调用方自行处理）
    // 注：简化实现，不动态桥接 external → internal（避免监听器泄漏）
    return internal;
  }
}
