import { IScriptService, IKernel, IDatabaseService } from "../serviceContracts";
import { CharacterCard, ChatSession } from "../../types";
import { parseMvuMessage as parseMvuMessageDirect, applyCharacterRegexScripts } from "../../compatibility/sillytavern/mvuParser";
import JSON5 from "json5";
import { Logger } from "../../utils/logger";

const logger = Logger.create("ScriptService");


export interface ITavernHelperBridge {
  initializeMvuFromCharacter(character: unknown): Record<string, unknown>;
  parseMvuMessage(messageContent: string, currentVariables: Record<string, unknown>, signal?: AbortSignal): Record<string, unknown>;
  notifyVariablesUpdated(session: unknown): void;
}

/**
 * MVU 变量结构防腐清洗函数
 *
 * 遵循 AGENTS.md 准则一.3（外部接口防腐隔离）：
 * 对 tavernHelperBridge 返回的 MVU 变量进行结构校验与清洗，
 * 防止非标参数或脏数据渗透到核心逻辑层与数据库物理存储层。
 *
 * @param raw - tavernHelperBridge 返回的原始变量对象
 * @returns 清洗后的安全变量对象
 */
function cleanMvuVariables(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return { stat_data: {} };
  }

  const cleaned: Record<string, unknown> = {};

  // stat_data 是 MVU 的核心数据载体，必须为纯对象
  if (raw.stat_data && typeof raw.stat_data === "object" && !Array.isArray(raw.stat_data)) {
    cleaned.stat_data = sanitizeValueObject(raw.stat_data as Record<string, unknown>);
  } else {
    cleaned.stat_data = {};
  }

  // schema 是 Zod schema 描述，必须为纯对象
  if (raw.schema && typeof raw.schema === "object" && !Array.isArray(raw.schema)) {
    cleaned.schema = raw.schema;
  }

  // display_data 是 UI 展示配置，必须为纯对象
  if (raw.display_data && typeof raw.display_data === "object" && !Array.isArray(raw.display_data)) {
    cleaned.display_data = raw.display_data;
  }

  // delta_data 是增量变更记录，必须为纯对象
  if (raw.delta_data && typeof raw.delta_data === "object" && !Array.isArray(raw.delta_data)) {
    cleaned.delta_data = raw.delta_data;
  }

  // P1-B 修复：initialized_lorebooks 是 Mvu.getMvuData 显式读取的合法字段
  // （见 tavernHelperMocks.ts 的 Mvu.getMvuData 实现），白名单需保留以避免静默丢失。
  if (raw.initialized_lorebooks && typeof raw.initialized_lorebooks === "object" && !Array.isArray(raw.initialized_lorebooks)) {
    cleaned.initialized_lorebooks = raw.initialized_lorebooks;
  }

  return cleaned;
}

/**
 * 递归清洗值对象，移除函数、Symbol、原型链等非数据型属性
 */
function sanitizeValueObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "function" || typeof val === "symbol") {
      continue;
    }
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      sanitized[key] = sanitizeValueObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      sanitized[key] = val.map((item) =>
        item !== null && typeof item === "object" ? sanitizeValueObject(item as Record<string, unknown>) : item
      );
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

/**
 * 角色卡输入防腐清洗函数
 *
 * 对输入的 character 进行字段校验与降级处理，
 * 防止角色卡扩展字段中的非标参数直接渗透到 MVU 解析逻辑。
 */
function cleanCharacterForMvu(character: CharacterCard | null | undefined): CharacterCard | null {
  if (!character || typeof character !== "object") {
    return null;
  }

  // 确保 extensions 字段是安全对象
  const cleaned = { ...character };
  if (!cleaned.extensions || typeof cleaned.extensions !== "object" || Array.isArray(cleaned.extensions)) {
    cleaned.extensions = {};
  }

  return cleaned;
}

/**
 * 会话输入防腐清洗函数
 *
 * 对输入的 session 进行字段校验与降级处理，
 * 确保变量字段是安全对象。
 */
function cleanSessionForMvu(session: ChatSession): ChatSession {
  const cleaned = { ...session };
  if (!cleaned.variables || typeof cleaned.variables !== "object" || Array.isArray(cleaned.variables)) {
    cleaned.variables = { stat_data: {} };
  }
  if (!cleaned.messages || !Array.isArray(cleaned.messages)) {
    cleaned.messages = [];
  }
  return cleaned;
}

const isDev = (): boolean => {
  try {
    return Boolean(
      (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ||
        (typeof window !== "undefined" && window.location?.hostname === "localhost")
    );
  } catch {
    return false;
  }
};

function createAbortError(message = "Script execution was aborted"): DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error as unknown as DOMException;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function checkAborted(...signals: Array<AbortSignal | undefined>): void {
  if (signals.some((signal) => signal?.aborted)) {
    throw createAbortError();
  }
}

export class ScriptService implements IScriptService<CharacterCard, ChatSession> {
  name = "script";
  private kernel!: IKernel;
  private bridge: ITavernHelperBridge | null = null;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时清理 bridge 引用与 abort 控制器
  // 遵循 AGENTS.md 准则十.4（彻底回收）：
  // 通过 kernel 消息总线广播 script:destroyed 事件，通知下游组件（HiddenScriptLayer 等）
  // 主动回收 iframe DOM 与挂起的异步任务，防止资源残留。
  destroy(): void {
    try {
      this.kernel?.publish({ topic: "script:destroyed", payload: { reason: "service-destroy" } }).catch(() => {});
    } catch {
      // kernel 已注销时静默降级
    }
    this.abortController?.abort();
    this.abortController = null;
    this.bridge = null;
  }

  registerBridge(bridge: ITavernHelperBridge): void {
    this.bridge = bridge;
  }

  initializeMvuFromCharacter(character: CharacterCard): Record<string, unknown> {
    // 防腐隔离：清洗输入
    const safeCharacter = cleanCharacterForMvu(character);
    if (!safeCharacter) {
      return { stat_data: {} };
    }

    try {
      let rawVariables: Record<string, unknown> | undefined;
      if (this.bridge) {
        rawVariables = this.bridge.initializeMvuFromCharacter(safeCharacter);
      } else {
        rawVariables = localInitializeMvuFromCharacter(safeCharacter);
      }
      // 防腐隔离：清洗输出，防止脏数据渗透到核心逻辑层
      return cleanMvuVariables(rawVariables);
    } catch (e) {
      if (isDev()) {
        logger.warn("initializeMvuFromCharacter failed", { error: e });
      }
      return { stat_data: {} };
    }
  }

  parseMvuMessage(messageContent: string, currentVariables: Record<string, unknown>, signal?: AbortSignal): Record<string, unknown> {
    checkAborted(signal, this.abortController?.signal);
    // 防腐隔离：清洗输入变量
    const safeCurrentVars = cleanMvuVariables(currentVariables);

    if (!messageContent || typeof messageContent !== "string") {
      return safeCurrentVars;
    }

    try {
      let rawParsed: Record<string, unknown> | undefined;
      if (this.bridge) {
        rawParsed = this.bridge.parseMvuMessage(messageContent, safeCurrentVars, signal);
      } else {
        rawParsed = parseMvuMessageDirect(messageContent, safeCurrentVars, signal);
      }
      // 防腐隔离：清洗输出
      return cleanMvuVariables(rawParsed);
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (isDev()) {
        logger.warn("parseMvuMessage failed", { error: e });
      }
      return safeCurrentVars;
    }
  }


  async executeMvuScript(session: ChatSession, messageContent: string, signal?: AbortSignal): Promise<ChatSession> {
    checkAborted(signal, this.abortController?.signal);
    // 防腐隔离：清洗输入会话
    const safeSession = cleanSessionForMvu(session);

    try {
      if (isDev()) {
        logger.debug("Parsing message");
      }

      let character: CharacterCard | null = null;
      if (this.kernel.hasService("database")) {
        const dbService = this.kernel.getService<IDatabaseService<ChatSession, CharacterCard, ChatSession["summaries"][number], unknown>>("database");
        character = await dbService.getCharacterById(safeSession.characterId);
        checkAborted(signal, this.abortController?.signal);
      }
      
      let isAi = true;
      if (safeSession.messages && safeSession.messages.length > 0) {
        const lastMsg = safeSession.messages[safeSession.messages.length - 1];
        isAi = lastMsg?.sender === "assistant";
      }
      
      let processedContent = messageContent;
      if (character) {
        processedContent = applyCharacterRegexScripts(
          messageContent,
          character,
          isAi,
          undefined,
          undefined,
          "store",
          signal ?? this.abortController?.signal,
        );
      }
      
      const parsedVariables = this.parseMvuMessage(
        processedContent,
        safeSession.variables || {},
        signal ?? this.abortController?.signal,
      );

      let updatedMessages = safeSession.messages;
      if (updatedMessages.length > 0) {
        const lastMsg = { ...updatedMessages[updatedMessages.length - 1] };
        const swipeId = lastMsg.swipe_id !== undefined ? lastMsg.swipe_id : 0;
        const extra = { ...lastMsg.extra };
        if (!extra.variables) extra.variables = {};
        extra.variables = {
          ...extra.variables,
          [swipeId]: parsedVariables,
        };
        lastMsg.extra = extra;
        lastMsg.variables = extra.variables;
        updatedMessages = [
          ...safeSession.messages.slice(0, -1),
          lastMsg,
        ];
        if (isDev()) {
          logger.debug("Synced parsed variables to last message", { swipeId });
        }
      }

      const updatedSession = {
        ...safeSession,
        variables: parsedVariables,
        messages: updatedMessages,
      };

      // notifyVariablesUpdated 统一由 pipelineHelpers.ts 在 pipeline 执行完毕后
      // 调用一次（含 mag_variable_initialized / message_received / character_message_rendered），
      // 此处不再重复触发，防止同一个 AI 回复产生 6 次事件通知风暴导致 WebView CPU 尖峰闪退。
      // 若 bridge 不可用（直接调用 executeMvuScript 的路径），
      // 降级通过 HiddenScriptLayer 订阅的 script:mvuVariablesUpdated 事件通知 iframe。

      return updatedSession;
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (isDev()) {
        logger.warn("Failed to parse MVU message", { error: e });
      }
      return session;
    }
  }
}

function localInitializeMvuFromCharacter(character: CharacterCard | null | undefined): Record<string, unknown> {
  if (!character) return { stat_data: {} };

  const ext = (character.extensions || {}) as Record<string, unknown>;
  const variables: Record<string, unknown> = {
    stat_data: {},
    schema: { type: 'object', properties: {} },
    display_data: {},
    delta_data: {},
  };

  let mvuSettings: Record<string, unknown> | string | null | undefined =
    (ext.mvu_settings as Record<string, unknown> | undefined) ||
    (ext.mvu as Record<string, unknown> | undefined) ||
    (ext.MVU as Record<string, unknown> | undefined) ||
    null;

  if (typeof mvuSettings === "string") {
    // 取局部变量持有原始字符串，避免 try/catch 跨块重新赋值导致 mvuSettings 类型被放宽回联合类型。
    const rawStr = mvuSettings;
    try {
      mvuSettings = JSON5.parse(rawStr) as Record<string, unknown>;
    } catch {
      try {
        mvuSettings = JSON.parse(rawStr) as Record<string, unknown>;
      } catch {
        mvuSettings = null;
      }
    }
  }

  if (mvuSettings && typeof mvuSettings === "object") {
    const settings = mvuSettings as Record<string, unknown>;
    if (settings.schema) {
      variables.schema = settings.schema;
    }
    if (settings.stat_data && typeof settings.stat_data === "object") {
      variables.stat_data = { ...(settings.stat_data as Record<string, unknown>) };
    } else if (settings.defaults && typeof settings.defaults === "object") {
      variables.stat_data = { ...(settings.defaults as Record<string, unknown>) };
    }
    if (settings.display_data && typeof settings.display_data === "object") {
      variables.display_data = { ...(settings.display_data as Record<string, unknown>) };
    }
  }

  if (!variables.stat_data) {
    variables.stat_data = {};
  }

  if (character.first_mes) {
    try {
      const processedGreeting = applyCharacterRegexScripts(character.first_mes, character, undefined, undefined, undefined, "store");
      const parsedVars = parseMvuMessageDirect(processedGreeting, variables);
      if (parsedVars && parsedVars.stat_data && typeof parsedVars.stat_data === "object") {
        variables.stat_data = { ...(variables.stat_data as Record<string, unknown>), ...(parsedVars.stat_data as Record<string, unknown>) };
      }
    } catch (e) {
      logger.warn("Failed to parse first_mes initvars", { error: e });
    }
  }

  // P0-A 修复：解析 Worldbook/Lorebook 中的 [initvar] 词条
  // 与 bridgeCore.initializeMvuFromCharacter 保持逻辑一致，
  // 防止会话创建时 bridge 未注册导致 lorebook 初始变量丢失。
  // 注意：SillyTavern v2 角色卡的 character_book 字段不在 CharacterCard 显式声明中
  // （历史数据保留在 extensions.world 或顶层 character_book），此处通过 extensions 兼容读取。
  const worldFromExt = (ext.world ?? ext.character_book) as { entries?: ReadonlyArray<{ content?: string; comment?: string }> } | undefined;
  const lorebookEntries = worldFromExt?.entries || [];
  if (Array.isArray(lorebookEntries)) {
    for (const entry of lorebookEntries) {
      if (!entry || !entry.content) continue;
      const comment = (entry.comment || "").toLowerCase();
      const content = entry.content;
      if (comment.includes("initvar") || comment.includes("stat_data") || content.includes("<initvar>") || content.includes("stat_data:")) {
        try {
          const parsedVars = parseMvuMessageDirect(content, variables);
          if (parsedVars && parsedVars.stat_data && typeof parsedVars.stat_data === "object") {
            const parsedStat = parsedVars.stat_data as Record<string, unknown>;
            if (Object.keys(parsedStat).length > 0) {
              variables.stat_data = { ...(variables.stat_data as Record<string, unknown>), ...parsedStat };
            }
          }
        } catch (e) {
          logger.warn("Failed to parse lorebook initvars", { error: e });
        }
      }
    }
  }

  return variables;
}

