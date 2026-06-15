import React from "react";
import _ from "lodash";
import { CharacterCard, ChatSession, UserSettings } from "../types";
import { klona } from "klona";
import { createPinia, defineStore, getActivePinia, setActivePinia } from "pinia";
import { compare } from "compare-versions";
import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";
import { registerMvuSchema } from "./mvu_zod";
import * as Vue from "vue";
import jQuery from "jquery";
import * as math from "mathjs";



// Raw script imports for offline iframe injection
import mvuBundleContent from "./mvu_bundle.js?raw";
import mvuZodContent from "./mvu_zod.js?raw";
import mvuContent from "./mvu.js?raw";


export interface TavernHelperBridgeParams {
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

// Module-level mutable pointer to store active React states
let bridgeParams: TavernHelperBridgeParams | null = null;

const tavernHelperEventEmitter = (() => {
  const listeners: Record<string, any[]> = {};
  const emitter = {
    on(event: string, cb: any) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
      return emitter;
    },
    once(event: string, cb: any) {
      const wrapper = (...args: any[]) => {
        emitter.off(event, wrapper);
        cb(...args);
      };
      return emitter.on(event, wrapper);
    },
    off(event: string, cb: any) {
      if (!listeners[event]) return emitter;
      listeners[event] = listeners[event].filter(l => l !== cb);
      return emitter;
    },
    removeListener(event: string, cb: any) {
      return emitter.off(event, cb);
    },
    emit(event: string, ...args: any[]) {
      if (!listeners[event]) return emitter;
      const list = [...listeners[event]];
      list.forEach(cb => {
        try { cb(...args); } catch (e) { console.error(`[Event Emit Error in ${event}]:`, e); }
      });
      return emitter;
    },
    emitAndWait(event: string, ...args: any[]) {
      if (!listeners[event]) return Promise.resolve([]);
      const list = [...listeners[event]];
      return Promise.all(list.map(async (cb) => {
        try {
          return await Promise.resolve(cb(...args));
        } catch (e) {
          console.error(`[Event EmitAndWait Error in ${event}]:`, e);
          return null;
        }
      }));
    },
    makeFirst(event: string, cb: any) {
      listeners[event] = listeners[event] || [];
      listeners[event].unshift(cb);
      return emitter;
    },
    makeLast(event: string, cb: any) {
      return emitter.on(event, cb);
    },
    clear(event: string) {
      delete listeners[event];
    },
    clearAll() {
      for (const ev in listeners) {
        delete listeners[ev];
      }
    }
  };
  return emitter;
})();

function initializeVariablesForSession(session: any) {
  if (!session) return;
  const variables = session.variables || {};
  if (!variables.stat_data) {
    variables.stat_data = {};
  }

  console.log("[TavernHelper Event] Emitting mag_variable_initialized for session:", session.id);
  tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);
  console.log("[TavernHelper Event] Variables after initialization:", variables);

  session.variables = variables;

  // Sync variables to the first message (greeting) for SillyTavern compatibility
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
    console.log(`[TavernHelper Event] Synced initial variables to first message (swipeId: ${swipeId})`);
  }

  if (bridgeParams) {
    bridgeParams.setSessions(prev =>
      prev.map(s => s.id === session.id ? { ...s, variables, messages: session.messages } : s)
    );
    bridgeParams.saveSession(session);
  }
}

function getSwipeVariables(m: any): Record<string, any> {
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

function resolveMessageId(id: any, messagesLength: number): number {
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

/**
 * Initialize MVU variables from character card extensions.
 * Extracts mvu_settings/schema from character extensions and merges into session variables.
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

  // Try to extract MVU settings from various possible extension locations
  const mvuSettings = ext.mvu_settings ||
                      ext.mvu ||
                      ext.MVU ||
                      null;

  if (mvuSettings) {
    console.log("[MVU] Found mvu_settings in character extensions:", mvuSettings);

    // If settings contains a schema, use it
    if (mvuSettings.schema) {
      variables.schema = mvuSettings.schema;
    }

    // If settings contains initial stat_data/default values
    if (mvuSettings.stat_data) {
      variables.stat_data = { ...mvuSettings.stat_data };
    } else if (mvuSettings.defaults) {
      variables.stat_data = { ...mvuSettings.defaults };
    }

    // Copy display configuration if present
    if (mvuSettings.display_data) {
      variables.display_data = { ...mvuSettings.display_data };
    }
  }

  // Also check for tavern_helper scripts presence (for UI rendering)
  if (ext.tavern_helper?.scripts) {
    console.log(`[MVU] Found ${ext.tavern_helper.scripts.length} tavern_helper scripts`);
  }

  // Ensure stat_data exists
  if (!variables.stat_data) {
    variables.stat_data = {};
  }

  console.log("[MVU] Initialized variables from character:", variables);
  return variables;
}

// Static initialization block executing immediately upon module import
if (typeof window !== "undefined") {
  const parentWin = window as any;

  // 1. Expose standard libraries
  parentWin._ = _ ;
  parentWin.Vue = Vue;
  parentWin.$ = parentWin.jQuery = jQuery;


  // Expose local MVU library dependencies to parent window for offline iframe loading
  parentWin.TavernHelperMvuLibs = {
    klona,
    createPinia,
    defineStore,
    getActivePinia,
    setActivePinia,
    compare,
    JSON5,
    jsonrepair,
    math,
    // Expose namespaces for wildcard imports (e.g. import * as pinia from '...')
    pinia: {
      createPinia,
      defineStore,
      getActivePinia,
      setActivePinia,
    },
    vue: Vue,
  };
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

  // 3. Mock YAML parser
  parentWin.YAML = parentWin.YAML || {
    parse: (str: string) => {
      try {
        return JSON.parse(str);
      } catch {
        return {};
      }
    },
    stringify: (obj: any) => JSON.stringify(obj),
  };

  // 4. Mock Zod schema validator safely with a recursive Proxy to support chainable schemas (z.string(), z.object())
  // 4. Mock Zod schema validator safely with a smart recursive parser to support defaulting and validation (essential for MVU store setting parsing)
  const createZodProxy = (): any => {
    const createSchema = (type: string, shapeOrDef?: any): any => {
      const schema: any = {
        _type: type,
        _shape: shapeOrDef,
        _defaultValue: undefined,
        _isOptional: false,
        _isNullable: false,
        
        default(val: any) {
          this._defaultValue = val;
          return this;
        },
        prefault(val: any) {
          this._defaultValue = val;
          return this;
        },
        optional() {
          this._isOptional = true;
          return this;
        },
        nullable() {
          this._isNullable = true;
          return this;
        },
        or(otherSchema: any) {
          return createSchema('union', [this, otherSchema]);
        },
        parse(val: any) {
          if (val === undefined || val === null) {
            if (this._defaultValue !== undefined) {
              val = typeof this._defaultValue === 'function' ? this._defaultValue() : _.cloneDeep(this._defaultValue);
            } else {
              if (this._type === 'object') {
                val = {};
              } else if (this._type === 'union') {
                // Do not intercept, let it flow to the union checking logic so sub-schemas can test undefined/null
              } else {
                if (this._isOptional || this._isNullable) return val;
                if (this._type === 'string' || this._type === 'coerce_string') return "";
                if (this._type === 'number' || this._type === 'coerce_number') return 0;
                if (this._type === 'boolean' || this._type === 'coerce_boolean') return false;
                if (this._type === 'array') return [];
                if (this._type === 'enum' && Array.isArray(this._shape) && this._shape.length > 0) {
                  return this._shape[0];
                }
                if (this._type === 'record' || this._type === 'partialRecord' || this._type === 'map') return {};
                return undefined;
              }
            }
          }
          if (this._type === 'string') {
            if (typeof val !== 'string') throw new Error("Expected string");
            return val;
          }
          if (this._type === 'coerce_string') {
            return String(val);
          }
          if (this._type === 'number') {
            if (typeof val !== 'number') throw new Error("Expected number");
            return val;
          }
          if (this._type === 'coerce_number') {
            const num = Number(val);
            if (isNaN(num)) throw new Error("Expected number coercion");
            return num;
          }
          if (this._type === 'boolean') {
            if (typeof val !== 'boolean') throw new Error("Expected boolean");
            return val;
          }
          if (this._type === 'coerce_boolean') {
            if (val === 'true') return true;
            if (val === 'false') return false;
            return Boolean(val);
          }
          if (this._type === 'object') {
            if (!val || typeof val !== 'object') throw new Error("Expected object");
            const res: any = { ...val };
            if (this._shape) {
              for (const [key, subSchema] of Object.entries(this._shape)) {
                res[key] = (subSchema as any).parse(val[key]);
              }
            }
            return res;
          }
          if (this._type === 'union' && this._shape) {
            const unionSchemas = Array.isArray(this._shape) ? this._shape : (this._shape.schemas || []);
            for (const sub of unionSchemas) {
              try {
                return sub.parse(val);
              } catch {}
            }
            throw new Error("Union did not match any schemas");
          }
          if (this._type === 'record' || this._type === 'partialRecord') {
            let keySchema: any = undefined;
            let valueSchema: any = undefined;
            if (Array.isArray(this._shape)) {
              if (this._shape.length === 2) {
                keySchema = this._shape[0];
                valueSchema = this._shape[1];
              } else if (this._shape.length === 1) {
                valueSchema = this._shape[0];
              }
            }
            if (valueSchema) {
              if (!val || typeof val !== 'object') throw new Error("Expected object for record");
              const res: any = {};
              for (const [key, item] of Object.entries(val)) {
                if (keySchema) {
                  keySchema.parse(key);
                }
                res[key] = valueSchema.parse(item);
              }
              return res;
            }
            return val;
          }
          if (this._type === 'intersection' && Array.isArray(this._shape) && this._shape.length === 2) {
            const parsedA = this._shape[0].parse(val);
            const parsedB = this._shape[1].parse(val);
            if (parsedA && typeof parsedA === 'object' && parsedB && typeof parsedB === 'object') {
              return { ...parsedA, ...parsedB };
            }
            return parsedB !== undefined ? parsedB : parsedA;
          }
          if (this._type === 'literal') {
            if (val !== this._shape) throw new Error("Literal value mismatch");
            return val;
          }
          if (this._type === 'templateLiteral') {
            return val !== undefined ? String(val) : "";
          }
          if (this._type === 'custom') {
            if (typeof this._shape === 'function') {
              const ok = this._shape(val);
              if (!ok) throw new Error("Custom validation failed");
            }
            return val;
          }
          return val;
        },
        safeParse(val: any) {
          try {
            return { success: true, data: this.parse(val) };
          } catch (e) {
            return { success: false, error: e };
          }
        },
        catch(fallback: any) {
          const originalParse = this.parse.bind(this);
          this.parse = (val: any) => {
            try {
              return originalParse(val);
            } catch (e) {
              if (typeof fallback === 'function') {
                return fallback(e);
              }
              return fallback;
            }
          };
          return this;
        },
        transform(fn: any) {
          const originalParse = this.parse.bind(this);
          this.parse = (val: any) => {
            const parsed = originalParse(val);
            return fn(parsed);
          };
          return this;
        },
        element() { return this; },
        innerType() { return this; },
        shape: {},
        _def: {},
      };

      if (type === 'object' && shapeOrDef) {
        schema.shape = shapeOrDef;
      }
      
      let schemaProxy: any;
      schemaProxy = new Proxy(schema, {
        get(target, prop) {
          if (prop in target) {
            return target[prop];
          }
          if (typeof prop === 'string') {
            const mockFunc = function() {
              return schemaProxy;
            };
            mockFunc.prototype = {};
            return mockFunc;
          }
          return undefined;
        }
      });
      return schemaProxy;
    };

    const zodProxy: any = {
      object(shape: any) { return createSchema('object', shape); },
      union(schemas: any) { return createSchema('union', schemas); },
      enum(values: any) { return createSchema('enum', values); },
      string() { return createSchema('string'); },
      number() { return createSchema('number'); },
      boolean() { return createSchema('boolean'); },
      any() { return createSchema('any'); },
      unknown() { return createSchema('unknown'); },
      array(schema: any) { return createSchema('array', schema); },
      record(...args: any[]) { return createSchema('record', args); },
      partialRecord(...args: any[]) { return createSchema('partialRecord', args); },
      templateLiteral(args: any) { return createSchema('templateLiteral', args); },
      intersection(a: any, b: any) { return createSchema('intersection', [a, b]); },
      literal(val: any) { return createSchema('literal', val); },
      custom(fn: any) { return createSchema('custom', fn); },
      coerce: {
        number() { return createSchema('coerce_number'); },
        string() { return createSchema('coerce_string'); },
        boolean() { return createSchema('coerce_boolean'); },
      }
    };
    
    let proxyInstance: any;
    proxyInstance = new Proxy(zodProxy, {
      get(target, prop) {
        if (prop === 'z' || prop === 'default') {
          return proxyInstance;
        }
        if (prop in target) return target[prop];
        if (typeof prop === 'string') {
          const mockFunc = function(...args: any[]) {
            return createSchema(prop, args);
          };
          mockFunc.prototype = {};
          return mockFunc;
        }
        return undefined;
      }
    });
    return proxyInstance;
  };
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
      return {
        makeHtml: (text: string) => text,
      };
    },
  };

  // 6b. Mock script buttons related functions for MVU extension compatibility
  parentWin.appendInexistentScriptButtons = parentWin.appendInexistentScriptButtons || (() => {});
  parentWin.getScriptButtons = parentWin.getScriptButtons || (() => []);
  parentWin.replaceScriptButtons = parentWin.replaceScriptButtons || (() => {});
  parentWin.getButtonEvent = parentWin.getButtonEvent || ((name: string) => name);

  // 7. Mock TavernHelper core bindings
  const bindObj = {
    _eventOn(event: string, cb: any) {
      tavernHelperEventEmitter.on(event, cb);
    },
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
    _eventEmit(event: string, ...args: any[]) {
      tavernHelperEventEmitter.emit(event, ...args);
    },
    _eventEmitAndWait(event: string, ...args: any[]) {
      return tavernHelperEventEmitter.emitAndWait(event, ...args);
    },
    _eventRemoveListener(event: string, cb: any) {
      tavernHelperEventEmitter.off(event, cb);
    },
    _eventClearEvent(event: string) {
      tavernHelperEventEmitter.clear(event);
    },
    _eventClearListener(event: string) {
      tavernHelperEventEmitter.clear(event);
    },
    _eventClearAll() {
      tavernHelperEventEmitter.clearAll();
    },
    _initializeGlobal: () => {},
    _waitGlobalInitialized: () => Promise.resolve(),
    _registerMacroLike: () => {},
    _reloadIframe: () => {},
    _onIframeReady(iframeId: string) {
      console.log(`[TavernHelper Bridge] Iframe ${iframeId} is ready.`);
      // Delay by 100ms so the iframe's type="module" script can finish registering
      // its mag_variable_initialized event listener before we emit the event.
      setTimeout(() => {
        if (bridgeParams && bridgeParams.activeSession) {
          initializeVariablesForSession(bridgeParams.activeSession);
        }
      }, 100);
    },
    _errorCatched: () => {},
    _getIframeName: () => "TH-message-iframe",
    _getScriptId: () => "script_default",
    _getCurrentMessageId: () => {
      return (bridgeParams?.activeSession?.messages?.length || 1) - 1;
    },
    _getVariables(opt: any = { type: "chat" }) {
      if (!bridgeParams) return {};
      const { activeCharacter, settings, activeSession } = bridgeParams;
      if (opt.type === "character") return activeCharacter?.variables || {};
      if (opt.type === "global") return settings?.variables || {};
      if (opt.type === "message" && opt.message_id !== undefined) {
        const messages = activeSession?.messages || [];
        const msgId = resolveMessageId(opt.message_id, messages.length);
        const msg = messages[msgId] as any;
        if (msg) {
          const swipeId = opt.swipe_id !== undefined ? opt.swipe_id : (msg.swipe_id !== undefined ? msg.swipe_id : 0);
          if (!msg.extra) msg.extra = {};
          if (!msg.extra.variables) msg.extra.variables = {};
          if (!msg.extra.variables[swipeId]) msg.extra.variables[swipeId] = {};
          return msg.extra.variables[swipeId];
        }
        return {};
      }
      return activeSession?.variables || {};
    },
    _getAllVariables() {
      if (!bridgeParams) return {};
      const { activeCharacter, settings, activeSession } = bridgeParams;
      return {
        ...(settings?.variables || {}),
        ...(activeCharacter?.variables || {}),
        ...(activeSession?.variables || {}),
      };
    },
    _replaceVariables(variables: Record<string, any>, opt: any = { type: "chat" }) {
      if (!bridgeParams) return;
      const { activeCharacter, settings, activeSession, setCharacters, saveCharacter, updateSettings, setSessions, saveSession } = bridgeParams;
      if (opt.type === "character" && activeCharacter) {
        setCharacters((prev) => {
          let updatedChar: any = null;
          const next = prev.map((c) => {
            if (c.id === activeCharacter.id) {
              updatedChar = { ...c, variables };
              return updatedChar;
            }
            return c;
          });
          if (updatedChar) {
            setTimeout(() => {
              saveCharacter(updatedChar);
            }, 0);
          }
          return next;
        });
      } else if (opt.type === "global") {
        updateSettings((prev: any) => {
          return { ...prev, variables };
        });
      } else if (opt.type === "message" && opt.message_id !== undefined && activeSession) {
        setSessions((prev) => {
          const activeS = prev.find(s => s.id === activeSession.id);
          if (!activeS) return prev;
          const targetMsgId = resolveMessageId(opt.message_id, activeS.messages.length);
          let sessionVarsUpdated = false;
          const updatedMessages = activeS.messages.map((m, idx) => {
            if (idx === targetMsgId) {
              const msg = m as any;
              const swipeId = opt.swipe_id !== undefined ? opt.swipe_id : (msg.swipe_id !== undefined ? msg.swipe_id : 0);
              const extra = { ...msg.extra };
              if (!extra.variables) extra.variables = {};
              extra.variables = {
                ...extra.variables,
                [swipeId]: variables
              };
              if (idx === activeS.messages.length - 1) {
                sessionVarsUpdated = true;
              }
              return { ...m, extra };
            }
            return m;
          });
          const updatedSession = { 
            ...activeS, 
            messages: updatedMessages,
            variables: sessionVarsUpdated ? variables : activeS.variables
          };
          setTimeout(() => {
            saveSession(updatedSession);
            notifyVariablesUpdated(updatedSession);
          }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        });
      } else if (activeSession) {
        setSessions((prev) => {
          const activeS = prev.find(s => s.id === activeSession.id);
          if (!activeS) return prev;
          const updated = { ...activeS, variables };
          setTimeout(() => {
            saveSession(updated);
            notifyVariablesUpdated(updated);
          }, 0);
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
      return bindObj._updateVariablesWith(
        (old: any) => ({ ...old, ...variables }),
        opt
      );
    },
    _insertVariables(variables: Record<string, any>, opt = { type: "chat" }) {
      return bindObj._updateVariablesWith(
        (old: any) => ({ ...variables, ...old }),
        opt
      );
    },
    _deleteVariable(path: string, opt = { type: "chat" }) {
      const vars = bindObj._getVariables(opt);
      delete vars[path];
      bindObj._replaceVariables(vars, opt);
      return { variables: vars, delete_occurred: true };
    },
    _setChatMessage(id: number, messageObj: any) {
      console.log(`[TavernHelper Bridge] _setChatMessage called for id: ${id}`, messageObj);
      if (!bridgeParams || !bridgeParams.activeSession) return;
      const { activeSession, setSessions, saveSession } = bridgeParams;
      
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
            if (typeof messageObj === "string") {
              targetContent = messageObj;
              textChanged = true;
            } else if (messageObj && typeof messageObj === "object") {
              const possibleContent = messageObj.mes !== undefined ? messageObj.mes : (messageObj.content !== undefined ? messageObj.content : (messageObj.message !== undefined ? messageObj.message : undefined));
              if (possibleContent !== undefined) {
                targetContent = possibleContent;
                textChanged = true;
              }
            }
            if (textChanged && updatedMsg.content !== targetContent) {
              updatedMsg.content = targetContent;
              changed = true;
            }

            if (messageObj && typeof messageObj === "object") {
              if (messageObj.swipe_id !== undefined && (updatedMsg as any).swipe_id !== messageObj.swipe_id) {
                (updatedMsg as any).swipe_id = messageObj.swipe_id;
                changed = true;
              }
              if (messageObj.swipes !== undefined && !_.isEqual((updatedMsg as any).swipes, messageObj.swipes)) {
                (updatedMsg as any).swipes = messageObj.swipes;
                changed = true;
              }
              if (messageObj.swipes_data !== undefined && !_.isEqual((updatedMsg as any).swipes_data, messageObj.swipes_data)) {
                (updatedMsg as any).swipes_data = messageObj.swipes_data;
                changed = true;
              }
              if (messageObj.extra !== undefined && !_.isEqual((updatedMsg as any).extra, messageObj.extra)) {
                (updatedMsg as any).extra = { ...(updatedMsg as any).extra, ...messageObj.extra };
                changed = true;
              }
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
                  (updatedMsg as any).extra.variables = {
                    ...(updatedMsg as any).extra.variables,
                    [swipeId]: { ...existingSwipeVars, ...messageObj.variables }
                  };
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
          const updatedSession = { 
            ...activeS, 
            messages: updatedMessages,
            variables: sessionVarsUpdated ? newSessionVars : activeS.variables
          };
          setTimeout(() => {
            saveSession(updatedSession);
            notifyVariablesUpdated(updatedSession);
          }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        }
        return prev;
      });
    },
    _setChatMessages(messagesList: any[]) {
      console.log("[TavernHelper Bridge] _setChatMessages called with:", JSON.stringify(messagesList, null, 2));
      if (!bridgeParams || !bridgeParams.activeSession) return;
      const { activeSession, setSessions, saveSession, activeCharacter } = bridgeParams;
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
            if (content !== undefined && updated.content !== content) {
              updated.content = content;
              localChanged = true;
            }
            if (typeof newMsg === "object") {
              if (newMsg.swipe_id !== undefined && (updated as any).swipe_id !== newMsg.swipe_id) {
                (updated as any).swipe_id = newMsg.swipe_id;
                localChanged = true;
                
                // Sync content with the new swipe_id
                let swipeContent: string | undefined = undefined;
                if (idx === 0 && activeCharacter) {
                  const allGreetings = [activeCharacter.first_mes, ...(activeCharacter.alternate_greetings || [])];
                  if (allGreetings[newMsg.swipe_id] !== undefined) {
                    swipeContent = allGreetings[newMsg.swipe_id];
                  }
                } else if (updated.swipes && updated.swipes[newMsg.swipe_id] !== undefined) {
                  swipeContent = updated.swipes[newMsg.swipe_id];
                }
                if (swipeContent !== undefined && updated.content !== swipeContent) {
                  updated.content = swipeContent;
                }
              }
              if (newMsg.swipes !== undefined && !_.isEqual((updated as any).swipes, newMsg.swipes)) {
                (updated as any).swipes = newMsg.swipes;
                localChanged = true;
              }
              if (newMsg.swipes_data !== undefined && !_.isEqual((updated as any).swipes_data, newMsg.swipes_data)) {
                (updated as any).swipes_data = newMsg.swipes_data;
                localChanged = true;
              }
              if (newMsg.extra !== undefined && !_.isEqual((updated as any).extra, newMsg.extra)) {
                (updated as any).extra = { ...(updated as any).extra, ...newMsg.extra };
                localChanged = true;
              }
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
                  (updated as any).extra.variables = {
                    ...(updated as any).extra.variables,
                    [swipeId]: { ...existingSwipeVars, ...newMsg.variables }
                  };
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
          const updatedSession = { 
            ...activeS, 
            messages: updatedMessages,
            variables: sessionVarsUpdated ? newSessionVars : activeS.variables
          };
          setTimeout(() => {
            saveSession(updatedSession);
            notifyVariablesUpdated(updatedSession);
          }, 0);
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s));
        }
        return prev;
      });
    },
    _getChatMessages() {
      if (!bridgeParams) return [];
      const { activeSession, activeCharacter, settings } = bridgeParams;
      return (activeSession?.messages || []).map((m, idx) => {
        const msgObj: any = {
          id: idx,
          name: m.sender === "user" ? settings.userName : (activeCharacter?.name || "AI"),
          mes: m.content,
          message: m.content,
          role: m.sender,
          send_date: m.timestamp,
          is_user: m.sender === "user",
          is_system: m.sender === "system",
          swipe_id: (m as any).swipe_id !== undefined ? (m as any).swipe_id : 0,
          swipes: (m as any).swipes || [m.content],
          extra: (m as any).extra || {},
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
    _getLastMessageId() {
      return (bridgeParams?.activeSession?.messages?.length || 1) - 1;
    },
    _getCurrentChatId() {
      return bridgeParams?.activeSession?.id || "default_chat";
    },
    _getTavernHelperVersion() {
      return "3.5.0";
    },
    _saveChat() {
      return Promise.resolve();
    },
    _saveSettingsDebounced() {
      if (bridgeParams && bridgeParams.settings) {
        bridgeParams.updateSettings({
          ...bridgeParams.settings,
          extensionSettings: bridgeParams.settings.extensionSettings || {},
        });
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

  function sharedWriteExtensionField(arg1: string, arg2: any, arg3?: any) {
    if (!bridgeParams) return;
    const settings = { ...bridgeParams.settings };
    if (!settings.extensionSettings) {
      settings.extensionSettings = {};
    }
    
    let extName = 'mvu';
    let fieldName = '';
    let value: any;

    if (arg3 !== undefined) {
      extName = arg1;
      fieldName = arg2;
      value = arg3;
    } else {
      fieldName = arg1;
      value = arg2;
    }

    if (!settings.extensionSettings[extName]) {
      settings.extensionSettings[extName] = {};
    }
    settings.extensionSettings[extName][fieldName] = value;

    if (arg3 === undefined) {
      settings.extensionSettings[fieldName] = value;
    }

    console.log(`[writeExtensionField] Saved setting under ${extName}.${fieldName}:`, value);
    bridgeParams.updateSettings(settings);
  }

  parentWin.TavernHelper = parentWin.TavernHelper || {
    _th_impl: {
      _init: () => {},
      _log: (...args: any[]) => console.log("[Iframe Log]", ...args),
      _clearLog: () => {},
      writeExtensionField: sharedWriteExtensionField,
    },

    _bind: bindObj,
    _onIframeReady(iframeId: string) {
      if (bindObj && typeof bindObj._onIframeReady === "function") {
        bindObj._onIframeReady(iframeId);
      }
    },

    getVariables(option = { type: "chat" }) {
      return this._bind._getVariables(option);
    },
    replaceVariables(variables: Record<string, any>, option = { type: "chat" }) {
      this._bind._replaceVariables(variables, option);
    },
    updateVariablesWith(updater: any, option = { type: "chat" }) {
      return this._bind._updateVariablesWith(updater, option);
    },
    insertOrAssignVariables(variables: Record<string, any>, option = { type: "chat" }) {
      return this._bind._insertOrAssignVariables(variables, option);
    },
    insertVariables(variables: Record<string, any>, option = { type: "chat" }) {
      return this._bind._insertVariables(variables, option);
    },
    deleteVariable(path: string, option = { type: "chat" }) {
      return this._bind._deleteVariable(path, option);
    },
    getCurrentCharacterName() {
      return bridgeParams?.activeCharacter?.name || "";
    },
    getCharacter() {
      if (!bridgeParams || !bridgeParams.activeCharacter) return null;
      return {
        name: bridgeParams.activeCharacter.name,
        description: bridgeParams.activeCharacter.description || "",
        avatar: bridgeParams.activeCharacter.avatar || "",
        personality: bridgeParams.activeCharacter.personality || "",
        scenario: bridgeParams.activeCharacter.scenario || "",
        first_mes: bridgeParams.activeCharacter.first_mes || "",
        alternate_greetings: bridgeParams.activeCharacter.alternate_greetings || [],
        creator: bridgeParams.activeCharacter.creator || "",
        creator_notes: bridgeParams.activeCharacter.creator_notes || "",
        tags: bridgeParams.activeCharacter.tags || [],
        character_version: bridgeParams.activeCharacter.character_version || "1.0.0",
        extensions: bridgeParams.activeCharacter.extensions || {},
        visualSettings: bridgeParams.activeCharacter.visualSettings || {},
        variables: bridgeParams.activeCharacter.variables || {},
      };
    },
    getCharData() {
      return this.getCharacter();
    },
    getChatMessages() {
      if (!bridgeParams) return [];
      const { activeSession, activeCharacter, settings } = bridgeParams;
      return (activeSession?.messages || []).map((m, idx) => {
        const msgObj: any = {
          id: idx,
          name: m.sender === "user" ? settings.userName : (activeCharacter?.name || "AI"),
          mes: m.content,
          message: m.content,
          role: m.sender,
          send_date: m.timestamp,
          is_user: m.sender === "user",
          is_system: m.sender === "system",
          swipe_id: (m as any).swipe_id !== undefined ? (m as any).swipe_id : 0,
          swipes: (m as any).swipes || [m.content],
          extra: (m as any).extra || {},
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
    setChatMessages(updates: any[]) {
      console.log("[TavernHelper setChatMessages]", updates);
      if (!bridgeParams || !bridgeParams.activeSession) return Promise.resolve();
      const session = { ...bridgeParams.activeSession };
      let changed = false;
      updates.forEach((up) => {
        const targetId = resolveMessageId(up.message_id, session.messages.length);
        const msg = session.messages[targetId] as any;
        if (msg) {
          const newContent = up.message !== undefined ? up.message : (up.mes !== undefined ? up.mes : (up.content !== undefined ? up.content : undefined));
          if (newContent !== undefined && msg.content !== newContent) {
            msg.content = newContent;
            changed = true;
          }
          if (up.swipe_id !== undefined && msg.swipe_id !== up.swipe_id) {
            msg.swipe_id = up.swipe_id;
            changed = true;
            
            // Sync content with the new swipe_id for non-zero message
            if (targetId !== 0 && msg.swipes && msg.swipes[up.swipe_id] !== undefined) {
              msg.content = msg.swipes[up.swipe_id];
            }
          }
          if (up.swipes !== undefined && !_.isEqual(msg.swipes, up.swipes)) {
            msg.swipes = up.swipes;
            changed = true;
          }
          if (up.swipes_data !== undefined && !_.isEqual(msg.swipes_data, up.swipes_data)) {
            msg.swipes_data = up.swipes_data;
            changed = true;
          }
          if (up.extra !== undefined) {
            msg.extra = { ...msg.extra, ...up.extra };
            changed = true;
          }
          if (up.variables !== undefined) {
            if (!msg.extra) msg.extra = {};
            if (!msg.extra.variables) msg.extra.variables = {};
            
            const keys = Object.keys(up.variables);
            const isNested = keys.length > 0 && keys.every(k => !isNaN(Number(k)));
            
            if (isNested) {
              msg.extra.variables = { ...msg.extra.variables, ...up.variables };
            } else {
              const swipeId = msg.swipe_id !== undefined ? msg.swipe_id : 0;
              const existingSwipeVars = msg.extra.variables[swipeId] || {};
              msg.extra.variables = {
                ...msg.extra.variables,
                [swipeId]: { ...existingSwipeVars, ...up.variables }
              };
            }
            changed = true;
          }
          if (up.swipe_id !== undefined) {
            const char = bridgeParams?.activeCharacter;
            if (targetId === 0 && char) {
              const allGreetings = [char.first_mes, ...(char.alternate_greetings || [])];
              if (allGreetings[up.swipe_id] !== undefined && msg.content !== allGreetings[up.swipe_id]) {
                msg.content = allGreetings[up.swipe_id];
                changed = true;
              }
            }
          }
          // Sync session variables if it is the last message
          if (targetId === session.messages.length - 1) {
            const swipeId = msg.swipe_id !== undefined ? msg.swipe_id : 0;
            const swipeVars = msg.extra?.variables?.[swipeId] || {};
            session.variables = { ...swipeVars };
          }
        }
      });
      if (changed) {
        bridgeParams.setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? session : s))
        );
        bridgeParams.saveSession(session);
        notifyVariablesUpdated(session);
      }
      return Promise.resolve();
    },
    getTavernHelperVersion() {
      return "4.1.0";
    },
    getFrontendVersion() {
      return "4.1.0";
    },
    getTavernVersion() {
      return "1.14.0";
    },
    updateTavernHelper() {
      return Promise.resolve(true);
    },
    getLastMessageId() {
      const msgs = bridgeParams?.activeSession?.messages || [];
      return msgs.length > 0 ? msgs.length - 1 : 0;
    },
    triggerSlash(command: string) {
      console.log("[TavernHelper Bridge triggerSlash]", command);
      if (command.startsWith("/send ") || command.startsWith("/say ")) {
        const text = command.slice(6).trim();
        bridgeParams?.handleSendMessage(text);
      }
      return "";
    },
    triggerSlashWithResult(command: string) {
      return this.triggerSlash(command);
    },
    substitudeMacros(text: string) {
      if (!text) return "";
      return text
        .replace(/\{\{char\}\}/gi, bridgeParams?.activeCharacter?.name || "")
        .replace(/\{\{user\}\}/gi, bridgeParams?.settings?.userName || "user");
    },
    playAudio: () => {},
    pauseAudio: () => {},
    getAudioList: () => [],
  };

  // 8. Mock SillyTavern global namespace
  const mockEventEmitter = tavernHelperEventEmitter;

  const mockEventTypes = {
    APP_READY: "app_ready",
    SETTINGS_UPDATED: "settings_updated",
    CHAT_CHANGED: "chat_changed",
    OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after",
    OAI_PRESET_EXPORT_READY: "oai_preset_export_ready",
    USER_MESSAGE_RENDERED: "user_message_rendered",
    CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  };

  parentWin.SillyTavern = parentWin.SillyTavern || {
    get extensionSettings() {
      if (bridgeParams && bridgeParams.settings) {
        if (!bridgeParams.settings.extensionSettings) {
          bridgeParams.settings.extensionSettings = {};
        }
        return bridgeParams.settings.extensionSettings;
      }
      return {};
    },
    get extension_settings() {
      return this.extensionSettings;
    },
    saveSettingsDebounced() {
      if (bridgeParams && bridgeParams.settings) {
        bridgeParams.updateSettings({
          ...bridgeParams.settings,
          extensionSettings: bridgeParams.settings.extensionSettings || {},
        });
      }
      return Promise.resolve();
    },
    saveChat() {
      return Promise.resolve();
    },
    get chat() {
      const activeSession = bridgeParams?.activeSession;
      const activeChar = bridgeParams?.activeCharacter;
      const userName = bridgeParams?.settings?.userName || "user";
      return (activeSession?.messages || []).map((m, idx) => {
        const msgObj: any = {
          id: idx,
          name: m.sender === "user" ? userName : (activeChar?.name || "AI"),
          mes: m.content,
          message: m.content,
          role: m.sender,
          send_date: m.timestamp,
          is_user: m.sender === "user",
          is_system: m.sender === "system",
          swipe_id: (m as any).swipe_id !== undefined ? (m as any).swipe_id : 0,
          swipes: (m as any).swipes || [m.content],
          extra: (m as any).extra || {},
          variables: getSwipeVariables(m),
        };
        if (idx === 0 && activeChar) {
          const allGreetings = [activeChar.first_mes, ...(activeChar.alternate_greetings || [])];
          msgObj.swipes = allGreetings;
          const currentIdx = allGreetings.indexOf(m.content);
          msgObj.swipe_id = (m as any).swipe_id !== undefined ? (m as any).swipe_id : (currentIdx !== -1 ? currentIdx : 0);
        }
        return msgObj;
      });
    },
    getCurrentChatId() {
      return bridgeParams?.activeSession?.id || "default_chat";
    },
    getRequestHeaders() {
      return {};
    },
    getContext() {
      const activeChar = bridgeParams?.activeCharacter;
      const activeSession = bridgeParams?.activeSession;
      const userName = bridgeParams?.settings?.userName || "user";
      
      const chatMessages = (activeSession?.messages || []).map((m, idx) => {
        const msgObj: any = {
          id: idx,
          name: m.sender === "user" ? userName : (activeChar?.name || "AI"),
          mes: m.content,
          message: m.content,
          role: m.sender,
          send_date: m.timestamp,
          is_user: m.sender === "user",
          is_system: m.sender === "system",
          swipe_id: (m as any).swipe_id !== undefined ? (m as any).swipe_id : 0,
          swipes: (m as any).swipes || [m.content],
          extra: (m as any).extra || {},
          variables: getSwipeVariables(m),
        };
        if (idx === 0 && activeChar) {
          const allGreetings = [activeChar.first_mes, ...(activeChar.alternate_greetings || [])];
          msgObj.swipes = allGreetings;
          const currentIdx = allGreetings.indexOf(m.content);
          msgObj.swipe_id = (m as any).swipe_id !== undefined ? (m as any).swipe_id : (currentIdx !== -1 ? currentIdx : 0);
        }
        return msgObj;
      });

      return {
        character: activeChar ? {
          name: activeChar.name,
          description: activeChar.description || "",
          personality: activeChar.personality || "",
          scenario: activeChar.scenario || "",
          first_mes: activeChar.first_mes || "",
          avatar: activeChar.avatar || "",
          data: {
            alternate_greetings: activeChar.alternate_greetings || [],
            character_version: activeChar.character_version || "1.0.0",
            creator: activeChar.creator || "",
            creator_notes: activeChar.creator_notes || "",
            extensions: activeChar.extensions || {},
          }
        } : null,
        userName: userName,
        characters: activeChar ? [{
          name: activeChar.name,
          description: activeChar.description || "",
          personality: activeChar.personality || "",
          scenario: activeChar.scenario || "",
          first_mes: activeChar.first_mes || "",
          avatar: activeChar.avatar || "",
          data: {
            alternate_greetings: activeChar.alternate_greetings || [],
            character_version: activeChar.character_version || "1.0.0",
            creator: activeChar.creator || "",
            creator_notes: activeChar.creator_notes || "",
            extensions: activeChar.extensions || {},
          }
        }] : [],
        settings: bridgeParams?.settings || null,
        chat: chatMessages,
        characterId: "0",
        chatId: activeSession?.id || "default_chat",
        getCurrentChatId: () => activeSession?.id || "default_chat",
        reloadCurrentChat: () => Promise.resolve(),
        saveChat: () => Promise.resolve(),
        saveChatConditional: () => Promise.resolve(),
        clearChat: () => Promise.resolve(),
        printMessages: () => Promise.resolve(),
        reloadMarkdownProcessor: () => ({ makeHtml: (text: string) => text }),
        getThumbnailUrl: (type: string, file: string) => file,
        getRequestHeaders: () => ({}),
        saveSettingsDebounced: () => {
          if (bridgeParams && bridgeParams.settings) {
            bridgeParams.updateSettings({
              ...bridgeParams.settings,
              extensionSettings: bridgeParams.settings.extensionSettings || {},
            });
          }
          return Promise.resolve();
        },
        saveMetadataDebounced: () => Promise.resolve(),
        get extensionSettings() {
          if (bridgeParams && bridgeParams.settings) {
            if (!bridgeParams.settings.extensionSettings) {
              bridgeParams.settings.extensionSettings = {};
            }
            return bridgeParams.settings.extensionSettings;
          }
          return {};
        },
        get extension_settings() {
          return this.extensionSettings;
        },
        chatMetadata: {},
        chat_metadata: {},
        oaiSettings: {},
        oai_settings: {},
        eventSource: mockEventEmitter,
        event_source: mockEventEmitter,
        eventTypes: mockEventTypes,
        event_types: mockEventTypes,
        isMobile: () => true,
        t: (strings: any, ...values: any[]) => {
          if (typeof strings === 'string') return strings;
          if (Array.isArray(strings)) return strings.join('');
          return String(strings);
        },
        translate: (text: string) => text,
        getCurrentLocale: () => "zh-CN",
        writeExtensionField: sharedWriteExtensionField,
      };
    },
  };

  // 9. Mock MVU (Model-View-Update) variables framework
  parentWin.Mvu = parentWin.Mvu || {
    events: {
      VARIABLE_INITIALIZED: 'mag_variable_initialized',
      VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      COMMAND_PARSED: 'mag_command_parsed',
      VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
      BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
    },
    getMvuData(options: any = { type: "chat" }) {
      const vars = parentWin.TavernHelper.getVariables(options) || {};
      if (vars.stat_data && vars.schema) {
        return vars;
      }
      return {
        initialized_lorebooks: vars.initialized_lorebooks || {},
        stat_data: vars.stat_data || vars,
        schema: vars.schema || { type: 'object', properties: {} },
        display_data: vars.display_data || {},
        delta_data: vars.delta_data || {},
      };
    },
    replaceMvuData(mvu_data: any, options: any = { type: "chat" }) {
      return Promise.resolve(parentWin.TavernHelper.replaceVariables(mvu_data, options));
    },
    parseMessage(message: string, old_data: any) {
      return Promise.resolve(parseMvuMessage(message, old_data));
    },
    isDuringExtraAnalysis: () => false,

    // Legacy compatibility methods
    getCurrentMvuData() {
      return this.getMvuData({ type: 'chat' });
    },
    replaceCurrentMvuData(mvu_data: any) {
      return this.replaceMvuData(mvu_data, { type: 'chat' });
    },
    reloadInitVar(mvu_data: any) {
      return Promise.resolve(true);
    },
    setMvuVariable(mvu_data: any, path: string, new_value: any) {
      const target = mvu_data.stat_data || mvu_data;
      _.set(target, path, new_value);
      return Promise.resolve(true);
    },
    getMvuVariable(mvu_data: any, path: string, options: any) {
      const target = mvu_data.stat_data || mvu_data;
      const val = _.get(target, path);
      if (Array.isArray(val) && val.length === 2 && typeof val[1] === 'string') {
        return val[0];
      }
      return val;
    },
    getRecordFromMvuData(mvu_data: any, category: string) {
      return mvu_data.stat_data || mvu_data;
    }
  };
}

let lastSessionId: string | null = null;

export function initTavernHelperBridge(params: TavernHelperBridgeParams) {
  const prevSessionId = lastSessionId;
  bridgeParams = params;

  if (params.activeSession) {
    const currentSessionId = params.activeSession.id;
    lastSessionId = currentSessionId;

    if (prevSessionId && prevSessionId !== currentSessionId) {
      console.log(`[TavernHelper Bridge] Active session changed from ${prevSessionId} to ${currentSessionId}. Notifying scripts.`);
      setTimeout(() => {
        const session = bridgeParams?.activeSession;
        if (session && session.id === currentSessionId) {
          const variables = session.variables || {};
          
          // Emit standard SillyTavern chat changed events
          tavernHelperEventEmitter.emit('chat_id_changed', currentSessionId);
          tavernHelperEventEmitter.emit('chat_changed', currentSessionId);
          
          // Emit variables initialization event for status boards
          tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);
          
          // Emit message receipt and rendering triggers
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
  bridgeParams = null;
  lastSessionId = null;
}

/**
 * Call this after saving a session with updated variables (e.g. after AI reply + MVU parse).
 * It emits the mag_variable_initialized event so that iframe scripts can refresh their UI.
 */
export function notifyVariablesUpdated(session: ChatSession, messageId?: number) {
  if (!session) return;
  const variables = session.variables || {};
  console.log("[TavernHelper Event] notifyVariablesUpdated → emitting mag_variable_initialized + character_message_rendered");
  // 1. Notify MVU bundle that variables have been initialized/updated.
  tavernHelperEventEmitter.emit('mag_variable_initialized', variables, 0);
  // 2. Emit message_received + character_message_rendered so the MVU bundle's
  //    per-turn UI refresh hook fires on every AI reply (not just the first).
  //    The MVU bundle listens on CHARACTER_MESSAGE_RENDERED to re-render the status board.
  const lastMsgId = messageId ?? Math.max(0, (session.messages?.length ?? 1) - 1);
  tavernHelperEventEmitter.emit('message_received', lastMsgId);
  tavernHelperEventEmitter.emit('character_message_rendered', lastMsgId);
}

// Pre-process mvu_zod script by stripping its ES module export statement and wrapping in an IIFE to isolate scope
const processedMvuZod = `(function(){
  ${mvuZodContent
    .replace(/export\s*\{\s*s\s*as\s*registerMvuSchema\s*\};?/g, "")
    .replace(/\/\/#\s*sourceMappingURL=.*/g, "")}
})();`;

// Pre-process mvu script by replacing CDN imports with local TavernHelperMvuLibs lookups and wrapping in an IIFE
const processedMvu = `(function(){
  ${mvuContent
    .replace(
      /import\s*\{\s*defineStore\s+as\s+e\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/pinia\/\+esm['"]/g,
      "const e = window.parent.TavernHelperMvuLibs.defineStore;"
    )
    .replace(/\bexport\s*\{\s*d\s*as\s*defineMvuDataStore\s*\};?/g, "window.defineMvuDataStore = d;")}
})();`;

// Pre-process mvu_bundle script by replacing CDN imports with local TavernHelperMvuLibs lookups and wrapping in an IIFE
const processedMvuBundle = `(function(){
  ${mvuBundleContent
    .replace(
      /import\s*\{\s*klona\s+as\s+e\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/klona\/\+esm['"]/g,
      "const e = window.parent.TavernHelperMvuLibs.klona;"
    )
    .replace(
      /import\s*\{\s*createPinia\s+as\s+t\s*,\s*defineStore\s+as\s+n\s*,\s*getActivePinia\s+as\s+a\s*,\s*setActivePinia\s+as\s+s\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/pinia\/\+esm['"]/g,
      "const { createPinia: t, defineStore: n, getActivePinia: a, setActivePinia: s } = window.parent.TavernHelperMvuLibs;"
    )
    .replace(
      /import\s*\{\s*compare\s+as\s+r\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/compare-versions\/\+esm['"]/g,
      "const r = window.parent.TavernHelperMvuLibs.compare;"
    )
    .replace(
      /import\s*\{\s*default\s+as\s+o\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/json5\/\+esm['"]/g,
      "const o = window.parent.TavernHelperMvuLibs.JSON5;"
    )
    .replace(
      /import\s*\{\s*jsonrepair\s+as\s+i\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/jsonrepair\/\+esm['"]/g,
      "const i = window.parent.TavernHelperMvuLibs.jsonrepair;"
    )
    .replace(
      /import\s*\*as\s+l\s+from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/mathjs\/\+esm['"]/g,
      "const l = window.parent.TavernHelperMvuLibs.math;"
    )
    .replace(/\/\/#\s*sourceMappingURL=.*/g, "")}
})();`;

export function preprocessScriptContent(content: string): string {
  let processed = content;

  // 1. Replace the MVU bundle import
  processed = processed.replace(
    /import\s*['"][^'"]*bundle(?:\.js)?['"];?/g,
    `// Local MVU bundle pre-loaded`
  );

  // 2. Replace the MVU zod import
  processed = processed.replace(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"][^'"]*mvu_zod(?:\.js)?['"];?/g,
    `const registerMvuSchema = window.registerMvuSchema;`
  );

  // 2b. Replace the MVU library import (CDN URL variant)
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/mvu(?:\.js)?\/\+esm['"];?/g,
    (match, importsStr) => {
      const parts = importsStr.split(',').map((p: string) => {
        const item = p.trim();
        if (item.includes(' as ')) {
          const [orig, alias] = item.split(/\s+as\s+/);
          if (orig === 'default' || orig === 'defineMvuDataStore') {
            return `defineMvuDataStore: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(', ')} } = { defineMvuDataStore: window.defineMvuDataStore };`;
    }
  );

  // 2c. Replace the MVU library import (local/relative variant)
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*mvu(?:\.js)?['"];?/g,
    (match, importsStr) => {
      const parts = importsStr.split(',').map((p: string) => {
        const item = p.trim();
        if (item.includes(' as ')) {
          const [orig, alias] = item.split(/\s+as\s+/);
          if (orig === 'default' || orig === 'defineMvuDataStore') {
            return `defineMvuDataStore: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(', ')} } = { defineMvuDataStore: window.defineMvuDataStore };`;
    }
  );

  // 3a. Generic replacement for namespace ESM imports (e.g. import * as math from '...')
  processed = processed.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/]+)\/\+esm['"]/g,
    (match, alias, pkgName) => {
      if (pkgName === 'mathjs') {
        return `const ${alias} = window.parent.TavernHelperMvuLibs.math;`;
      }
      return `const ${alias} = window.parent.TavernHelperMvuLibs.${pkgName};`;
    }
  );

  // 3b. Generic replacement for jsdelivr npm packages ESM imports (e.g. pinia, klona in other scripts)
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/]+)\/\+esm['"]/g,

    (match, importsStr, pkgName) => {
      const parts = importsStr.split(',').map((p: string) => {
        const item = p.trim();
        if (item.includes(' as ')) {
          const [orig, alias] = item.split(/\s+as\s+/);
          if (pkgName === 'json5' && orig === 'default') {
            return `JSON5: ${alias}`;
          }
          if (pkgName === 'compare-versions' && orig === 'compare') {
            return `compare: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(', ')} } = window.parent.TavernHelperMvuLibs;`;
    }
  );

  // 4. Strip export declarations from synchronous card scripts
  processed = processed.replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  processed = processed.replace(/\bexport\s*\{[^}]*\};?/g, "");
  processed = processed.replace(/\bexport\s+default\b/g, "");

  return processed;
}


export function createScriptIframeSrcDoc(scriptContent: string, scriptId: string): string {
  // Debug/Diagnostics to check why imports are not being replaced at runtime
  const unresolvedImports = processedMvuBundle.match(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g);
  if (unresolvedImports) {
    console.warn("[TH Bridge Debug] Unresolved imports in processedMvuBundle:", unresolvedImports);
  } else {
    console.log("[TH Bridge Debug] processedMvuBundle has no unresolved imports!");
  }

  const cleanContent = preprocessScriptContent(
    scriptContent.replace(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/i, "$1")
  );


  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script>
  window.onerror = function(message, source, lineno, colno, error) {
    console.error("[TH Iframe Uncaught Error]:", message, "at", source, ":", lineno, ":", colno, error);
  };
  window.onunhandledrejection = function(event) {
    console.error("[TH Iframe Unhandled Rejection]:", event.reason);
  };
  // ─── Step 1: inherit libraries from parent window (NO external CDN requests) ───
  // This avoids network slowdowns/errors when developer proxy blocks CDN domains.
  window._ = window.parent._;
  window.Vue = window.parent.Vue || null;
  // Inherit jQuery: wrap parent $ to search parent document instead of iframe document
  // This is critical for MVU bundle's listenPreferenceState which uses $('#tavern_helper')
  // to find script elements - those elements exist in the parent window, not the iframe.
  var parentDollar = window.parent.$ || window.parent.jQuery;
  console.log('[TH Bridge Debug] Step 1 - parent.$ available:', !!parentDollar);
  if (parentDollar) {
    // Create a wrapper that always searches in parent document
    window.$ = window.jQuery = function(selector, context) {
      if (context) {
        return parentDollar(selector, context);
      }
      var localResult = parentDollar(selector, window.document);
      if (typeof selector !== 'string' || localResult.length > 0) {
        return localResult;
      }
      return parentDollar(selector, window.parent.document);
    };
    // Copy all static properties/methods from parent $
    for (var key in parentDollar) {
      if (parentDollar.hasOwnProperty(key)) {
        window.$[key] = parentDollar[key];
      }
    }
    console.log('[TH Bridge Debug] Step 1 - jQuery wrapper created');
    // Test jQuery wrapper
    try {
      var testResult = window.$('#tavern_helper');
      console.log('[TH Bridge Debug] Step 1 - jQuery test #tavern_helper found:', testResult.length, 'elements');
      if (testResult.length > 0) {
        console.log('[TH Bridge Debug] Step 1 - First element tag:', testResult[0].tagName);
      }
      // Also test direct parent $ call
      var directResult = parentDollar('#tavern_helper', window.parent.document);
      console.log('[TH Bridge Debug] Step 1 - Direct parent.$ test found:', directResult.length, 'elements');
    } catch(e) {
      console.error('[TH Bridge Debug] Step 1 - jQuery test failed:', e);
    }
  } else {
    window.$ = window.jQuery = null;
    console.warn('[TH Bridge Debug] Step 1 - parent.$ not available!');
  }
  // Expose global TavernHelper mock APIs immediately to prevent ReferenceErrors in Step 1.5
  window.z = window.parent.z || null;
  window.YAML = window.parent.YAML || null;
  window.showdown = window.parent.showdown || null;
  window.toastr = window.parent.toastr || null;
  window.EjsTemplate = window.parent.EjsTemplate || null;
  window.TavernHelper = window.parent.TavernHelper || null;
  window.tavern_events = window.parent.tavern_events || null;
  window.appendInexistentScriptButtons = window.parent.appendInexistentScriptButtons || null;
  window.getScriptButtons = window.parent.getScriptButtons || null;
  window.replaceScriptButtons = window.parent.replaceScriptButtons || null;
  window.getButtonEvent = window.parent.getButtonEvent || null;

  // ─── CRITICAL: Pre-define ALL TavernHelper._bind functions that MVU bundle calls during Step 1.5 ───
  // The MVU bundle IIFE executes immediately in Step 1.5 and calls these functions.
  // Without these stubs, getScriptId() and others throw ReferenceError, breaking MVU initialization.
  // NOTE: TH._bind keys have underscore prefix (e.g. _getScriptId), but MVU bundle calls them without underscore.
  (function() {
    var TH = window.parent.TavernHelper;
    console.log('[TH Bridge Debug] Step 1 - TavernHelper available:', !!TH);
    console.log('[TH Bridge Debug] Step 1 - TH._bind available:', !!(TH && TH._bind));
    if (!TH || !TH._bind) {
      console.warn('[TH Bridge Debug] Step 1 - TH._bind not available, MVU functions will not be pre-defined');
      return;
    }
    var bind = TH._bind;
    // Map of MVU bundle function names (no underscore) to TH._bind keys (with underscore)
    var funcMap = {
      'getScriptId': '_getScriptId',
      'getCurrentMessageId': '_getCurrentMessageId',
      'getVariables': '_getVariables',
      'getAllVariables': '_getAllVariables',
      'replaceVariables': '_replaceVariables',
      'updateVariablesWith': '_updateVariablesWith',
      'insertOrAssignVariables': '_insertOrAssignVariables',
      'deleteVariable': '_deleteVariable',
      'eventOn': '_eventOn',
      'eventEmit': '_eventEmit',
      'eventRemoveListener': '_eventRemoveListener',
      'eventClearAll': '_eventClearAll',
      'getCurrentChatId': '_getCurrentChatId',
      'saveChat': '_saveChat',
      'saveSettingsDebounced': '_saveSettingsDebounced',
      'callGenericPopup': '_callGenericPopup',
      'getTavernHelperVersion': '_getTavernHelperVersion',
      'getScriptButtons': '_getScriptButtons',
      'replaceScriptButtons': '_replaceScriptButtons',
      'appendInexistentScriptButtons': '_appendInexistentScriptButtons',
      'getButtonEvent': '_getButtonEvent',
      'showHelpPopup': '_showHelpPopup',
      'setChatMessage': '_setChatMessage',
      'setChatMessages': '_setChatMessages',
      'getChatMessages': '_getChatMessages',
      'getLastMessageId': '_getLastMessageId',
      'getCharLorebooks': '_getCharLorebooks',
      'getCharWorldbookNames': '_getCharWorldbookNames',
      'getCurrentCharPrimaryLorebook': '_getCurrentCharPrimaryLorebook',
      'getLorebookEntries': '_getLorebookEntries',
      'getLorebookSettings': '_getLorebookSettings',
      'setLorebookSettings': '_setLorebookSettings',
      'setExtraAnalysisStates': '_setExtraAnalysisStates',
      'normalizeBaseURL': '_normalizeBaseURL',
      'generate': '_generate',
      'generateRaw': '_generateRaw',
      'isToolCallingSupported': '_isToolCallingSupported',
      'registerFunctionTool': '_registerFunctionTool',
      'unregisterFunctionTool': '_unregisterFunctionTool',
      'fetch': '_fetch'
    };
    var definedCount = 0;
    for (var name in funcMap) {
      (function(n, bk) {
        if (typeof bind[bk] === 'function') {
          window[n] = function() {
            return bind[bk].apply(bind, arguments);
          };
          definedCount++;
        }
      })(name, funcMap[name]);
    }
    console.log('[TH Bridge Debug] Step 1 - Defined', definedCount, 'MVU functions');
    console.log('[TH Bridge Debug] Step 1 - getScriptId available:', typeof window.getScriptId === 'function');
    if (typeof window.getScriptId === 'function') {
      console.log('[TH Bridge Debug] Step 1 - getScriptId() returns:', window.getScriptId());
    }
  })();

  // Reactively bind SillyTavern and Mvu context so they are defined in Step 1.5
  Object.defineProperty(window, 'SillyTavern', {
    get: function() {
      var SillyTavern = window.parent.SillyTavern;
      return new Proxy(SillyTavern, {
        get: function(target, prop) {
          if (prop === 'getContext') {
            return function() {
              var parentContext = target.getContext();
              return new Proxy(parentContext, {
                get: function(ctxTarget, ctxProp) {
                  if (ctxProp === 'writeExtensionField') {
                    return window._th_impl && window._th_impl.writeExtensionField;
                  }
                  return ctxTarget[ctxProp];
                }
              });
            };
          }
          if (prop === 'writeExtensionField') {
            return window._th_impl && window._th_impl.writeExtensionField;
          }
          return target[prop];
        }
      });
    },
    configurable: true
  });

  if (window.parent._ && window.parent._.has(window.parent, 'Mvu')) {
    Object.defineProperty(window, 'Mvu', {
      get: function() { return window.parent.Mvu; },
      set: function() {},
      configurable: true,
    });
  }
</script>
<script>
  // ─── Step 1.4: Inject Vue compile-time feature flags for esm-bundler build ───
  // The MVU bundle uses Vue's esm-bundler build which expects these global flags.
  // Without them, Vue logs warnings and may not tree-shake properly.
  window.__VUE_OPTIONS_API__ = true;
  window.__VUE_PROD_DEVTOOLS__ = false;
  window.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;
</script>
<script>
  // ─── Step 1.5: Pre-load MVU libraries and framework offline ───
  ${processedMvuZod}
  ${processedMvu}
  ${processedMvuBundle}
</script>
<script>
  // ─── Step 2: TavernHelper predefine.js ───
  (function() {
    var iframeId = "${scriptId}";
    window.__TH_IFRAME_ID = iframeId;
    window.name = iframeId;

    var _ = window.parent._;
    var TavernHelper = window.parent.TavernHelper;
    if (!_) {
      console.error("[TH Iframe] Parent lodash (_) is not loaded!");
      return;
    }
    if (!TavernHelper) {
      console.error("[TH Iframe] Parent TavernHelper is not loaded!");
      return;
    }

    // Direct assignment to prevent lodash deep-merging our Zod Proxy and special objects
    window.z = window.parent.z;
    window.YAML = window.parent.YAML;
    window.showdown = window.parent.showdown;
    window.toastr = window.parent.toastr;
    window.EjsTemplate = window.parent.EjsTemplate;
    window.TavernHelper = TavernHelper;
    window.tavern_events = window.parent.tavern_events;
    window.appendInexistentScriptButtons = window.parent.appendInexistentScriptButtons;
    window.getScriptButtons = window.parent.getScriptButtons;
    window.replaceScriptButtons = window.parent.replaceScriptButtons;
    window.getButtonEvent = window.parent.getButtonEvent;

    // Merge TavernHelper methods onto window (strip leading underscore from _bind keys)
    try {
      var result = _(window);
      result = result.merge(_.omit(TavernHelper, '_bind'));
      result = result.merge.apply(result,
        Object.entries(TavernHelper._bind || {}).map(function(entry) {
          var key = entry[0], value = entry[1];
          var obj = {};
          obj[key.replace('_', '')] = typeof value === 'function' ? value.bind(window) : value;
          return obj;
        })
      );
      result.value();
    } catch(mergeErr) {
      console.warn("[TH Iframe] Merge error:", mergeErr);
    }

    // Intercept event emitter bindings on iframe window to track listeners locally for cleanup
    var localRegisteredEvents = [];

    var originalEventOn = window.eventOn;
    window.eventOn = function(event, cb) {
      localRegisteredEvents.push({ event: event, cb: cb });
      if (typeof originalEventOn === 'function') {
        originalEventOn(event, cb);
      }
    };

    var originalEventOnce = window.eventOnce;
    window.eventOnce = function(event, cb) {
      var wrapper = function() {
        localRegisteredEvents = localRegisteredEvents.filter(function(item) {
          return item.cb !== wrapper;
        });
        cb.apply(this, arguments);
      };
      localRegisteredEvents.push({ event: event, cb: wrapper });
      if (typeof originalEventOnce === 'function') {
        originalEventOnce(event, wrapper);
      }
    };

    var originalEventRemoveListener = window.eventRemoveListener;
    window.eventRemoveListener = function(event, cb) {
      localRegisteredEvents = localRegisteredEvents.filter(function(item) {
        return !(item.event === event && item.cb === cb);
      });
      if (typeof originalEventRemoveListener === 'function') {
        originalEventRemoveListener(event, cb);
      }
    };

    window.eventClearAll = function() {
      localRegisteredEvents.forEach(function(item) {
        if (typeof originalEventRemoveListener === 'function') {
          originalEventRemoveListener(item.event, item.cb);
        }
      });
      localRegisteredEvents = [];
    };



    window.addEventListener('pagehide', function() {
      if (typeof window.eventClearAll === 'function') {
        window.eventClearAll();
      }
    });

    // ─── Step 3: notify bridge that iframe is ready ───
    // We use DOMContentLoaded (fires synchronously after all inline scripts run)
    // then add a 300ms delay to ensure the card script below has had time to
    // register its mag_variable_initialized listeners via eventOn().
    function notifyReady() {
      setTimeout(function() {
        if (typeof TavernHelper._onIframeReady === 'function') {
          TavernHelper._onIframeReady(window.__TH_IFRAME_ID || 'script_iframe');
        }
      }, 300);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      notifyReady();
    } else {
      document.addEventListener('DOMContentLoaded', notifyReady);
    }
  })();
</script>
</head>
<body>
<script>
// ─── Step 4: Card script (synchronous, so listeners are registered before DOMContentLoaded) ───
${cleanContent}
</script>
</body>
</html>`;

}

export function createMessageIframeSrcDoc(htmlContent: string): string {
  let processedHtml = htmlContent;
  
  // Preprocess any script tags in the HTML content to replace CDN imports with local TavernHelperMvuLibs lookups
  processedHtml = processedHtml.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs, scriptBody) => {
      if (/type\s*=\s*['"]module['"]/i.test(attrs) || /import\s+/.test(scriptBody)) {
        return `<script${attrs}>${preprocessScriptContent(scriptBody)}</script>`;
      }
      return match;
    }
  );

  const hasHtmlTag = /<html/i.test(processedHtml);

  const scriptInjects = `
<script>
  // ─── Inherit libraries from parent window (NO external CDN requests) ───
  window._ = window.parent._;
  window.Vue = window.parent.Vue || null;
  // ─── jQuery shim for message iframe ───
  // The parent window's $ is a minimal stub (no DOM selector support).
  // Message iframes need a real jQuery-compatible selector so that inline
  // scripts (e.g. tab switching via $("#tab1").show()) work against THIS
  // iframe's own document, not the parent's.
  (function() {
    // Try to borrow jQuery from the script iframe siblings (they load the
    // full mvu_bundle which may have attached a real jQuery to the parent).
    // Walk parent's child iframes looking for one with a proper jQuery.
    var realJQ = null;
    try {
      if (window.parent && window.parent.jQuery && window.parent.jQuery.fn && window.parent.jQuery.fn.jquery) {
        realJQ = window.parent.jQuery;
      }
    } catch(e1) {}
    if (!realJQ) {
      try {
        var frames = window.parent.document.querySelectorAll('iframe');
        for (var fi = 0; fi < frames.length; fi++) {
          try {
            var fw = frames[fi].contentWindow;
            if (fw && fw.jQuery && typeof fw.jQuery === 'function' && fw.jQuery.fn && fw.jQuery.fn.jquery) {
              realJQ = fw.jQuery;
              break;
            }
          } catch(e2) {}
        }
      } catch(e3) {}
    }

    if (realJQ) {
      console.info('[TH Message Iframe Debug] Successfully resolved real jQuery from parent/sibling.');
      // Bind real jQuery to this iframe's document so selectors search here
      window.$ = window.jQuery = function(selector, context) {
        if (typeof selector === 'function') {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', selector);
          } else {
            setTimeout(selector, 0);
          }
          return { on: function() { return window.$; }, trigger: function() { return window.$; } };
        }
        return realJQ(selector, context || window.document);
      };
      // Copy static jQuery methods
      for (var k in realJQ) {
        if (Object.prototype.hasOwnProperty.call(realJQ, k)) {
          try { window.$[k] = realJQ[k]; } catch(e) {}
        }
      }
      window.$.fn = realJQ.fn;
      window.$.event = realJQ.event;
    } else {
      console.warn('[TH Message Iframe Debug] Falling back to lightweight vanilla jQuery shim.');
      // Lightweight fallback: vanilla querySelector-based shim
      var makeResult = function(elements) {
        var arr = Array.prototype.slice.call(elements || []);
        arr.on = function(evt, sel, fn) {
          if (typeof sel === 'function') { fn = sel; sel = null; }
          arr.forEach(function(el) {
            if (sel) { el.addEventListener(evt, function(e) { if (e.target.matches && e.target.matches(sel)) fn.call(e.target, e); }); }
            else { el.addEventListener(evt, fn); }
          });
          return arr;
        };
        arr.click = function(fn) { return fn ? arr.on('click', fn) : (arr[0] && arr[0].click(), arr); };
        arr.show = function() { arr.forEach(function(el) { el.style.display = ''; }); return arr; };
        arr.hide = function() { arr.forEach(function(el) { el.style.display = 'none'; }); return arr; };
        arr.toggle = function(v) { arr.forEach(function(el) { el.style.display = (v === undefined ? (el.style.display === 'none' ? '' : 'none') : (v ? '' : 'none')); }); return arr; };
        arr.addClass = function(c) { arr.forEach(function(el) { el.classList.add.apply(el.classList, c.split(' ')); }); return arr; };
        arr.removeClass = function(c) { arr.forEach(function(el) { el.classList.remove.apply(el.classList, c.split(' ')); }); return arr; };
        arr.toggleClass = function(c, s) { arr.forEach(function(el) { el.classList.toggle(c, s); }); return arr; };
        arr.hasClass = function(c) { return arr.length > 0 && arr[0].classList.contains(c); };
        arr.attr = function(k, v) { if (v === undefined) return arr[0] && arr[0].getAttribute(k); arr.forEach(function(el) { el.setAttribute(k, v); }); return arr; };
        arr.val = function(v) { if (v === undefined) return arr[0] && arr[0].value; arr.forEach(function(el) { el.value = v; }); return arr; };
        arr.text = function(v) { if (v === undefined) return arr[0] && arr[0].textContent; arr.forEach(function(el) { el.textContent = v; }); return arr; };
        arr.html = function(v) { if (v === undefined) return arr[0] && arr[0].innerHTML; arr.forEach(function(el) { el.innerHTML = v; }); return arr; };
        arr.find = function(sel) { var found = []; arr.forEach(function(el) { found = found.concat(Array.prototype.slice.call(el.querySelectorAll(sel))); }); return makeResult(found); };
        arr.parent = function() { return makeResult(arr.map(function(el) { return el.parentElement; }).filter(Boolean)); };
        arr.children = function(sel) { var found = []; arr.forEach(function(el) { var ch = Array.prototype.slice.call(el.children); if (sel) ch = ch.filter(function(c) { return c.matches && c.matches(sel); }); found = found.concat(ch); }); return makeResult(found); };
        arr.first = function() { return makeResult(arr.slice(0, 1)); };
        arr.last = function() { return makeResult(arr.slice(-1)); };
        arr.each = function(fn) { arr.forEach(function(el, i) { fn.call(el, i, el); }); return arr; };
        arr.css = function(k, v) { if (typeof k === 'object') { arr.forEach(function(el) { Object.assign(el.style, k); }); return arr; } if (v === undefined) return arr[0] && getComputedStyle(arr[0])[k]; arr.forEach(function(el) { el.style[k] = v; }); return arr; };
        arr.data = function(k, v) { if (v === undefined) return arr[0] && arr[0].dataset[k]; arr.forEach(function(el) { el.dataset[k] = v; }); return arr; };
        arr.prop = function(k, v) { if (v === undefined) return arr[0] && arr[0][k]; arr.forEach(function(el) { el[k] = v; }); return arr; };
        arr.trigger = function(evt) { arr.forEach(function(el) { el.dispatchEvent(new Event(evt, { bubbles: true })); }); return arr; };
        arr.append = function(html) { arr.forEach(function(el) { if (typeof html === 'string') el.insertAdjacentHTML('beforeend', html); else el.appendChild(html instanceof Node ? html : (html[0] || html)); }); return arr; };
        arr.prepend = function(html) { arr.forEach(function(el) { if (typeof html === 'string') el.insertAdjacentHTML('afterbegin', html); else el.insertBefore(html instanceof Node ? html : (html[0] || html), el.firstChild); }); return arr; };
        arr.remove = function() { arr.forEach(function(el) { el.parentNode && el.parentNode.removeChild(el); }); return arr; };
        arr.length = elements ? elements.length : 0;
        return arr;
      };
      window.$ = window.jQuery = function(selector, context) {
        if (typeof selector === 'function') {
          if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', selector); }
          else { setTimeout(selector, 0); }
          return makeResult([]);
        }
        if (typeof selector === 'string') {
          var ctx = context instanceof Node ? context : ((context && context[0]) || window.document);
          try { return makeResult(ctx.querySelectorAll(selector)); } catch(e) { return makeResult([]); }
        }
        if (selector instanceof Node) return makeResult([selector]);
        if (selector && selector.length !== undefined) return makeResult(Array.prototype.slice.call(selector));
        return makeResult([]);
      };
      window.$.fn = {};
      window.$.ajax = function(opts) { return fetch(opts.url || opts, opts).then(function(r) { return r.text(); }).then(function(d) { opts.success && opts.success(d); }).catch(function(e) { opts.error && opts.error(e); }); };
      window.$.extend = function(a, b) { return Object.assign(a || {}, b || {}); };
    }
  })();
<\/script>
<script>
  // ─── TavernHelper predefine for message iframe ───
  (function() {
    var _ = window.parent._;
    var TavernHelper = window.parent.TavernHelper;
    if (!_) return;
    if (!TavernHelper) return;

    window.z = window.parent.z;
    window.YAML = window.parent.YAML;
    window.showdown = window.parent.showdown;
    window.toastr = window.parent.toastr;
    window.EjsTemplate = window.parent.EjsTemplate;
    window.TavernHelper = TavernHelper;
    window.tavern_events = window.parent.tavern_events;
    window.appendInexistentScriptButtons = window.parent.appendInexistentScriptButtons;
    window.getScriptButtons = window.parent.getScriptButtons;
    window.replaceScriptButtons = window.parent.replaceScriptButtons;
    window.getButtonEvent = window.parent.getButtonEvent;

    try {
      var result = _(window);
      result = result.merge(_.omit(TavernHelper, '_bind'));
      result = result.merge.apply(result,
        Object.entries(TavernHelper._bind || {}).map(function(entry) {
          var key = entry[0], value = entry[1];
          var obj = {};
          obj[key.replace('_', '')] = typeof value === 'function' ? value.bind(window) : value;
          return obj;
        })
      );
      result.value();
    } catch(e) {}

    Object.defineProperty(window, 'SillyTavern', {
      get: function() {
        var SillyTavern = window.parent.SillyTavern;
        return new Proxy(SillyTavern, {
          get: function(target, prop) {
            if (prop === 'getContext') {
              return function() {
                var parentContext = target.getContext();
                return new Proxy(parentContext, {
                  get: function(ctxTarget, ctxProp) {
                    if (ctxProp === 'writeExtensionField') {
                      return window._th_impl && window._th_impl.writeExtensionField;
                    }
                    return ctxTarget[ctxProp];
                  }
                });
              };
            }
            if (prop === 'writeExtensionField') {
              return window._th_impl && window._th_impl.writeExtensionField;
            }
            return target[prop];
          }
        });
      },
      configurable: true
    });

    if (_.has(window.parent, 'Mvu')) {
      Object.defineProperty(window, 'Mvu', {
        get: function() { return window.parent.Mvu; },
        set: function() {},
        configurable: true,
      });
    }

    function notifyReady() {
      setTimeout(function() {
        if (typeof TavernHelper._onIframeReady === 'function') {
          TavernHelper._onIframeReady(window.__TH_IFRAME_ID || 'message_iframe');
        }
      }, 300);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      notifyReady();
    } else {
      document.addEventListener('DOMContentLoaded', notifyReady);
    }
  })();
<\/script>
<script>
  // adjust_iframe_height.js implementation
  (function () {
    var scheduled = false;
    function measureAndPost() {
      scheduled = false;
      try {
        var body = document.body;
        if (!body) return;
        var height = body.scrollHeight;
        if (!Number.isFinite(height) || height <= 0) return;
        if (window.frameElement) {
          window.frameElement.style.height = height + 'px';
        }
      } catch (e) {}
    }
    function throttledMeasure() {
      if (!scheduled) {
        scheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(measureAndPost);
        } else {
          setTimeout(measureAndPost, 100);
        }
      }
    }
    window.addEventListener('load', throttledMeasure);
    window.addEventListener('resize', throttledMeasure);
    var observer = new MutationObserver(throttledMeasure);
    document.addEventListener('DOMContentLoaded', function() {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        throttledMeasure();
      }
    });
  })();
<\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    max-width: 100% !important;
    background: transparent !important;
  }
<\/style>
  `;

  if (hasHtmlTag) {
    let wrapped = processedHtml;
    if (/<head>/i.test(wrapped)) {
      wrapped = wrapped.replace(/<head>/i, `<head>${scriptInjects}`);
    } else if (/<html>/i.test(wrapped)) {
      wrapped = wrapped.replace(/<html>/i, `<html><head>${scriptInjects}</head>`);
    } else {
      wrapped = `${scriptInjects}${wrapped}`;
    }
    return wrapped;
  } else {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${scriptInjects}
</head>
<body>
  ${processedHtml}
</body>
</html>`;
  }
}

export function extractMvuCommands(text: string): { type: string; args: any[]; reason?: string }[] {
  const results: { type: string; args: any[]; reason?: string }[] = [];
  if (!text) return results;

  let i = 0;
  while (i < text.length) {
    const match = text.substring(i).match(/_\.(set|add|delete|remove|unset|assign|insert|move)\(/);
    if (!match || match.index === undefined) break;

    const commandType = match[1];
    const startIdx = i + match.index;
    const openParen = startIdx + match[0].length;
    
    let parenCount = 1;
    let inQuote = false;
    let quoteChar = "";
    let closeParen = -1;
    for (let j = openParen; j < text.length; j++) {
      const char = text[j];
      const prevChar = j > 0 ? text[j - 1] : "";
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
      }
      if (!inQuote) {
        if (char === '(') parenCount++;
        else if (char === ')') {
          parenCount--;
          if (parenCount === 0) {
            closeParen = j;
            break;
          }
        }
      }
    }

    if (closeParen === -1) {
      i = openParen;
      continue;
    }

    const paramsStr = text.substring(openParen, closeParen);
    const args = parseParamsString(paramsStr);

    let endPos = closeParen + 1;
    if (endPos < text.length && text[endPos] === ';') {
      endPos++;
    }
    let reason = "";
    const commentMatch = text.substring(endPos).match(/^\s*\/\/(.*)/);
    if (commentMatch) {
      reason = commentMatch[1].trim();
      endPos += commentMatch[0].length;
    }

    results.push({
      type: commandType,
      args,
      reason,
    });

    i = endPos;
  }

  return results;
}

function parseParamsString(paramsStr: string): any[] {
  const params: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let parenCount = 0;
  let bracketCount = 0;
  let braceCount = 0;

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    const prevChar = i > 0 ? paramsStr[i - 1] : "";

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (!inQuote) {
      if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
      else if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
    }

    if (char === ',' && !inQuote && parenCount === 0 && bracketCount === 0 && braceCount === 0) {
      params.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    params.push(current.trim());
  }

  return params.map(p => parseParamValue(p));
}

function parseParamValue(p: string): any {
  p = p.trim();
  if (p === "true") return true;
  if (p === "false") return false;
  if (p === "null") return null;
  if (p === "undefined") return undefined;

  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")) || (p.startsWith("`") && p.endsWith("`"))) {
    return p.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(p)) {
    return Number(p);
  }

  if ((p.startsWith("[") && p.endsWith("]")) || (p.startsWith("{") && p.endsWith("}"))) {
    try {
      return JSON5.parse(p);
    } catch {
      return p;
    }
  }

  return p;
}

function applyMvuCommand(statData: any, command: { type: string; args: any[]; reason?: string }) {
  if (!statData || !command.args || command.args.length === 0) return;
  
  let path = String(command.args[0]).trim();
  if (path.startsWith('"') || path.startsWith("'") || path.startsWith("`")) {
    path = path.slice(1, -1);
  }
  path = path.replace(/^(?:stat_data|status_current_variables)\./, '');

  const normalizedPath = path
    .replace(/\[['"`](.*?)['"`]\]/g, '.$1')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\.+/, '');

  switch (command.type) {
    case 'set': {
      const newValue = command.args.length >= 2 ? command.args[command.args.length - 1] : undefined;
      const current = _.get(statData, normalizedPath);
      if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string') {
        current[0] = newValue;
        _.set(statData, normalizedPath, current);
      } else {
        _.set(statData, normalizedPath, newValue);
      }
      break;
    }
    case 'add': {
      const delta = command.args.length >= 2 ? Number(command.args[1]) : 0;
      const current = _.get(statData, normalizedPath);
      if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string') {
        const num = Number(current[0]) || 0;
        current[0] = num + delta;
        _.set(statData, normalizedPath, current);
      } else {
        const num = Number(current) || 0;
        _.set(statData, normalizedPath, num + delta);
      }
      break;
    }
    case 'delete':
    case 'remove':
    case 'unset': {
      if (command.args.length === 1) {
        _.unset(statData, normalizedPath);
      } else {
        const target = _.get(statData, normalizedPath);
        const keyOrIdx = command.args[1];
        if (Array.isArray(target)) {
          const idx = Number(keyOrIdx);
          if (!isNaN(idx)) {
            target.splice(idx, 1);
          }
        } else if (target && typeof target === 'object') {
          delete target[keyOrIdx];
        }
      }
      break;
    }
    case 'assign':
    case 'insert': {
      const target = _.get(statData, normalizedPath);
      if (command.args.length === 2) {
        const val = command.args[1];
        if (Array.isArray(target)) {
          target.push(val);
        } else {
          _.set(statData, normalizedPath, val);
        }
      } else if (command.args.length >= 3) {
        const keyOrIdx = command.args[1];
        const val = command.args[2];
        if (Array.isArray(target)) {
          const idx = Number(keyOrIdx);
          if (!isNaN(idx)) {
            target.splice(idx, 0, val);
          } else {
            target.push(val);
          }
        } else if (target && typeof target === 'object') {
          target[keyOrIdx] = val;
        } else {
          _.set(statData, `${normalizedPath}.${keyOrIdx}`, val);
        }
      }
      break;
    }
    case 'move': {
      if (command.args.length >= 2) {
        const fromPath = normalizedPath;
        let toPath = String(command.args[1]).trim();
        if (toPath.startsWith('"') || toPath.startsWith("'") || toPath.startsWith("`")) {
          toPath = toPath.slice(1, -1);
        }
        toPath = toPath.replace(/^(?:stat_data|status_current_variables)\./, '');
        const normalizedToPath = toPath
          .replace(/\[['"`](.*?)['"`]\]/g, '.$1')
          .replace(/\[(\d+)\]/g, '.$1')
          .replace(/^\.+/, '');
        
        const val = _.get(statData, fromPath);
        _.unset(statData, fromPath);
        _.set(statData, normalizedToPath, val);
      }
      break;
    }
  }
}

export function parseMvuMessage(message: string, oldData: any): any {
  if (!oldData) return oldData;
  const newData = _.cloneDeep(oldData);
  const statData = newData.stat_data || newData;
  const commands = extractMvuCommands(message);
  for (const cmd of commands) {
    applyMvuCommand(statData, cmd);
  }
  return newData;
}
