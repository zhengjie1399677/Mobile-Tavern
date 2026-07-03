/**
 * CardRuntimeAdapter.ts — 卡片运行时适配器接口契约
 *
 * 设计意图：
 *   将"卡片脚本执行能力"从底层硬编码中抽离为稳定的接口（Adapter Pattern）。
 *   当前由 tavernHelper Bridge 作为唯一的默认实现（SillyTavernAdapter），
 *   未来引入新的卡片格式（自研格式、游戏插件、非 SillyTavern 生态）时，
 *   只需新增一个实现此接口的 Adapter，无需改动 Kernel 或核心聊天流程。
 *
 * 使用边界：
 *   - 上层消费者（如 useChat、Kernel 中间件）通过此接口与卡片运行时通信
 *   - 具体实现细节（SillyTavern 全局 Mock、iframe 沙盒、CDN 替换等）
 *     完全封装在各自的 Adapter 实现内部，对外不可见
 *
 * 遵循 AGENTS.md 准则一.1：向微内核沙盒架构预留平滑抽离通道。
 */

import { CharacterCard, ChatSession, UserSettings } from "../../types";
import React from "react";

// ──────────────────────────────────────────────────────────────────────────────
// 生命周期参数（各 Adapter 初始化时所需的 React 上下文引用）
// ──────────────────────────────────────────────────────────────────────────────

export interface CardRuntimeBridgeParams {
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  saveSession: (session: ChatSession) => Promise<void>;
  setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>;
  saveCharacter: (character: CharacterCard) => Promise<void>;
  settings: UserSettings;
  updateSettings: (settings: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  handleSendMessage: (text: string) => Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// 卡片运行时适配器接口
// ──────────────────────────────────────────────────────────────────────────────

export interface ICardRuntimeAdapter {
  /**
   * 适配器唯一标识（用于调试与多适配器并存时的区分）
   * 例如："sillytavern-mvu" | "mobile-tavern-native"
   */
  readonly id: string;

  /**
   * 检测指定角色卡是否包含可执行脚本。
   * 用于决定是否激活重型库加载（jQuery / Vue / Pinia 等）。
   * 返回 false 则完全跳过脚本初始化，保持主流程轻量。
   */
  hasRunnableScripts(character: CharacterCard | null): boolean;

  /**
   * 初始化/更新 Bridge 状态（React 上下文发生变化时调用）。
   * 对应原 initTavernHelperBridge。
   */
  init(params: CardRuntimeBridgeParams): void;

  /**
   * 清理 Bridge 状态（组件卸载或切换角色卡时调用）。
   * 对应原 cleanTavernHelperBridge。
   */
  destroy(): void;

  /**
   * 按需预加载重型框架依赖（lodash / Vue / Pinia / jQuery / mathjs 等）。
   * 仅在 hasRunnableScripts() 为 true 时调用。
   * 幂等：多次调用等价于一次调用。
   */
  preloadLibraries(): Promise<void>;

  /**
   * 从角色卡扩展字段中初始化 MVU/脚本变量。
   * 返回初始变量快照（stat_data / schema / display_data）。
   */
  initVariablesFromCharacter(character: CharacterCard | null): Record<string, any>;

  /**
   * 解析 AI 回复文本中的变量更新指令，返回更新后的变量快照（深拷贝）。
   * 对应原 parseMvuMessage。
   */
  parseMessage(messageContent: string, currentVariables: Record<string, any>): Record<string, any>;

  /**
   * 保存变量后通知沙盒 iframe 刷新 UI。
   * 对应原 notifyVariablesUpdated。
   */
  notifyVariablesUpdated(session: ChatSession, messageId?: number): void;
}
