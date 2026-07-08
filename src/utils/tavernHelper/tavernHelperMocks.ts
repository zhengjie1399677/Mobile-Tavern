/**
 * tavernHelperMocks.ts — Window 全局 Mock 对象与 TavernHelper 桥接绑定
 *
 * 职责：
 * - 注册 SillyTavern 兼容的全局事件类型映射（window.tavern_events）
 * - 轻量 jQuery / YAML / toastr / showdown / scriptButtons Mock
 * - Zod Mock Proxy 注册（window.z）
 * - 核心绑定对象 bindObj（_getVariables / _replaceVariables / _setChatMessage 等）
 * - TavernHelper 全局对象（SillyTavern 插件系统的主入口 Mock）
 * - SillyTavern 全局命名空间 Mock（含 getContext()）
 * - Mvu 全局框架 Mock（Model-View-Update 变量框架）
 *
 * 初始化方式：通过显式调用 initTavernHelperMocks() 注册所有 window.* 全局 Mock，
 * 由 initTavernHelperBridge() 在初始化时触发。
 * 遵循 AGENTS.md 准则一.4（副作用隔离）：不再通过顶层 IIFE 隐式执行。
 *
 * 依赖关系（单向）：
 *   tavernHelperMocks → bridgeCore
 *   tavernHelperMocks → zodMock
 *   tavernHelperMocks → mvuParser
 */

import lodashCloneDeep from "lodash/cloneDeep";
import lodashGet from "lodash/get";
import lodashSet from "lodash/set";
import lodashIsEqual from "lodash/isEqual";
import { registerMvuSchema } from "../mvu_zod";
import {
  getBridgeParams,
  tavernHelperEventEmitter,
  initializeVariablesForSession,
  initializeMvuFromCharacter,
  getSwipeVariables,
  resolveMessageId,
  notifyVariablesUpdated,
} from "./bridgeCore";
import { createZodProxy } from "./zodMock";
import { parseMvuMessage } from "./mvuParser";

// ──────────────────────────────────────────────────────────────────────────────
// 显式初始化函数：注册所有 window.* 全局 Mock
// 由 initTavernHelperBridge() 在初始化时触发，遵循 AGENTS.md 准则一.4（副作用隔离）
// ──────────────────────────────────────────────────────────────────────────────
let _mocksInitialized = false;

export function initTavernHelperMocks(): void {
  if (_mocksInitialized || typeof window === "undefined") return;
  _mocksInitialized = true;
  const parentWin = window as any;

  parentWin.registerMvuSchema = registerMvuSchema;

  // 1b. Mock SillyTavern global eventTypes mapping
  parentWin.tavern_events = parentWin.tavern_events || {
    APP_READY: 'app_ready',
    EXTRAS_CONNECTED: 'extras_connected',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
    MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
    MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    IMPERSONATE_READY: 'impersonate_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SD_PROMPT_PROCESSING: 'sd_prompt_processing',
    EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    MOVABLE_PANELS_RESET: 'movable_panels_reset',
    SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
    SETTINGS_LOADED_AFTER: 'settings_loaded_after',
    CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
    CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
    OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
    OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
    OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
    OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    CHARACTER_EDITOR_OPENED: 'character_editor_opened',
    CHARACTER_EDITED: 'character_edited',
    CHARACTER_PAGE_LOADED: 'character_page_loaded',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    FORCE_SET_BACKGROUND: 'force_set_background',
    CHAT_DELETED: 'chat_deleted',
    CHAT_CREATED: 'chat_created',
    GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
    GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    GENERATE_AFTER_DATA: 'generate_after_data',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
    CHARACTER_DELETED: 'characterDeleted',
    CHARACTER_DUPLICATED: 'character_duplicated',
    CHARACTER_RENAMED: 'character_renamed',
    CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
    SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_REASONING_DONE: 'stream_reasoning_done',
    FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
    WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
    OPEN_CHARACTER_LIBRARY: 'open_character_library',
    ONLINE_STATUS_CHANGED: 'online_status_changed',
    IMAGE_SWIPED: 'image_swiped',
    CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
    CONNECTION_PROFILE_CREATED: 'connection_profile_created',
    CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
    CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
    TOOL_CALLS_PERFORMED: 'tool_calls_performed',
    TOOL_CALLS_RENDERED: 'tool_calls_rendered',
    CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
    SECRET_WRITTEN: 'secret_written',
    SECRET_DELETED: 'secret_deleted',
    SECRET_ROTATED: 'secret_rotated',
    SECRET_EDITED: 'secret_edited',
    PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted',
    PRESET_RENAMED: 'preset_renamed',
    PRESET_RENAMED_BEFORE: 'preset_renamed_before',
    MAIN_API_CHANGED: 'main_api_changed',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
    MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
  };

  // 2. Mock parent jQuery $
  parentWin.$ = parentWin.jQuery = parentWin.$ || ((el: any) => {
    if (typeof el === 'function') {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(el, 1);
      } else {
        document.addEventListener('DOMContentLoaded', el);
      }
      return { on: () => {} };
    }
    return {
      on: (event: string, cb: any) => {
        if (el === window || el === parentWin) {
          parentWin.addEventListener(event, cb);
        }
      }
    };
  });

  // 3. Enhanced YAML parser (lightweight inline implementation without external dependency)
  parentWin.YAML = parentWin.YAML || {
    parse: (str: string) => {
      if (!str || typeof str !== 'string') return {};
      const trimmed = str.trim();
      try { return JSON.parse(trimmed); } catch {}
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try { return JSON.parse(trimmed.replace(/'/g, '"')); } catch {}
      }
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try { return JSON.parse(trimmed.replace(/'/g, '"').replace(/(\w+):/g, '"$1":')); } catch {}
      }
      const result: Record<string, any> = {};
      const lines = trimmed.split('\n');
      let hasParsed = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const colonIdx = t.indexOf(':');
        if (colonIdx > 0) {
          const key = t.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
          let val: any = t.slice(colonIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          } else if (val === 'true') { val = true; }
          else if (val === 'false') { val = false; }
          else if (val === 'null' || val === '~') { val = null; }
          else if (/^-?\d+(\.\d+)?$/.test(val)) { val = Number(val); }
          else if (val === '') { val = null; }
          result[key] = val;
          hasParsed = true;
        }
      }
      return hasParsed ? result : {};
    },
    stringify: (obj: any) => JSON.stringify(obj),
  };

  // 4. Mock Zod schema validator
  parentWin.z = createZodProxy();

  // 5. Mock Toast notifications
  parentWin.toastr = parentWin.toastr || {
    info: (msg: string) => console.log("[Toast Info]", msg),
    warning: (msg: string) => console.log("[Toast Warning]", msg),
    success: (msg: string) => console.log("[Toast Success]", msg),
    error: (msg: string) => console.log("[Toast Error]", msg),
  };

  // 6. Mock showdown markdown converter
  parentWin.showdown = parentWin.showdown || {
    Converter: function () {
      return { makeHtml: (text: string) => text };
    },
  };

  // 6b. Mock script buttons related functions for MVU extension compatibility
  parentWin.appendInexistentScriptButtons = parentWin.appendInexistentScriptButtons || (() => {});
  parentWin.getScriptButtons = parentWin.getScriptButtons || (() => []);
  parentWin.replaceScriptButtons = parentWin.replaceScriptButtons || (() => {});
  parentWin.getButtonEvent = parentWin.getButtonEvent || ((name: string) => name);

  // ──────────────────────────────────────────────────────────────────────────
  // 7. 核心绑定对象 bindObj：TavernHelper._bind 的全部方法实现
  // ──────────────────────────────────────────────────────────────────────────
  const bindObj = {
    _eventOn(event: string, cb: any) { tavernHelperEventEmitter.on(event, cb); },
    _eventOnButton: () => {},
    _eventMakeLast: () => {},
    _eventMakeFirst: () => {},
    _eventOnce(event: string, cb: any) {
      const wrapper = (...args: any[]) => {
        tavernHelperEventEmitter.off(event, wrapper);
        cb(...args);
      };
      tavernHelperEventEmitter.on(event, wrapper);
    },
    _eventEmit(event: string, ...args: any[]) { tavernHelperEventEmitter.emit(event, ...args); },
    _eventEmitAndWait(event: string, ...args: any[]) { return tavernHelperEventEmitter.emitAndWait(event, ...args); },
    _eventRemoveListener(event: string, cb: any) { tavernHelperEventEmitter.off(event, cb); },
    _eventClearEvent(event: string) { tavernHelperEventEmitter.clear(event); },
    _eventClearListener(event: string) { tavernHelperEventEmitter.clear(event); },
    _eventClearAll() { tavernHelperEventEmitter.clearAll(); },
    _initializeGlobal: () => {},
    _waitGlobalInitialized: () => Promise.resolve(),
    _registerMacroLike: () => {},
    _reloadIframe: () => {},
    _onIframeReady(iframeId: string) {
      // 防暴去重：一个 iframe 已经响应就绪后，无需重复执行 100ms 后的变量初始化通知，防止反噬死循环
      if ((window as any).__readyIframeSet?.has(iframeId)) {
        return;
      }
      if (!(window as any).__readyIframeSet) {
        (window as any).__readyIframeSet = new Set<string>();
      }
      (window as any).__readyIframeSet.add(iframeId);

      console.log(`[TavernHelper Bridge] Iframe ${iframeId} is ready.`);
      try {
        const iframe = document.getElementById(iframeId) as HTMLIFrameElement;
        if (iframe) {
          iframe.style.backgroundColor = "transparent";
          iframe.style.background = "transparent";
          iframe.setAttribute("allowtransparency", "true");
          
          const applyTransparency = () => {
            try {
              if (iframe.contentDocument) {
                const doc = iframe.contentDocument;
                if (doc.body) {
                  doc.body.style.backgroundColor = "transparent";
                  doc.body.style.background = "transparent";
                  doc.body.style.setProperty("background", "transparent", "important");
                  doc.body.style.setProperty("background-color", "transparent", "important");
                }
                if (doc.documentElement) {
                  doc.documentElement.style.backgroundColor = "transparent";
                  doc.documentElement.style.background = "transparent";
                  doc.documentElement.style.setProperty("background", "transparent", "important");
                  doc.documentElement.style.setProperty("background-color", "transparent", "important");
                }
              }
            } catch (innerErr) {
              console.warn("[TavernHelper Bridge] Failed to apply inner transparency style:", innerErr);
            }
          };

          applyTransparency();
          iframe.addEventListener("load", applyTransparency);
        }
      } catch (e) {
        console.warn("[TavernHelper Bridge] Failed to force transparency on iframe DOM:", e);
      }
      setTimeout(() => {
        const params = getBridgeParams();
        if (params && params.activeSession) {
          const session = params.activeSession;
          // 自愈逻辑：若会话变量由于加载竞态为空，自动在首次就绪时从角色卡配置中抽取初始化
          const isEmpty = !session.variables || !session.variables.stat_data || Object.keys(session.variables.stat_data).length === 0;
          if (isEmpty && params.activeCharacter) {
            const mvuVars = initializeMvuFromCharacter(params.activeCharacter);
            if (mvuVars && mvuVars.stat_data) {
              session.variables = mvuVars;
              console.log("[TavernHelper Bridge] Auto-repaired empty session variables from character card.");
            }
          }
          // 【修复】：不管变量先前是否为空，在任何 iframe/状态栏就绪时都必须向下游广播初始化变量，
          // 否则新挂载的 iframe 会因未收到 mag_variable_initialized 广播而呈现 '--' 空白状态。
          initializeVariablesForSession(session);

          // 同步触发消息渲染，以唤醒状态面板更新在场角色及服装状态
          const lastMsgId = Math.max(0, (session.messages?.length ?? 1) - 1);
          tavernHelperEventEmitter.emit('message_received', lastMsgId);
          tavernHelperEventEmitter.emit('character_message_rendered', lastMsgId);
        }
      }, 100);
    },
    _errorCatched(fn: any) {
      if (typeof fn === "function") {
        return function(this: any, ...args: any[]) {
          try {
            return fn.apply(this, args);
          } catch (err) {
            // 【修复差异3】与 SillyTavern 原生行为一致：静默吞掉错误，仅做日志输出
            // 原先 throw err 会在 zod 解析警告时中断整个变量初始化链条
            console.warn("[TavernHelper Bridge] Error caught inside errorCatched (silenced):", err);
            return undefined;
          }
        };
      }
      return fn;
    },

    _getIframeName: () => "TH-message-iframe",
    _getScriptId: () => "script_default",
    _getCurrentMessageId(callerMsgId?: number) {
      if (callerMsgId !== undefined && !isNaN(Number(callerMsgId))) return Number(callerMsgId);
      return (getBridgeParams()?.activeSession?.messages?.length || 1) - 1;
    },
    _getVariables(opt: any = { type: "chat" }) {
      // console.log("[TavernHelper Bridge] _getVariables called with:", JSON.stringify(opt));
      const params = getBridgeParams();
      if (!params) return {};
      const { activeCharacter, settings, activeSession } = params;
      if (opt.type === "character") return activeCharacter?.variables || {};
      if (opt.type === "global") return settings?.variables || {};
      if (opt.type === "message" && opt.message_id !== undefined) {
        const messages = activeSession?.messages || [];
        const msgId = resolveMessageId(opt.message_id, messages.length);
        
        // 如果是最新的一条消息，直接返回当前会话的全局最新变量，以保持多轮对话间的最新状态一致
        if (msgId === messages.length - 1 && activeSession?.variables) {
          const resolvedVars = lodashCloneDeep(activeSession.variables);
          if (!resolvedVars.stat_data) resolvedVars.stat_data = {};
          return resolvedVars;
        }

        const msg = messages[msgId] as any;
        if (msg) {
          const swipeId = opt.swipe_id !== undefined ? opt.swipe_id : (msg.swipe_id !== undefined ? msg.swipe_id : 0);
          
          // 【修复 X3】从当前消息开始往前扫描，寻找最近的一个包含有效变量的消息。
          // 原先要求 stat_data 非空才算有效，但初始化时可能 stat_data 为 {}（由静态提取失败导致），
          // 改为：只要 extra.variables[swipeId] 存在（即使 stat_data 是空对象）就视为有效记录，
          // 由 zod schema.parse() 负责补齐默认值。
          for (let i = msgId; i >= 0; i--) {
            const m = messages[i] as any;
            if (!m) continue;
            const currentSwipeId = (i === msgId && opt.swipe_id !== undefined)
              ? opt.swipe_id
              : (m.swipe_id !== undefined ? m.swipe_id : 0);
            const vars = m.extra?.variables?.[currentSwipeId];
            if (vars && typeof vars === 'object') {
              const resolvedVars = lodashCloneDeep(vars);
              return resolvedVars;
            }
          }
          
          // 兜底：如果往前扫描没找到任何包含有效变量的历史消息，使用当前会话变量作为兜底
          if (activeSession?.variables) {
            const resolvedVars = lodashCloneDeep(activeSession.variables);
            if (!resolvedVars.stat_data) resolvedVars.stat_data = {};
            return resolvedVars;
          }
          return { stat_data: {} };
        }
        return {};
      }
      return activeSession?.variables || {};
    },
    _getAllVariables() {
      const params = getBridgeParams();
      if (!params) {
        console.log("[TavernHelper Bridge] _getAllVariables: no bridge params");
        return {};
      }
      const { activeCharacter, settings, activeSession } = params;
      const res = { ...(settings?.variables || {}), ...(activeCharacter?.variables || {}), ...(activeSession?.variables || {}) };
      // console.log("[TavernHelper Bridge] _getAllVariables returned:", JSON.stringify(res));
      return res;
    },
    _replaceVariables(variables: Record<string, any>, opt: any = { type: "chat" }) {
      // console.log("[TavernHelper Bridge] _replaceVariables called with opt:", JSON.stringify(opt));
      const params = getBridgeParams();
      if (!params) return;
      const { activeCharacter, settings, activeSession, setCharacters, saveCharacter, updateSettings, setSessions, saveSession } = params;
      if (opt.type === "character" && activeCharacter) {
        setCharacters((prev) => {
          let updatedChar: any = null;
          let changed = false;
          const next = prev.map((c) => {
            if (c.id === activeCharacter.id) {
              if (lodashIsEqual(c.variables, variables)) {
                return c;
              }
              changed = true;
              updatedChar = { ...c, variables };
              return updatedChar;
            }
            return c;
          });
          if (!changed) return prev;
          if (updatedChar) { setTimeout(() => { saveCharacter(updatedChar); }, 0); }
          return next;
        });
      } else if (opt.type === "global") {
        updateSettings((prev: any) => {
          if (lodashIsEqual(prev?.variables, variables)) return prev;
          return { ...prev, variables };
        });
      } else if (opt.type === "message" && opt.message_id !== undefined && activeSession) {
        setSessions((prev) => {
          const activeS = prev.find(s => s.id === activeSession.id);
          if (!activeS) return prev;
          const targetMsgId = resolveMessageId(opt.message_id, activeS.messages.length);
          let sessionVarsUpdated = false;
          let messageVarsChanged = false;
          const updatedMessages = activeS.messages.map((m, idx) => {
            if (idx === targetMsgId) {
              const msg = m as any;
              const swipeId = opt.swipe_id !== undefined ? opt.swipe_id : (msg.swipe_id !== undefined ? msg.swipe_id : 0);
              const existingSwipeVars = msg.extra?.variables?.[swipeId];
              if (lodashIsEqual(existingSwipeVars, variables)) {
                return m;
              }
              messageVarsChanged = true;
              const extra = { ...msg.extra };
              if (!extra.variables) extra.variables = {};
              extra.variables = { ...extra.variables, [swipeId]: variables };
              if (idx === activeS.messages.length - 1) { sessionVarsUpdated = true; }
              return { ...m, extra };
            }
            return m;
          });
          if (!messageVarsChanged) return prev;
          const updatedSession = { ...activeS, messages: updatedMessages, variables: sessionVarsUpdated ? variables : activeS.variables };
          setTimeout(() => { saveSession(updatedSession); notifyVariablesUpdated(updatedSession); }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        });
      } else if (activeSession) {
        setSessions((prev) => {
          const activeS = prev.find(s => s.id === activeSession.id);
          if (!activeS) return prev;
          if (lodashIsEqual(activeS.variables, variables)) {
            return prev;
          }
          
          // 同时将全局变量更新同步到最新一条消息的 extra.variables 中，以保持历史及新轮次快照一致性
          let updatedMessages = activeS.messages;
          if (updatedMessages.length > 0) {
            const lastIdx = updatedMessages.length - 1;
            const lastMsg = { ...updatedMessages[lastIdx] } as any;
            const swipeId = lastMsg.swipe_id !== undefined ? lastMsg.swipe_id : 0;
            const extra = { ...lastMsg.extra };
            if (!extra.variables) extra.variables = {};
            extra.variables = { ...extra.variables, [swipeId]: variables };
            lastMsg.extra = extra;
            lastMsg.variables = extra.variables;
            updatedMessages = [
              ...updatedMessages.slice(0, -1),
              lastMsg
            ];
          }

          const updated = { ...activeS, variables, messages: updatedMessages };
          setTimeout(() => { saveSession(updated); notifyVariablesUpdated(updated); }, 0);
          return prev.map((s) => (s.id === updated.id ? updated : s));
        });
      }
    },
    _updateVariablesWith(updater: any, opt = { type: "chat" }) {
      const vars = bindObj._getVariables(opt);
      const nextVars = updater(vars);
      bindObj._replaceVariables(nextVars, opt);
      return nextVars;
    },
    _insertOrAssignVariables(variables: Record<string, any>, opt = { type: "chat" }) {
      return bindObj._updateVariablesWith((old: any) => ({ ...old, ...variables }), opt);
    },
    _insertVariables(variables: Record<string, any>, opt = { type: "chat" }) {
      return bindObj._updateVariablesWith((old: any) => ({ ...variables, ...old }), opt);
    },
    _deleteVariable(path: string, opt = { type: "chat" }) {
      const vars = bindObj._getVariables(opt);
      delete vars[path];
      bindObj._replaceVariables(vars, opt);
      return { variables: vars, delete_occurred: true };
    },
    _setChatMessage(id: number, messageObj: any) {
      console.log(`[TavernHelper Bridge] _setChatMessage called for id: ${id}`, messageObj);
      const params = getBridgeParams();
      if (!params || !params.activeSession) return;
      const { activeSession, setSessions, saveSession } = params;
      setSessions((prev) => {
        const activeS = prev.find(s => s.id === activeSession.id);
        if (!activeS) return prev;
        let changed = false;
        const targetMsgId = resolveMessageId(id, activeS.messages.length);
        let sessionVarsUpdated = false;
        let newSessionVars = { ...activeS.variables };
        const updatedMessages = activeS.messages.map((m, idx) => {
          if (idx === targetMsgId) {
            let updatedMsg = { ...m };
            let textChanged = false;
            let targetContent = updatedMsg.content;
            if (typeof messageObj === "string") { targetContent = messageObj; textChanged = true; }
            else if (messageObj && typeof messageObj === "object") {
              const possibleContent = messageObj.mes !== undefined ? messageObj.mes : (messageObj.content !== undefined ? messageObj.content : (messageObj.message !== undefined ? messageObj.message : undefined));
              if (possibleContent !== undefined) { targetContent = possibleContent; textChanged = true; }
            }
            if (textChanged && updatedMsg.content !== targetContent) { updatedMsg.content = targetContent; changed = true; }
            if (messageObj && typeof messageObj === "object") {
              if (messageObj.swipe_id !== undefined && (updatedMsg as any).swipe_id !== messageObj.swipe_id) { (updatedMsg as any).swipe_id = messageObj.swipe_id; changed = true; }
              if (messageObj.swipes !== undefined && !lodashIsEqual((updatedMsg as any).swipes, messageObj.swipes)) { (updatedMsg as any).swipes = messageObj.swipes; changed = true; }
              if (messageObj.swipes_data !== undefined && !lodashIsEqual((updatedMsg as any).swipes_data, messageObj.swipes_data)) { (updatedMsg as any).swipes_data = messageObj.swipes_data; changed = true; }
              if (messageObj.extra !== undefined && !lodashIsEqual((updatedMsg as any).extra, messageObj.extra)) { (updatedMsg as any).extra = { ...(updatedMsg as any).extra, ...messageObj.extra }; changed = true; }
              if (messageObj.variables !== undefined) {
                if (!(updatedMsg as any).extra) (updatedMsg as any).extra = {};
                if (!(updatedMsg as any).extra.variables) (updatedMsg as any).extra.variables = {};
                const keys = Object.keys(messageObj.variables);
                const isNested = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
                if (isNested) {
                  (updatedMsg as any).extra.variables = { ...(updatedMsg as any).extra.variables, ...messageObj.variables };
                } else {
                  const swipeId = (updatedMsg as any).swipe_id !== undefined ? (updatedMsg as any).swipe_id : 0;
                  const existingSwipeVars = (updatedMsg as any).extra.variables[swipeId] || {};
                  (updatedMsg as any).extra.variables = { ...(updatedMsg as any).extra.variables, [swipeId]: { ...existingSwipeVars, ...messageObj.variables } };
                }
                changed = true;
              }
            }
            if (idx === activeS.messages.length - 1) {
              const swipeId = (updatedMsg as any).swipe_id !== undefined ? (updatedMsg as any).swipe_id : 0;
              newSessionVars = (updatedMsg as any).extra?.variables?.[swipeId] || {};
              sessionVarsUpdated = true;
            }
            return updatedMsg;
          }
          return m;
        });
        if (changed || sessionVarsUpdated) {
          const updatedSession = { ...activeS, messages: updatedMessages, variables: sessionVarsUpdated ? newSessionVars : activeS.variables };
          setTimeout(() => { saveSession(updatedSession); notifyVariablesUpdated(updatedSession); }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        }
        return prev;
      });
    },
    _setChatMessages(messagesList: any[]) {
      console.log("[TavernHelper Bridge] _setChatMessages called with:", JSON.stringify(messagesList, null, 2));
      const params = getBridgeParams();
      if (!params || !params.activeSession) return;
      const { activeSession, setSessions, saveSession, activeCharacter } = params;
      if (!Array.isArray(messagesList)) return;
      setSessions((prev) => {
        const activeS = prev.find(s => s.id === activeSession.id);
        if (!activeS) return prev;
        let changed = false;
        let sessionVarsUpdated = false;
        let newSessionVars = { ...activeS.variables };
        const updatedMessages = activeS.messages.map((m, idx) => {
          const newMsg = messagesList[idx] as any;
          if (newMsg) {
            let updated = { ...m };
            let localChanged = false;
            const content = typeof newMsg === "string" ? newMsg : (newMsg.mes !== undefined ? newMsg.mes : (newMsg.content !== undefined ? newMsg.content : (newMsg.message !== undefined ? newMsg.message : undefined)));
            console.log(`[TavernHelper Bridge] msg ${idx} content resolution: newMsgContent:`, content, "existingContent:", updated.content);
            if (content !== undefined && updated.content !== content) { updated.content = content; localChanged = true; }
            if (typeof newMsg === "object") {
              if (newMsg.swipe_id !== undefined && (updated as any).swipe_id !== newMsg.swipe_id) {
                (updated as any).swipe_id = newMsg.swipe_id; localChanged = true;
                let swipeContent: string | undefined = undefined;
                if (idx === 0 && activeCharacter) {
                  const allGreetings = [activeCharacter.first_mes, ...(activeCharacter.alternate_greetings || [])];
                  if (allGreetings[newMsg.swipe_id] !== undefined) swipeContent = allGreetings[newMsg.swipe_id];
                } else if (updated.swipes && updated.swipes[newMsg.swipe_id] !== undefined) {
                  swipeContent = updated.swipes[newMsg.swipe_id];
                }
                if (swipeContent !== undefined && updated.content !== swipeContent) updated.content = swipeContent;
              }
              if (newMsg.swipes !== undefined && !lodashIsEqual((updated as any).swipes, newMsg.swipes)) { (updated as any).swipes = newMsg.swipes; localChanged = true; }
              if (newMsg.swipes_data !== undefined && !lodashIsEqual((updated as any).swipes_data, newMsg.swipes_data)) { (updated as any).swipes_data = newMsg.swipes_data; localChanged = true; }
              if (newMsg.extra !== undefined && !lodashIsEqual((updated as any).extra, newMsg.extra)) { (updated as any).extra = { ...(updated as any).extra, ...newMsg.extra }; localChanged = true; }
              if (newMsg.variables !== undefined) {
                if (!(updated as any).extra) (updated as any).extra = {};
                if (!(updated as any).extra.variables) (updated as any).extra.variables = {};
                const keys = Object.keys(newMsg.variables);
                const isNested = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
                if (isNested) {
                  (updated as any).extra.variables = { ...(updated as any).extra.variables, ...newMsg.variables };
                } else {
                  const swipeId = (updated as any).swipe_id !== undefined ? (updated as any).swipe_id : 0;
                  const existingSwipeVars = (updated as any).extra.variables[swipeId] || {};
                  (updated as any).extra.variables = { ...(updated as any).extra.variables, [swipeId]: { ...existingSwipeVars, ...newMsg.variables } };
                }
                localChanged = true;
              }
            }
            if (localChanged) {
              changed = true;
              if (idx === activeS.messages.length - 1) {
                const swipeId = (updated as any).swipe_id !== undefined ? (updated as any).swipe_id : 0;
                newSessionVars = (updated as any).extra?.variables?.[swipeId] || {};
                sessionVarsUpdated = true;
              }
              return updated;
            }
          }
          return m;
        });
        console.log("[TavernHelper Bridge] _setChatMessages execution status: changed =", changed);
        if (changed) {
          const updatedSession = { ...activeS, messages: updatedMessages, variables: sessionVarsUpdated ? newSessionVars : activeS.variables };
          setTimeout(() => { saveSession(updatedSession); notifyVariablesUpdated(updatedSession); }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        }
        return prev;
      });
    },
    _getChatMessages() {
      const params = getBridgeParams();
      if (!params) return [];
      const { activeSession, activeCharacter, settings } = params;
      return (activeSession?.messages || []).map((m, idx) => {
        const msgObj: any = {
          id: idx, name: m.sender === "user" ? settings.userName : (activeCharacter?.name || "AI"),
          mes: m.content, message: m.content, role: m.sender, send_date: m.timestamp,
          is_user: m.sender === "user", is_system: m.sender === "system",
          swipe_id: (m as any).swipe_id !== undefined ? (m as any).swipe_id : 0,
          swipes: (m as any).swipes || [m.content], extra: (m as any).extra || {},
          variables: getSwipeVariables(m),
        };
        if (idx === 0 && activeCharacter) {
          const allGreetings = [activeCharacter.first_mes, ...(activeCharacter.alternate_greetings || [])];
          msgObj.swipes = allGreetings;
          const currentIdx = allGreetings.indexOf(m.content);
          msgObj.swipe_id = (m as any).swipe_id !== undefined ? (m as any).swipe_id : (currentIdx !== -1 ? currentIdx : 0);
        }
        return msgObj;
      });
    },
    _getLastMessageId() { return (getBridgeParams()?.activeSession?.messages?.length || 1) - 1; },
    _getCurrentChatId() { return getBridgeParams()?.activeSession?.id || "default_chat"; },
    _getTavernHelperVersion() { return "3.5.0"; },
    _saveChat() { return Promise.resolve(); },
    _saveSettingsDebounced() {
      const params = getBridgeParams();
      if (params && params.settings) {
        params.updateSettings({ ...params.settings, extensionSettings: params.settings.extensionSettings || {} });
      }
      return Promise.resolve();
    },
    _getCharLorebooks() { return []; },
    _getCharWorldbookNames() { return []; },
    _getCurrentCharPrimaryLorebook() { return null; },
    _getLorebookEntries() { return []; },
    _getLorebookSettings() { return {}; },
    _setLorebookSettings() {},
    _setExtraAnalysisStates() {},
    _normalizeBaseURL(url: string) { return url; },
    _generate() { return Promise.resolve(""); },
    _generateRaw() { return Promise.resolve(""); },
    _isToolCallingSupported() { return false; },
    _registerFunctionTool() {},
    _unregisterFunctionTool() {},
    _fetch(url: string, init: any) { return fetch(url, init); },
  };

  // ──────────────────────────────────────────────────────────────────────────
  // sharedWriteExtensionField 辅助函数
  // ──────────────────────────────────────────────────────────────────────────
  function sharedWriteExtensionField(arg1: string, arg2: any, arg3?: any) {
    const params = getBridgeParams();
    if (!params) return;
    const settings = { ...params.settings };
    if (!settings.extensionSettings) { settings.extensionSettings = {}; }
    let extName = 'mvu';
    let fieldName = '';
    let value: any;
    if (arg3 !== undefined) { extName = arg1; fieldName = arg2; value = arg3; }
    else { fieldName = arg1; value = arg2; }
    if (!settings.extensionSettings[extName]) { settings.extensionSettings[extName] = {}; }
    settings.extensionSettings[extName][fieldName] = value;
    if (arg3 === undefined) { settings.extensionSettings[fieldName] = value; }
    console.log(`[writeExtensionField] Saved setting under ${extName}.${fieldName}:`, value);
    params.updateSettings(settings);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. TavernHelper 全局对象
  // ──────────────────────────────────────────────────────────────────────────
  parentWin.TavernHelper = parentWin.TavernHelper || {
    _th_impl: { _init: () => {}, _log: (...args: any[]) => console.log("[Iframe Log]", ...args), _clearLog: () => {}, writeExtensionField: sharedWriteExtensionField },
    _bind: bindObj,
    _onIframeReady(iframeId: string) { if (bindObj && typeof bindObj._onIframeReady === "function") { bindObj._onIframeReady(iframeId); } },
    getVariables(option = { type: "chat" }) { return this._bind._getVariables(option); },
    replaceVariables(variables: Record<string, any>, option = { type: "chat" }) { this._bind._replaceVariables(variables, option); },
    updateVariablesWith(updater: any, option = { type: "chat" }) { return this._bind._updateVariablesWith(updater, option); },
    insertOrAssignVariables(variables: Record<string, any>, option = { type: "chat" }) { return this._bind._insertOrAssignVariables(variables, option); },
    insertVariables(variables: Record<string, any>, option = { type: "chat" }) { return this._bind._insertVariables(variables, option); },
    deleteVariable(path: string, option = { type: "chat" }) { return this._bind._deleteVariable(path, option); },
    getCurrentCharacterName() { return getBridgeParams()?.activeCharacter?.name || ""; },
    getCharacter() {
      const params = getBridgeParams();
      if (!params || !params.activeCharacter) return null;
      const c = params.activeCharacter;
      return { name: c.name, description: c.description || "", avatar: c.avatar || "", personality: c.personality || "",
        scenario: c.scenario || "", first_mes: c.first_mes || "", alternate_greetings: c.alternate_greetings || [],
        creator: c.creator || "", creator_notes: c.creator_notes || "", tags: c.tags || [],
        character_version: c.character_version || "1.0.0", extensions: c.extensions || {},
        visualSettings: c.visualSettings || {}, variables: c.variables || {} };
    },
    getCharData() { return this.getCharacter(); },
    getChatMessages() { return bindObj._getChatMessages(); },
    setChatMessages(updates: any[]) {
      console.log("[TavernHelper setChatMessages]", updates);
      const params = getBridgeParams();
      if (!params || !params.activeSession) return Promise.resolve();
      const session = { ...params.activeSession };
      let changed = false;
      updates.forEach((up) => {
        const targetId = resolveMessageId(up.message_id, session.messages.length);
        const msg = session.messages[targetId] as any;
        if (msg) {
          const newContent = up.message !== undefined ? up.message : (up.mes !== undefined ? up.mes : (up.content !== undefined ? up.content : undefined));
          if (newContent !== undefined && msg.content !== newContent) { msg.content = newContent; changed = true; }
          if (up.swipe_id !== undefined && msg.swipe_id !== up.swipe_id) {
            msg.swipe_id = up.swipe_id; changed = true;
            if (targetId !== 0 && msg.swipes && msg.swipes[up.swipe_id] !== undefined) msg.content = msg.swipes[up.swipe_id];
          }
          if (up.swipes !== undefined && !lodashIsEqual(msg.swipes, up.swipes)) { msg.swipes = up.swipes; changed = true; }
          if (up.swipes_data !== undefined && !lodashIsEqual(msg.swipes_data, up.swipes_data)) { msg.swipes_data = up.swipes_data; changed = true; }
          if (up.extra !== undefined) { msg.extra = { ...msg.extra, ...up.extra }; changed = true; }
          if (up.variables !== undefined) {
            if (!msg.extra) msg.extra = {};
            if (!msg.extra.variables) msg.extra.variables = {};
            const keys = Object.keys(up.variables);
            const isNested = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
            if (isNested) { msg.extra.variables = { ...msg.extra.variables, ...up.variables }; }
            else {
              const swipeId = msg.swipe_id !== undefined ? msg.swipe_id : 0;
              const existingSwipeVars = msg.extra.variables[swipeId] || {};
              msg.extra.variables = { ...msg.extra.variables, [swipeId]: { ...existingSwipeVars, ...up.variables } };
            }
            changed = true;
          }
          if (up.swipe_id !== undefined) {
            const char = getBridgeParams()?.activeCharacter;
            if (targetId === 0 && char) {
              const allGreetings = [char.first_mes, ...(char.alternate_greetings || [])];
              if (allGreetings[up.swipe_id] !== undefined && msg.content !== allGreetings[up.swipe_id]) { msg.content = allGreetings[up.swipe_id]; changed = true; }
            }
          }
          if (targetId === session.messages.length - 1) {
            const swipeId = msg.swipe_id !== undefined ? msg.swipe_id : 0;
            session.variables = { ...(msg.extra?.variables?.[swipeId] || {}) };
          }
        }
      });
      if (changed) {
        params.setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
        params.saveSession(session);
        notifyVariablesUpdated(session);
      }
      return Promise.resolve();
    },
    getTavernHelperVersion() { return "4.1.0"; },
    getFrontendVersion() { return "4.1.0"; },
    getTavernVersion() { return "1.14.0"; },
    updateTavernHelper() { return Promise.resolve(true); },
    getLastMessageId() { const msgs = getBridgeParams()?.activeSession?.messages || []; return msgs.length > 0 ? msgs.length - 1 : 0; },
    triggerSlash(command: string) {
      console.log("[TavernHelper Bridge triggerSlash]", command);
      // 支持 SillyTavern 的 | 命令链式语法（如 /send payload|/trigger）
      // 逐条解析并执行，/trigger 等无对应实现的命令安全忽略
      const commands = String(command || "").split("|").map(c => c.trim()).filter(Boolean);
      for (const cmd of commands) {
        if (cmd.startsWith("/send ") || cmd.startsWith("/say ")) {
          getBridgeParams()?.handleSendMessage(cmd.slice(6).trim());
        } else if (cmd === "/trigger" || cmd === "/continue") {
          // /trigger 和 /continue 由 handleSendMessage 的自然流程触发（发送后自动生成），此处无需额外动作
          console.log("[TavernHelper Bridge triggerSlash] 命令已由 send 流程隐式触发:", cmd);
        } else {
          console.log("[TavernHelper Bridge triggerSlash] 未实现的命令已忽略:", cmd);
        }
      }
      return "";
    },
    triggerSlashWithResult(command: string) { return this.triggerSlash(command); },
    substitudeMacros(text: string) {
      if (!text) return "";
      const params = getBridgeParams();
      return text.replace(/\{\{char\}\}/gi, params?.activeCharacter?.name || "").replace(/\{\{user\}\}/gi, params?.settings?.userName || "user");
    },
    playAudio: () => {},
    pauseAudio: () => {},
    getAudioList: () => [],
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 9. SillyTavern 全局命名空间 Mock
  // ──────────────────────────────────────────────────────────────────────────
  const mockEventEmitter = tavernHelperEventEmitter;
  const mockEventTypes = {
    APP_READY: "app_ready", SETTINGS_UPDATED: "settings_updated", CHAT_CHANGED: "chat_changed",
    OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after", OAI_PRESET_EXPORT_READY: "oai_preset_export_ready",
    USER_MESSAGE_RENDERED: "user_message_rendered", CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  };

  parentWin.SillyTavern = parentWin.SillyTavern || {
    get extensionSettings() {
      const params = getBridgeParams();
      if (params && params.settings) {
        if (!params.settings.extensionSettings) params.settings.extensionSettings = {};
        return params.settings.extensionSettings;
      }
      return {};
    },
    get extension_settings() { return this.extensionSettings; },
    saveSettingsDebounced() {
      const params = getBridgeParams();
      if (params && params.settings) { params.updateSettings({ ...params.settings, extensionSettings: params.settings.extensionSettings || {} }); }
      return Promise.resolve();
    },
    saveChat() { return Promise.resolve(); },
    get chat() { return bindObj._getChatMessages(); },
    getCurrentChatId() { return getBridgeParams()?.activeSession?.id || "default_chat"; },
    getRequestHeaders() { return {}; },
    getContext() {
      const params = getBridgeParams();
      const activeChar = params?.activeCharacter;
      const activeSession = params?.activeSession;
      const userName = params?.settings?.userName || "user";
      const chatMessages = bindObj._getChatMessages();
      return {
        character: activeChar ? { name: activeChar.name, description: activeChar.description || "", personality: activeChar.personality || "",
          scenario: activeChar.scenario || "", first_mes: activeChar.first_mes || "", avatar: activeChar.avatar || "",
          data: { alternate_greetings: activeChar.alternate_greetings || [], character_version: activeChar.character_version || "1.0.0",
            creator: activeChar.creator || "", creator_notes: activeChar.creator_notes || "", extensions: activeChar.extensions || {} } } : null,
        userName, characters: activeChar ? [{ name: activeChar.name, description: activeChar.description || "", personality: activeChar.personality || "",
          scenario: activeChar.scenario || "", first_mes: activeChar.first_mes || "", avatar: activeChar.avatar || "",
          data: { alternate_greetings: activeChar.alternate_greetings || [], character_version: activeChar.character_version || "1.0.0",
            creator: activeChar.creator || "", creator_notes: activeChar.creator_notes || "", extensions: activeChar.extensions || {} } }] : [],
        settings: params?.settings || null, chat: chatMessages, characterId: "0", chatId: activeSession?.id || "default_chat",
        getCurrentChatId: () => activeSession?.id || "default_chat",
        reloadCurrentChat: () => Promise.resolve(), saveChat: () => Promise.resolve(), saveChatConditional: () => Promise.resolve(),
        clearChat: () => Promise.resolve(), printMessages: () => Promise.resolve(),
        reloadMarkdownProcessor: () => ({ makeHtml: (text: string) => text }),
        getThumbnailUrl: (type: string, file: string) => file, getRequestHeaders: () => ({}),
        saveSettingsDebounced: () => {
          if (params && params.settings) { params.updateSettings({ ...params.settings, extensionSettings: params.settings.extensionSettings || {} }); }
          return Promise.resolve();
        },
        saveMetadataDebounced: () => Promise.resolve(),
        get extensionSettings() {
          if (params && params.settings) {
            if (!params.settings.extensionSettings) params.settings.extensionSettings = {};
            return params.settings.extensionSettings;
          }
          return {};
        },
        get extension_settings() { return this.extensionSettings; },
        chatMetadata: {}, chat_metadata: {}, oaiSettings: {}, oai_settings: {},
        eventSource: mockEventEmitter, event_source: mockEventEmitter,
        eventTypes: mockEventTypes, event_types: mockEventTypes,
        isMobile: () => true,
        t: (strings: any, ...values: any[]) => { if (typeof strings === 'string') return strings; if (Array.isArray(strings)) return strings.join(''); return String(strings); },
        translate: (text: string) => text, getCurrentLocale: () => "zh-CN", writeExtensionField: sharedWriteExtensionField,
      };
    },
  };


  // ──────────────────────────────────────────────────────────────────────────
  // 10. Mvu (Model-View-Update) 全局框架 Mock
  // ──────────────────────────────────────────────────────────────────────────
  parentWin.Mvu = parentWin.Mvu || {
    events: {
      VARIABLE_INITIALIZED: 'mag_variable_initialized', VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      COMMAND_PARSED: 'mag_command_parsed', VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
      BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
    },

    getMvuData(options: any = { type: "chat" }) {
      const vars = parentWin.TavernHelper.getVariables(options) || {};
      if (vars.stat_data && vars.schema) return vars;
      return { initialized_lorebooks: vars.initialized_lorebooks || {}, stat_data: vars.stat_data || vars,
        schema: vars.schema || { type: 'object', properties: {} }, display_data: vars.display_data || {}, delta_data: vars.delta_data || {} };
    },
    replaceMvuData(mvu_data: any, options: any = { type: "chat" }) {
      return Promise.resolve(parentWin.TavernHelper.replaceVariables(mvu_data, options));
    },
    parseMessage(message: string, old_data: any) { return Promise.resolve(parseMvuMessage(message, old_data)); },
    isDuringExtraAnalysis: () => false,
    getCurrentMvuData() { return this.getMvuData({ type: 'chat' }); },
    replaceCurrentMvuData(mvu_data: any) { return this.replaceMvuData(mvu_data, { type: 'chat' }); },
    reloadInitVar(mvu_data: any) { return Promise.resolve(true); },
    setMvuVariable(mvu_data: any, path: string, new_value: any) {
      const target = mvu_data.stat_data || mvu_data;
      lodashSet(target, path, new_value);
      return Promise.resolve(true);
    },
    getMvuVariable(mvu_data: any, path: string, _options: any) {
      const target = mvu_data.stat_data || mvu_data;
      const val = lodashGet(target, path);
      if (Array.isArray(val) && val.length === 2 && typeof val[1] === 'string') return val[0];
      return val;
    },
    getRecordFromMvuData(mvu_data: any, _category: string) { return mvu_data.stat_data || mvu_data; },
  };
  // ──────────────────────────────────────────────────────────────────────────
  // 11. 在父页面 window 上全局暴露 getAllVariables / getVariables
  //     消息气泡 iframe 内的状态栏脚本会调用：
  //       findGetAllVariables(window.parent)  →  window.parent.getAllVariables
  //     必须在这里把函数挂到父页面根 window 上，否则永远找不到。
  // ──────────────────────────────────────────────────────────────────────────
  (parentWin as any).getAllVariables = function() {
    return bindObj._getAllVariables();
  };
  (parentWin as any).getVariables = function(options?: any) {
    return bindObj._getVariables(options);
  };
}
