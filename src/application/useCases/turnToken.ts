/**
 * Turn 令牌：把「这次异步流程还算不算数」收敛成单一判断。
 *
 * 背景：聊天/重发链路上原先散落 30+ 处手写判断（`isStillActive`、
 * `p.activeSessionIdRef.current === updatedSession.id`），漏一处就是一次陈旧写入。
 *
 * 令牌三件套：
 *  - `commandId`：本次命令的身份，用于诊断与日志关联；
 *  - `sessionId`：命令归属的会话；
 *  - `signal`：本命令的取消信号。
 *  另外记录 `baseRevision`（创建时看到的会话内容修订号）作为诊断依据。
 *
 * ⚠️ 为什么 `baseRevision` **暂不参与**过期判定：
 *   `advanceSessionContentRevision` 会在**任何**权威写入时递增，包括本命令自己的写入
 *   （保存用户消息、最终提交）。而 `commitSessionTurn` 目前返回 `void`，调用方拿不到
 *   "我自己写完后的修订号"，因此 `currentRevision > baseRevision` 无法区分
 *   "别人写了" 与 "我自己刚写完"。若据此判过期，会把本命令的合法提交一起丢掉——
 *   那是数据丢失，比陈旧写入更严重。
 *   触发条件：当 `commitSessionTurn` 等写入 API 返回新的 `contentRevision`（可重定基线）时，
 *   再把修订号臂打开，并同步补测试。
 */

export interface TurnToken {
  readonly commandId: string;
  readonly sessionId: string;
  /** 创建时观察到的会话内容修订号；当前仅用于诊断，不参与过期判定（见文件头说明）。 */
  readonly baseRevision: number | undefined;
  readonly signal: AbortSignal;
}

/** 新鲜度判断所需的最小读端口；由调用方注入，便于测试与解耦。 */
export interface FreshnessPort {
  /** 当前活跃会话 id。 */
  activeSessionId(): string | null;
  /** 该会话当前是否仍在视图里（被删除/切换后为 false）。 */
  hasSession(sessionId: string): boolean;
  /**
   * 该会话当前的内容修订号；视图不提供时返回 undefined。
   * 目前不参与判定，保留给"重定基线"方案启用后使用。
   */
  contentRevision?(sessionId: string): number | undefined;
}

export interface CreateTurnTokenParams {
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly baseRevision?: number;
  /** 便于测试注入；缺省用时间戳 + 随机后缀。 */
  readonly commandId?: string;
}

export function createTurnToken(params: CreateTurnTokenParams): TurnToken {
  return Object.freeze({
    commandId: params.commandId
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    sessionId: params.sessionId,
    baseRevision: params.baseRevision,
    signal: params.signal,
  });
}

/**
 * 唯一的过期判断：任一条件成立即视为过期，调用方**必须**丢弃本次结果、不得写入权威。
 *
 * 1. 活跃会话已经切换；
 * 2. 该会话已不在视图/权威中（被删除）。
 *
 * ⚠️ 取消（`signal.aborted`）**不**算"属主已变"：本仓刻意要落盘被用户中断的回复
 * （弱网/中断分支会提交带标记的最终消息）。把取消并入过期判断会让那次合法提交被丢弃，
 * 属于数据丢失。取消是否要丢弃本次工作由调用方按场景决定，见 `shouldDiscard`。
 */
export function isStale(token: TurnToken, port: FreshnessPort): boolean {
  if (port.activeSessionId() !== token.sessionId) return true;
  if (!port.hasSession(token.sessionId)) return true;
  return false;
}

/**
 * 本次工作是否应当被完全丢弃（不写权威、不碰界面）。
 *
 * 用于"取消后无需保留"的场景（例如遥测、审计发布、乐观 UI 回填）；
 * **不要**用于必须落盘中断结果的提交路径——那里应只用 `isStale` 判断属主是否已变。
 */
export function shouldDiscard(token: TurnToken, port: FreshnessPort): boolean {
  return token.signal.aborted || isStale(token, port);
}

/**
 * 由 Hook 的 ref 构造新鲜度端口。
 *
 * 参数用结构化类型（只要求 `current`），避免 application 层依赖 React 类型；
 * 两个聊天 Hook 共用同一实现，避免各自手写一遍比较逻辑（那正是本次要收掉的散落）。
 */
export function createFreshnessPort(
  activeSessionIdRef: { readonly current: string | null },
  sessionsRef: { readonly current: readonly { readonly id: string }[] },
): FreshnessPort {
  return {
    activeSessionId: () => activeSessionIdRef.current,
    hasSession: (sessionId) => sessionsRef.current.some((session) => session.id === sessionId),
  };
}
