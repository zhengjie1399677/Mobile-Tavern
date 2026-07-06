/**
 * bridgeCore.ts — TavernHelper Bridge 核心状态与生命周期管理
 *
 * 职责：
 * - 类型定义与模块级可变状态（bridgeParams）
 * - 基于 Kernel 消息总线的事件发射器（tavernHelperEventEmitter）
 * - 会话变量初始化、消息 ID 解析等工具函数
 * - MVU 角色卡扩展字段解析
 * - 重型 MVU 框架库（lodash/Vue/Pinia/jQuery/mathjs）的懒加载
 * - Bridge 生命周期：initTavernHelperBridge / cleanTavernHelperBridge / notifyVariablesUpdated
 *
 * 此模块为唯一的状态源，tavernHelperMocks / mvuParser / scriptIframe 单向依赖它，
 * 严禁反向引用，杜绝循环依赖。
 */

import React from "react";
import lodashCloneDeep from "lodash/cloneDeep";
import lodashGet from "lodash/get";
import lodashSet from "lodash/set";
import { CharacterCard, ChatSession, UserSettings } from "../../types";
import { klona } from "klona";
import { globalKernel } from "../../kernel/Kernel";
import { compare } from "compare-versions";
import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";
import type { CardRuntimeBridgeParams } from "./CardRuntimeAdapter";
import { parseMvuMessage } from "./mvuParser";
// 注意：tavernHelperMocks 反向依赖 bridgeCore，此处静态导入会形成 ESM 循环。
// 由于 initTavernHelperMocks 仅在运行时被调用（非模块求值期），
// 且 tavernHelperMocks 已移除顶层 IIFE 副作用，ESM live bindings 可安全处理此循环。
import { initTavernHelperMocks } from "./tavernHelperMocks";

// ──────────────────────────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────────────────────────

/**
 * TavernHelperBridgeParams 已统一至 CardRuntimeAdapter 模块。
 * 此处保留为类型别名以维持向后兼容，新代码请使用 CardRuntimeBridgeParams。
 */
export type TavernHelperBridgeParams = CardRuntimeBridgeParams;

// ──────────────────────────────────────────────────────────────────────────────
// 模块级可变状态（通过 getter/setter 暴露，规避 isolatedModules 对 export let 的限制）
// ──────────────────────────────────────────────────────────────────────────────

let bridgeParams: TavernHelperBridgeParams | null = null;

export function getBridgeParams(): TavernHelperBridgeParams | null {
  return bridgeParams;
}

export function setBridgeParams(params: TavernHelperBridgeParams | null): void {
  bridgeParams = params;
}

// ──────────────────────────────────────────────────────────────────────────────
// 事件发射器（基于 Kernel 消息总线，线程安全）
// ──────────────────────────────────────────────────────────────────────────────

export const tavernHelperEventEmitter = (() => {
  const subscriptions = new Map<string, Array<{ cb: any; unsub: () => void }>>();

  const emitter = {
    on(event: string, cb: any) {
      if (typeof cb !== "function") return emitter;
      if (!subscriptions.has(event)) {
        subscriptions.set(event, []);
      }
      const list = subscriptions.get(event)!;
      // 仅做引用防重：完全相同的 cb 引用不重复注册，但允许不同闭包实例（MVU 框架需要此能力）
      if (list.some((item) => item.cb === cb)) {
        return emitter;
      }
      const unsub = globalKernel.subscribe(`tavern_helper:${event}`, (msg) => {
        try {
          return cb(...msg.payload);
        } catch (e) {
          console.error(`[Event Execution Error in ${event}]:`, e);
        }
      });
      list.push({ cb, unsub });
      return emitter;
    },
    once(event: string, cb: any) {
      const wrapper = (...args: any[]) => {
        emitter.off(event, wrapper);
        return cb(...args);
      };
      return emitter.on(event, wrapper);
    },
    off(event: string, cb: any) {
      const list = subscriptions.get(event);
      if (list) {
        const idx = list.findIndex(item => item.cb === cb);
        if (idx !== -1) {
          list[idx].unsub();
          list.splice(idx, 1);
        }
      }
      return emitter;
    },
    removeListener(event: string, cb: any) {
      return emitter.off(event, cb);
    },
    emit(event: string, ...args: any[]) {
      globalKernel.publish({
        topic: `tavern_helper:${event}`,
        payload: args
      });
      return emitter;
    },
    async emitAndWait(event: string, ...args: any[]) {
      try {
        await globalKernel.publishParallel({
          topic: `tavern_helper:${event}`,
          payload: args
        });
      } catch (e) {
        console.error(`[Event EmitAndWait Error in ${event}]:`, e);
      }
      return [];
    },
    makeFirst(event: string, cb: any) {
      const unsub = globalKernel.subscribe(`tavern_helper:${event}`, (msg) => {
        try {
          return cb(...msg.payload);
        } catch (e) {
          console.error(`[Event Execution Error in ${event}]:`, e);
        }
      }, 100); // 较高优先级在最前面执行
      if (!subscriptions.has(event)) {
        subscriptions.set(event, []);
      }
      subscriptions.get(event)!.push({ cb, unsub });
      return emitter;
    },
    makeLast(event: string, cb: any) {
      const unsub = globalKernel.subscribe(`tavern_helper:${event}`, (msg) => {
        try {
          return cb(...msg.payload);
        } catch (e) {
          console.error(`[Event Execution Error in ${event}]:`, e);
        }
      }, -100); // 较低优先级在最后面执行
      if (!subscriptions.has(event)) {
        subscriptions.set(event, []);
      }
      subscriptions.get(event)!.push({ cb, unsub });
      return emitter;
    },
    clear(event: string) {
      const list = subscriptions.get(event);
      if (list) {
        list.forEach(item => item.unsub());
        subscriptions.delete(event);
      }
    },
    clearAll() {
      for (const ev of Array.from(subscriptions.keys())) {
        emitter.clear(ev);
      }
    }
  };
  return emitter;
})();

// ──────────────────────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────────────────────

/** 为指定会话触发 mag_variable_initialized 事件，并将变量同步到开场白消息 */
export function initializeVariablesForSession(session: any) {
  if (!session) return;
  const variables = session.variables || {};
  if (!variables.stat_data) {
    variables.stat_data = {};
  }

  tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);

  session.variables = variables;

  // 将变量同步到首条消息（开场白）以保持与酒馆格式兼容
  if (session.messages && session.messages.length > 0) {
    const firstMsg = { ...session.messages[0] } as any;
    const swipeId = firstMsg.swipe_id !== undefined ? firstMsg.swipe_id : 0;
    const extra = { ...firstMsg.extra };
    if (!extra.variables) extra.variables = {};
    extra.variables = {
      ...extra.variables,
      [swipeId]: variables,
    };
    firstMsg.extra = extra;
    firstMsg.variables = extra.variables;
    session.messages = [
      firstMsg,
      ...session.messages.slice(1),
    ];
  }

  if (bridgeParams) {
    bridgeParams.setSessions(prev =>
      prev.map(s => s.id === session.id ? { ...s, variables, messages: session.messages } : s)
    );
    bridgeParams.saveSession(session);
  }
}

/** 获取指定消息在指定 swipe_id 下的变量快照 */
export function getSwipeVariables(m: any): Record<string, any> {
  const swipeId = m.swipe_id !== undefined ? m.swipe_id : 0;
  const extraVars = m.extra?.variables;
  if (extraVars) {
    if (extraVars[swipeId] !== undefined) {
      return extraVars[swipeId];
    }
    const keys = Object.keys(extraVars);
    const isNested = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
    if (!isNested) {
      return extraVars;
    }
  }
  return m.variables || {};
}

/** 将逻辑消息 ID（含 'latest' / 负数索引）解析为绝对索引 */
export function resolveMessageId(id: any, messagesLength: number): number {
  if (messagesLength <= 0) return 0;
  const numId = Number(id);
  if (isNaN(numId)) {
    if (id === 'latest') {
      return messagesLength - 1;
    }
    return messagesLength - 1;
  }
  if (numId < 0) {
    return Math.max(0, messagesLength + numId);
  }
  return numId;
}

// ──────────────────────────────────────────────────────────────────────────────
// MVU 角色卡扩展字段解析
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 从角色卡扩展配置中初始化 MVU 变量。
 * 提取角色扩展字段中的 mvu_settings/schema 并合并至会话变量。
 */
export function initializeMvuFromCharacter(character: any): Record<string, any> {
  if (!character) return { stat_data: {} };

  const ext = character.extensions || {};
  const variables: Record<string, any> = {
    stat_data: {},
    schema: { type: 'object', properties: {} },
    display_data: {},
    delta_data: {},
  };

  // 尝试从不同的扩展位置提取 MVU 配置
  const mvuSettings = ext.mvu_settings ||
                      ext.mvu ||
                      ext.MVU ||
                      null;

  if (mvuSettings) {
    // 若配置中包含 schema 则使用它
    if (mvuSettings.schema) {
      variables.schema = mvuSettings.schema;
    }

    // 若配置中包含初始 stat_data / 默认值
    if (mvuSettings.stat_data) {
      variables.stat_data = { ...mvuSettings.stat_data };
    } else if (mvuSettings.defaults) {
      variables.stat_data = { ...mvuSettings.defaults };
    }

    // 复制显示配置（若存在）
    if (mvuSettings.display_data) {
      variables.display_data = { ...mvuSettings.display_data };
    }
  }

  // 确保 stat_data 字段存在
  if (!variables.stat_data) {
    variables.stat_data = {};
  }

  // 额外初始化：从开场白 first_mes 的 <initvar> 标签中提取变量声明
  if (character.first_mes) {
    try {
      const parsedVars = parseMvuMessage(character.first_mes, variables);
      if (parsedVars && parsedVars.stat_data) {
        variables.stat_data = { ...variables.stat_data, ...parsedVars.stat_data };
      }
    } catch (e) {
      console.warn("[initializeMvuFromCharacter] Failed to parse first_mes initvars:", e);
    }
  }

  // 额外初始化：从 Worldbook/Lorebook 的 [initvar] 词条或含有 YAML/JSON 声明的条目中提取初始变量
  const lorebookEntries = character.character_book?.entries || character.extensions?.world?.entries || [];
  if (Array.isArray(lorebookEntries)) {
    for (const entry of lorebookEntries) {
      if (!entry || !entry.content) continue;
      const comment = (entry.comment || "").toLowerCase();
      const content = entry.content;
      if (comment.includes("initvar") || comment.includes("stat_data") || content.includes("<initvar>") || content.includes("stat_data:")) {
        try {
          const parsedVars = parseMvuMessage(content, variables);
          if (parsedVars && parsedVars.stat_data && Object.keys(parsedVars.stat_data).length > 0) {
            variables.stat_data = { ...variables.stat_data, ...parsedVars.stat_data };
          }
        } catch (e) {
          console.warn("[initializeMvuFromCharacter] Failed to parse lorebook initvars:", e);
        }
      }
    }
  }

  console.log("[TavernHelper Bridge] initializeMvuFromCharacter initialized variables:", JSON.stringify(variables));
  return variables;
}

/**
 * 检测角色卡是否包含可执行脚本（tavern_helper 脚本或 MVU 配置）。
 * 用于按需决定是否激活重型 UI 库（Vue / Pinia / jQuery）加载，
 * 纯对话卡无脚本时完全跳过，保持主流程轻量。
 */
export function hasCardScripts(character: CharacterCard | null): boolean {
  if (!character) return false;
  const ext = character.extensions || {};
  // 存在 tavern_helper 脚本列表且非空
  if (Array.isArray(ext.tavern_helper?.scripts) && ext.tavern_helper.scripts.length > 0) return true;
  // 存在 MVU 设定（mvu_settings / mvu / MVU），视为需要脚本运行时
  if (ext.mvu_settings || ext.mvu || ext.MVU) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// 分层懒加载：核心库 vs 重型 UI 库
//
// 加载策略：
//   - 核心库（lodash + 轻量工具）：enableScriptExecution=true 时始终加载
//   - 重型 UI 库（Vue / Pinia / jQuery / mathjs）：仅当角色卡含可执行脚本时加载
//     （由 hasCardScripts() 检测）
//
// 目的：纯对话卡（无 tavern_helper 脚本 / MVU 配置）不应承担 ~400KB 的 UI 框架开销。
// ──────────────────────────────────────────────────────────────────────────────

let coreLibsPromise: Promise<void> | null = null;
let uiLibsPromise: Promise<void> | null = null;

/**
 * 加载核心工具库（lodash + klona 等轻量依赖）。
 * 只要 enableScriptExecution 开启即调用，与卡片是否有脚本无关。
 */
export function ensureCoreLibsLoaded(): Promise<void> {
  if (coreLibsPromise) return coreLibsPromise;

  coreLibsPromise = (async () => {
    console.log("[TavernHelper Bridge] 加载核心工具库（lodash）...");
    const lodash = await import("lodash");
    const lodashInstance = lodash.default || lodash;

    if (typeof window !== "undefined") {
      const w = window as any;
      w._ = lodashInstance;
      // 挂载轻量工具到 TavernHelperMvuLibs（为 UI 库预留槽位）
      w.TavernHelperMvuLibs = {
        ...w.TavernHelperMvuLibs,
        klona,
        compare,
        JSON5,
        jsonrepair,
      };
    }
  })();

  return coreLibsPromise;
}

/**
 * 加载重型 UI 框架库（Vue / Pinia / jQuery / mathjs）。
 * 仅在角色卡包含可执行脚本（hasCardScripts() = true）时调用。
 * 幂等：多次调用等价于一次调用。
 */
export function ensureUiLibsLoaded(): Promise<void> {
  if (uiLibsPromise) return uiLibsPromise;

  uiLibsPromise = (async () => {
    // 确保核心库先就绪
    await ensureCoreLibsLoaded();
    console.log("[TavernHelper Bridge] 角色卡含脚本，加载重型 UI 框架库（Vue / Pinia / jQuery / mathjs）...");
    const [Vue, Pinia, jQuery, math] = await Promise.all([
      import("vue"),
      import("pinia"),
      import("jquery"),
      import("mathjs"),
    ]);

    const jQueryInstance = jQuery.default || jQuery;

    if (typeof window !== "undefined") {
      const w = window as any;
      w.Vue = Vue;
      w.$ = w.jQuery = jQueryInstance;

      w.TavernHelperMvuLibs = {
        ...w.TavernHelperMvuLibs,
        createPinia: Pinia.createPinia,
        defineStore: Pinia.defineStore,
        getActivePinia: Pinia.getActivePinia,
        setActivePinia: Pinia.setActivePinia,
        math,
        pinia: {
          createPinia: Pinia.createPinia,
          defineStore: Pinia.defineStore,
          getActivePinia: Pinia.getActivePinia,
          setActivePinia: Pinia.setActivePinia,
        },
        vue: Vue,
      };
    }
  })();

  return uiLibsPromise;
}

/**
 * 向后兼容入口：等价于同时触发核心库 + UI 库的完整加载。
 * 外部消费者（如 CardRuntimeAdapter）应优先使用细化版本
 * ensureCoreLibsLoaded() / ensureUiLibsLoaded()。
 */
export function ensureLibrariesLoaded(): Promise<void> {
  return ensureUiLibsLoaded();
}

// ──────────────────────────────────────────────────────────────────────────────
// Bridge 生命周期
// ──────────────────────────────────────────────────────────────────────────────

let lastSessionId: string | null = null;

export function initTavernHelperBridge(params: TavernHelperBridgeParams) {
  // 显式触发 window.* 全局 Mock 注册（替代原 tavernHelperMocks 顶层 IIFE）
  // 遵循 AGENTS.md 准则一.4（副作用隔离）
  initTavernHelperMocks();

  if (params.settings?.enableScriptExecution) {
    // 核心库（lodash）：只要开启脚本模式就加载
    ensureCoreLibsLoaded().catch(err => {
      console.error("[TavernHelper Bridge] 核心库加载失败:", err);
    });
    // 重型 UI 库（Vue / Pinia / jQuery / mathjs）：仅当角色卡包含可执行脚本时才加载
    if (hasCardScripts(params.activeCharacter)) {
      ensureUiLibsLoaded().catch(err => {
        console.error("[TavernHelper Bridge] UI 框架库加载失败:", err);
      });
    }
  }

  // 注意：原 registerBridge 调用已上移至应用层（useChatAccessibility.ts），
  // 遵循 AGENTS.md 准则一.1（极致微服务与解耦）：
  // utils 层不应反向调用 kernel.getService("script").registerBridge，
  // 由应用层在调用 initTavernHelperBridge 之后显式装配 bridge 接口。

  const prevSessionId = lastSessionId;
  bridgeParams = params;

  if (params.activeSession) {
    const currentSessionId = params.activeSession.id;
    lastSessionId = currentSessionId;

    if (prevSessionId && prevSessionId !== currentSessionId) {
      setTimeout(() => {
        const session = bridgeParams?.activeSession;
        if (session && session.id === currentSessionId) {
          const variables = session.variables || {};

          // 触发标准酒馆会话变更事件
          tavernHelperEventEmitter.emit('chat_id_changed', currentSessionId);
          tavernHelperEventEmitter.emit('chat_changed', currentSessionId);

          // 触发状态面板变量初始化事件
          tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);

          // 触发消息接收与渲染事件
          const lastMsgId = Math.max(0, (session.messages?.length ?? 1) - 1);
          tavernHelperEventEmitter.emit('message_received', lastMsgId);
          tavernHelperEventEmitter.emit('character_message_rendered', lastMsgId);
        }
      }, 50);
    }
  } else {
    lastSessionId = null;
  }
}

export function cleanTavernHelperBridge() {
  // 清理事件总线：防止切换角色卡/会话时旧脚本注册的事件监听器残留
  tavernHelperEventEmitter.clearAll();
  bridgeParams = null;
  lastSessionId = null;
}

/**
 * 返回 ScriptService 所需的 bridge 接口契约。
 *
 * 遵循 AGENTS.md 准则一.1（极致微服务与解耦）：
 * utils 层不再反向调用 kernel.getService("script").registerBridge，
 * 改由应用层（useChatAccessibility.ts）通过此函数获取接口对象后显式装配。
 *
 * @returns ITavernHelperBridge 契约对象
 */
export function getBridgeInterface() {
  return {
    initializeMvuFromCharacter,
    parseMvuMessage,
    notifyVariablesUpdated,
  };
}

/**
 * 保存包含更新变量的会话后调用（如 AI 回复 + MVU 命令解析后）。
 * 发射 mag_variable_initialized 与渲染事件，通知沙盒 iframe 刷新 UI。
 */
export function notifyVariablesUpdated(session: ChatSession, messageId?: number) {
  if (!session) return;
  const variables = session.variables || {};
  // 通知 MVU bundle 变量已更新/初始化
  tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);
  // 2. 发射 message_received 与 character_message_rendered 事件，确保每轮 AI 回复触发 UI 刷新
  const lastMsgId = messageId ?? Math.max(0, (session.messages?.length ?? 1) - 1);
  tavernHelperEventEmitter.emit('message_received', lastMsgId);
  tavernHelperEventEmitter.emit('character_message_rendered', lastMsgId);
}
