import { IScriptService, IKernel } from "../types";
import { CharacterCard, ChatSession } from "../../types";

export interface ITavernHelperBridge {
  initializeMvuFromCharacter(character: any): Record<string, any>;
  parseMvuMessage(messageContent: string, currentVariables: Record<string, any>): Record<string, any>;
  notifyVariablesUpdated(session: any): void;
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
function cleanMvuVariables(raw: Record<string, any> | null | undefined): Record<string, any> {
  if (!raw || typeof raw !== "object") {
    return { stat_data: {} };
  }

  const cleaned: Record<string, any> = {};

  // stat_data 是 MVU 的核心数据载体，必须为纯对象
  if (raw.stat_data && typeof raw.stat_data === "object" && !Array.isArray(raw.stat_data)) {
    cleaned.stat_data = sanitizeValueObject(raw.stat_data);
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

  return cleaned;
}

/**
 * 递归清洗值对象，移除函数、Symbol、原型链等非数据型属性
 */
function sanitizeValueObject(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "function" || typeof val === "symbol") {
      continue;
    }
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      sanitized[key] = sanitizeValueObject(val);
    } else if (Array.isArray(val)) {
      sanitized[key] = val.map((item) =>
        item !== null && typeof item === "object" ? sanitizeValueObject(item) : item
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
      (import.meta as any).env?.DEV ||
        (typeof window !== "undefined" && window.location?.hostname === "localhost")
    );
  } catch {
    return false;
  }
};

export class ScriptService implements IScriptService {
  name = "script";
  private kernel!: IKernel;
  private bridge: ITavernHelperBridge | null = null;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  registerBridge(bridge: ITavernHelperBridge): void {
    this.bridge = bridge;
  }

  initializeMvuFromCharacter(character: CharacterCard): Record<string, any> {
    // 防腐隔离：清洗输入
    const safeCharacter = cleanCharacterForMvu(character);
    if (!safeCharacter) {
      return { stat_data: {} };
    }

    try {
      if (!this.bridge) {
        if (isDev()) {
          console.warn("[ScriptService] initializeMvuFromCharacter: TavernHelperBridge is not registered yet. Falling back.");
        }
        return { stat_data: {} };
      }
      const rawVariables = this.bridge.initializeMvuFromCharacter(safeCharacter);
      // 防腐隔离：清洗输出，防止脏数据渗透到核心逻辑层
      return cleanMvuVariables(rawVariables);
    } catch (e) {
      if (isDev()) {
        console.warn("[ScriptService] initializeMvuFromCharacter failed:", e);
      }
      return { stat_data: {} };
    }
  }

  parseMvuMessage(messageContent: string, currentVariables: Record<string, any>): Record<string, any> {
    // 防腐隔离：清洗输入变量
    const safeCurrentVars = cleanMvuVariables(currentVariables);

    if (!messageContent || typeof messageContent !== "string") {
      return safeCurrentVars;
    }

    try {
      if (!this.bridge) {
        if (isDev()) {
          console.warn("[ScriptService] parseMvuMessage: TavernHelperBridge is not registered. Returning input variables.");
        }
        return safeCurrentVars;
      }
      const rawParsed = this.bridge.parseMvuMessage(messageContent, safeCurrentVars);
      // 防腐隔离：清洗输出
      return cleanMvuVariables(rawParsed);
    } catch (e) {
      if (isDev()) {
        console.warn("[ScriptService] parseMvuMessage failed:", e);
      }
      return safeCurrentVars;
    }
  }

  async executeMvuScript(session: ChatSession, messageContent: string): Promise<ChatSession> {
    // 防腐隔离：清洗输入会话
    const safeSession = cleanSessionForMvu(session);

    try {
      if (isDev()) {
        console.log("[ScriptService] Parsing message...");
      }
      const parsedVariables = this.parseMvuMessage(messageContent, safeSession.variables || {});

      let updatedMessages = safeSession.messages;
      if (updatedMessages.length > 0) {
        const lastMsg = { ...updatedMessages[updatedMessages.length - 1] } as any;
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
          console.log(`[ScriptService] Synced parsed variables to last message (swipeId: ${swipeId})`);
        }
      }

      const updatedSession = {
        ...safeSession,
        variables: parsedVariables,
        messages: updatedMessages,
      };

      // 防腐隔离：将全局副作用调用包装在 try/catch 中，
      // 并通过 kernel 消息总线发布事件，遵循准则一.4（副作用隔离）
      try {
        if (this.bridge) {
          this.bridge.notifyVariablesUpdated(updatedSession);
        } else {
          // 如果没有 bridge，直接降级发布事件
          this.kernel?.publish({ topic: "script:mvuVariablesUpdated", payload: { session: updatedSession } });
        }
      } catch (notifyErr) {
        if (isDev()) {
          console.warn("[ScriptService] notifyVariablesUpdated failed:", notifyErr);
        }
        // 降级：通过 kernel 消息总线发布事件
        try {
          this.kernel?.publish({ topic: "script:mvuVariablesUpdated", payload: { session: updatedSession } });
        } catch {
          // 静默降级，不影响主流程
        }
      }

      return updatedSession;
    } catch (e) {
      if (isDev()) {
        console.warn("[ScriptService] Failed to parse MVU message:", e);
      }
      // 安全兜底：返回原始会话，不抛错
      return session;
    }
  }
}
