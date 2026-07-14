/**
 * scriptIframe.ts — Iframe 沙盒 HTML 工厂
 *
 * 职责：
 * - createScriptIframeSrcDoc：构建完整的 MVU 脚本执行沙盒 HTML（含库注入、预定义桥接函数）
 * - createMessageIframeSrcDoc：为消息内嵌 HTML 构建安全沙盒（含 jQuery shim、高度自适应）
 *
 * ESM CDN 替换逻辑已拆至 esmReplacer.ts；
 * 脚本预处理与懒求值缓存已拆至 scriptPreprocessor.ts。
 * 遵循 AGENTS.md 准则一.6（单文件职责边界拆分）。
 */

import { getProcessedMvuZod, getProcessedMvu, getProcessedMvuBundle, preprocessScriptContent } from "./scriptPreprocessor";

// ─────────────────────             ─────────────────────────────────────────────────────────
// 脚本执行沙盒 Iframe HTML 生成
// ──────────────────────────────────────────────────────────────────────────────

export function createScriptIframeSrcDoc(scriptContent: string, scriptId: string, enableLoopProtection = true): string {
  const processedMvuZod    = getProcessedMvuZod();
  const processedMvu        = getProcessedMvu();
  const processedMvuBundle  = getProcessedMvuBundle();

  // 开发模式下验证是否有未替换的 CDN import 残留
  if (import.meta.env.DEV) {
    const unresolvedImports = processedMvuBundle.match(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g);
    if (unresolvedImports) {
      console.log("[TH Bridge] 未替换的 CDN import：", unresolvedImports);
    }
  }

  const cleanContent = preprocessScriptContent(
    scriptContent.replace(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/i, "$1"),
    enableLoopProtection
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
  // Debug 日志仅在开发模式输出，生产环境静默（error 始终保留）
  var __TH_DEBUG = ${import.meta.env.DEV ? 'true' : 'false'};
  var __thLog = __TH_DEBUG ? console.log.bind(console) : function(){};
  var __thWarn = __TH_DEBUG ? console.warn.bind(console) : function(){};
  // ─── Step 1: inherit libraries from parent window (NO external CDN requests) ───
  // This avoids network slowdowns/errors when developer proxy blocks CDN domains.
  window._ = window.parent._;
  window.Vue = window.parent.Vue || null;
  // Inherit jQuery: wrap parent $ to search parent document instead of iframe document
  // This is critical for MVU bundle's listenPreferenceState which uses $('#tavern_helper')
  // to find script elements - those elements exist in the parent window, not the iframe.
  var parentDollar = window.parent.$ || window.parent.jQuery;
  __thLog('[TH Bridge Debug] Step 1 - parent.$ available:', !!parentDollar);
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
    __thLog('[TH Bridge Debug] Step 1 - jQuery wrapper created');
    // Test jQuery wrapper
    try {
      var testResult = window.$('#tavern_helper');
      __thLog('[TH Bridge Debug] Step 1 - jQuery test #tavern_helper found:', testResult.length, 'elements');
      if (testResult.length > 0) {
        __thLog('[TH Bridge Debug] Step 1 - First element tag:', testResult[0].tagName);
      }
      // Also test direct parent $ call
      var directResult = parentDollar('#tavern_helper', window.parent.document);
      __thLog('[TH Bridge Debug] Step 1 - Direct parent.$ test found:', directResult.length, 'elements');
    } catch(e) {
      console.error('[TH Bridge Debug] Step 1 - jQuery test failed:', e);
    }
  } else {
    window.$ = window.jQuery = null;
    __thWarn('[TH Bridge Debug] Step 1 - parent.$ not available!');
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
    __thLog('[TH Bridge Debug] Step 1 - TavernHelper available:', !!TH);
    __thLog('[TH Bridge Debug] Step 1 - TH._bind available:', !!(TH && TH._bind));
    if (!TH || !TH._bind) {
      __thWarn('[TH Bridge Debug] Step 1 - TH._bind not available, MVU functions will not be pre-defined');
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
      'fetch': '_fetch',
      'errorCatched': '_errorCatched'
    };
    var definedCount = 0;
    for (var name in funcMap) {
      (function(n, bk) {
        if (typeof bind[bk] === 'function') {
          window[n] = function() {
            var args = Array.prototype.slice.call(arguments);
            if (n === 'getCurrentMessageId' && args.length === 0) {
              args.push(window.__TH_MESSAGE_ID);
            } else if (n === 'getVariables' || n === 'replaceVariables') {
              if (window.__TH_MESSAGE_ID !== undefined) {
                if (args.length === 0) {
                  args.push({ type: 'message', message_id: window.__TH_MESSAGE_ID });
                } else if (args[0] && (args[0].type === 'chat' || args[0].type === 'message' || args[0].type === undefined)) {
                  args[0].type = 'message';
                  if (args[0].message_id === undefined) {
                    args[0].message_id = window.__TH_MESSAGE_ID;
                  }
                }
              }
            } else if (n === 'setChatMessage' && args.length > 0 && (args[0] === undefined || args[0] === null || isNaN(Number(args[0])))) {
              args[0] = window.__TH_MESSAGE_ID;
            }
            return bind[bk].apply(bind, args);
          };
          definedCount++;
        }
      })(name, funcMap[name]);
    }
    __thLog('[TH Bridge Debug] Step 1 - Defined', definedCount, 'MVU functions');
    __thLog('[TH Bridge Debug] Step 1 - getScriptId available:', typeof window.getScriptId === 'function');
    if (typeof window.getScriptId === 'function') {
      __thLog('[TH Bridge Debug] Step 1 - getScriptId() returns:', window.getScriptId());
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

    // Dynamic getters to resolve parent libraries on demand
    var parentLibs = ['_', 'lodash', 'z', 'YAML', 'showdown', 'toastr', 'EjsTemplate', 'TavernHelper', 'tavern_events', 'appendInexistentScriptButtons', 'getScriptButtons', 'replaceScriptButtons', 'getButtonEvent'];
    parentLibs.forEach(function(p) {
      Object.defineProperty(window, p, {
        get: function() {
          var val = window.parent[p === 'lodash' ? '_' : p];
          if (p === 'TavernHelper' && val) {
            return new Proxy(val, {
              get: function(target, prop) {
                if (typeof window[prop] === 'function') {
                  return window[prop];
                }
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
                var val2 = target[prop];
                if (typeof val2 === 'function') {
                  return val2.bind(target);
                }
                return val2;
              }
            });
          }
          return val;
        },
        configurable: true
      });
    });

    var keys = [
      'getScriptId', 'getCurrentMessageId', 'getVariables', 'getAllVariables',
      'replaceVariables', 'getSetting', 'setSetting', 'getChatSession',
      'getChatHistory', 'setChatMessage', 'addChatMessage', 'sendSystemMessage',
      'getCharacterBook', 'addCharacterBookEntry', 'updateCharacterBookEntry',
      'getCharacterExpressions', 'addCharacterExpression', 'updateCharacterExpression',
      'getMvuSchema', 'registerMvuSchema', 'getMvuVariables', 'updateMvuVariables',
      'waitGlobalInitialized', 'errorCatched',
      'updateVariablesWith', 'insertOrAssignVariables', 'deleteVariable',
      'getCurrentChatId', 'saveChat', 'saveSettingsDebounced', 'callGenericPopup',
      'getTavernHelperVersion', 'getScriptButtons', 'replaceScriptButtons',
      'appendInexistentScriptButtons', 'getButtonEvent', 'showHelpPopup',
      'setChatMessages', 'getChatMessages', 'getLastMessageId', 'getCharLorebooks',
      'getCharWorldbookNames', 'getCurrentCharPrimaryLorebook', 'getLorebookEntries',
      'getLorebookSettings', 'setLorebookSettings', 'setExtraAnalysisStates',
      'normalizeBaseURL', 'generate', 'generateRaw', 'isToolCallingSupported',
      'registerFunctionTool', 'unregisterFunctionTool', 'fetch'
    ];
    keys.forEach(function(ck) {
      Object.defineProperty(window, ck, {
        get: function() {
          var parentTH = window.parent.TavernHelper;
          var bind = parentTH && parentTH._bind;
          var bk = '_' + ck;
          if (!bind || typeof bind[bk] !== 'function') {
            return function() { return {}; };
          }
          return function() {
            var args = Array.prototype.slice.call(arguments);
            return bind[bk].apply(bind, args);
          };
        },
        configurable: true
      });
    });

    // Intercept event emitter bindings on iframe window to track listeners locally for cleanup and auto-forwarding
    var localRegisteredEvents = [];

    window.eventOn = function(event, cb) {
      localRegisteredEvents.push({ type: 'on', event: event, cb: cb, bound: false });
      flushEvents();
    };

    window.eventOnce = function(event, cb) {
      var wrapper = function() {
        localRegisteredEvents = localRegisteredEvents.filter(function(item) {
          return item.cb !== wrapper;
        });
        cb.apply(this, arguments);
      };
      localRegisteredEvents.push({ type: 'once', event: event, cb: wrapper, bound: false });
      flushEvents();
    };

    window.eventRemoveListener = function(event, cb) {
      localRegisteredEvents = localRegisteredEvents.filter(function(item) {
        return !(item.event === event && item.cb === cb);
      });
      var parentTH = window.parent.TavernHelper;
      var bind = parentTH && parentTH._bind;
      if (bind && typeof bind._eventRemoveListener === 'function') {
        try { bind._eventRemoveListener(event, cb); } catch(e) {}
      }
    };

    window.eventClearAll = function() {
      var parentTH = window.parent.TavernHelper;
      var bind = parentTH && parentTH._bind;
      localRegisteredEvents.forEach(function(item) {
        if (item.bound && bind && typeof bind._eventRemoveListener === 'function') {
          try { bind._eventRemoveListener(item.event, item.cb); } catch(e) {}
        }
      });
      localRegisteredEvents = [];
    };

    function flushEvents() {
      try {
        var parentTH = window.parent.TavernHelper;
        var bind = parentTH && parentTH._bind;
        if (!bind) return;
        localRegisteredEvents.forEach(function(item) {
          if (item.bound) return;
          if (item.type === 'on' && typeof bind._eventOn === 'function') {
            bind._eventOn(item.event, item.cb);
            item.bound = true;
          } else if (item.type === 'once' && typeof bind._eventOnce === 'function') {
            bind._eventOnce(item.event, item.cb);
            item.bound = true;
          }
        });
      } catch (err) {
        console.warn("[TH Iframe] Event flush error:", err);
      }
    }

    // Periodically poll to flush queued events once parent is fully initialized
    var flushInterval = setInterval(flushEvents, 100);

    // Android WebView 中 pagehide 可能不触发，同时注册 beforeunload 兜底清理
    var __cleanupInterval = function() {
      clearInterval(flushInterval);
      if (typeof window.eventClearAll === 'function') {
        window.eventClearAll();
      }
    };
    window.addEventListener('pagehide', __cleanupInterval);
    window.addEventListener('beforeunload', __cleanupInterval);

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
<\/script>
<\/head>
<body>
<script>
// ─── Step 3.5: Wrap window.defineMvuDataStore (set by mvu.js) to sync initial Pinia state back ───
// mvu.js sets window.defineMvuDataStore in Step 1.5. The card script calls it to create a Pinia
// store whose setup function runs schema.parse(getVariables()). With Fix X2 (zodMock), parse({})
// now returns correct defaults. This wrapper intercepts the call AFTER Pinia initializes the store
// and writes the resulting stat_data back into the parent's session.variables so that:
// 1. Future getVariables() calls return the correct defaults (needed for AI reply delta ops)
// 2. mag_variable_initialized events carry meaningful data
(function() {
  if (typeof window.defineMvuDataStore !== 'function') return;
  var __origDefineMvu = window.defineMvuDataStore;
  window.defineMvuDataStore = function(storeId, setupFn) {
    var storeFactory = __origDefineMvu(storeId, setupFn);
    try {
      // Call the store factory to trigger Pinia setup (runs schema.parse(getVariables()))
      var store = typeof storeFactory === 'function' ? storeFactory() : storeFactory;
      if (store) {
        // Extract state: try common patterns (store.data.value, store.$state, store itself)
        var rawData = null;
        if (store.data && store.data.value !== undefined) {
          rawData = store.data.value;
        } else if (store.$state) {
          rawData = store.$state;
        } else if (store.data) {
          rawData = store.data;
        }
        if (rawData && typeof rawData === 'object') {
          var TH = window.parent && window.parent.TavernHelper;
          var bind = TH && TH._bind;
          if (bind && typeof bind._getVariables === 'function' && typeof bind._replaceVariables === 'function') {
            var currentVars = bind._getVariables({ type: 'chat' }) || {};
            var currentStatData = currentVars.stat_data || {};
            var initStatData = rawData.stat_data || rawData;
            // Merge strategy: existing session values take priority (preserve saves), fill missing with schema defaults
            var mergedStatData = Object.assign({}, initStatData, currentStatData);
            var hasNewKeys = Object.keys(mergedStatData).length > Object.keys(currentStatData).length;
            if (hasNewKeys) {
              var mergedVars = Object.assign({}, currentVars, { stat_data: mergedStatData });
              bind._replaceVariables(mergedVars, { type: 'chat' });
              console.log('[TH Bridge Step 3.5] defineMvuDataStore "' + storeId + '" synced ' + Object.keys(mergedStatData).length + ' keys to session.variables');
            }
          }
        }
      }
    } catch(syncErr) {
      console.warn('[TH Bridge Step 3.5] defineMvuDataStore sync error for "' + storeId + '":', syncErr);
    }
    return storeFactory;
  };
})();
<\/script>
<script>
// ─── Step 4: Card script (synchronous, so listeners are registered before DOMContentLoaded) ───
${cleanContent}
<\/script>
<\/body>
<\/html>`;

}


// ──────────────────────────────────────────────────────────────────────────────
// 消息内嵌 HTML 沙盒生成（含 jQuery shim、高度自适应）
// ──────────────────────────────────────────────────────────────────────────────

export function createMessageIframeSrcDoc(htmlContent: string, messageIndex?: number, enableLoopProtection = true): string {
  let processedHtml = htmlContent;

  // Preprocess any script tags in the HTML content to replace CDN imports with local TavernHelperMvuLibs lookups
  processedHtml = processedHtml.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs, scriptBody) => {
      return `<script${attrs}>${preprocessScriptContent(scriptBody, enableLoopProtection)}</script>`;
    }
  );

  // 从父窗口读取 --card 背景色，硬编码到 iframe 中。
  // 比使用 var(--card) 更可靠，避免 CSS 变量同步延迟导致的初始白屏/白边。
  let cardBgColor = "transparent";
  try {
    if (typeof window !== "undefined" && window.document) {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const cardVal = rootStyle.getPropertyValue("--card").trim();
      if (cardVal) {
        cardBgColor = cardVal;
      }
    }
  } catch (e) {}

  const hasHtmlTag = /<html|<head|<body/i.test(processedHtml);

  const scriptInjects = `
<script>
  window.__TH_MESSAGE_ID = ${messageIndex !== undefined ? messageIndex : 'undefined'};
  var __TH_DEBUG = ${import.meta.env.DEV ? 'true' : 'false'};
  var __thLog = __TH_DEBUG ? console.log.bind(console) : function(){};
  var __thWarn = __TH_DEBUG ? console.warn.bind(console) : function(){};
</script>
<script>
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
      __thLog('[TH Message Iframe Debug] Successfully resolved real jQuery from parent/sibling.');
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
      __thWarn('[TH Message Iframe Debug] Falling back to lightweight vanilla jQuery shim.');
      // Lightweight fallback: vanilla querySelector-based shim
      var makeResult = function(elements) {
        var arr = Array.prototype.slice.call(elements || []);
        arr.on = function(evt, sel, fn) {
          if (typeof sel === 'function') { fn = sel; sel = null; }
          arr.forEach(function(el) {
            if (sel) {
              el.addEventListener(evt, function(e) {
                var matchedEl = e.target.closest && e.target.closest(sel);
                if (matchedEl && el.contains(matchedEl)) {
                  fn.call(matchedEl, e);
                }
              });
            }
            else { el.addEventListener(evt, fn); }
          });
          return arr;
        };
        arr.off = function() { return arr; };
        arr.click = function(fn) { return fn ? arr.on('click', fn) : (arr[0] && arr[0].click(), arr); };
        arr.show = function() { arr.forEach(function(el) { el.style.display = ''; }); return arr; };
        arr.hide = function() { arr.forEach(function(el) { el.style.display = 'none'; }); return arr; };
        arr.toggle = function(v) { arr.forEach(function(el) { el.style.display = (v === undefined ? (el.style.display === 'none' ? '' : 'none') : (v ? '' : 'none')); }); return arr; };
        arr.addClass = function(c) { arr.forEach(function(el) { el.classList.add.apply(el.classList, c.split(' ')); }); return arr; };
        arr.removeClass = function(c) { arr.forEach(function(el) { el.classList.remove.apply(el.classList, c.split(' ')); }); return arr; };
        arr.toggleClass = function(c, s) { arr.forEach(function(el) { el.classList.toggle(c, s); }); return arr; };
        arr.hasClass = function(c) { return arr.length > 0 && arr[0].classList.contains(c); };
        arr.is = function(sel) {
          if (!sel) return false;
          if (typeof sel === 'string') {
            if (sel === ':visible') {
              return arr.some(function(el) {
                return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
              });
            }
            if (sel === ':hidden') {
              return arr.some(function(el) {
                return !(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
              });
            }
            return arr.some(function(el) { return el.matches && el.matches(sel); });
          }
          if (sel instanceof Node) {
            return arr.some(function(el) { return el === sel; });
          }
          return false;
        };
        arr.filter = function(sel) {
          if (typeof sel === 'string') {
            if (sel === ':visible') {
              return makeResult(arr.filter(function(el) {
                return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
              }));
            }
            if (sel === ':hidden') {
              return makeResult(arr.filter(function(el) {
                return !(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
              }));
            }
            return makeResult(arr.filter(function(el) { return el.matches && el.matches(sel); }));
          }
          if (typeof sel === 'function') {
            return makeResult(arr.filter(function(el, i) { return sel.call(el, i, el); }));
          }
          return arr;
        };
        arr.attr = function(k, v) { if (v === undefined) return arr[0] && arr[0].getAttribute(k); arr.forEach(function(el) { el.setAttribute(k, v); }); return arr; };
        arr.val = function(v) { if (v === undefined) return arr[0] && arr[0].value; arr.forEach(function(el) { el.value = v; }); return arr; };
        arr.text = function(v) { if (v === undefined) return arr[0] && arr[0].textContent; arr.forEach(function(el) { el.textContent = v; }); return arr; };
        arr.html = function(v) { if (v === undefined) return arr[0] && arr[0].innerHTML; arr.forEach(function(el) { el.innerHTML = v; }); return arr; };
        arr.fadeIn = function(speed, callback) {
          if (typeof speed === 'function') { callback = speed; speed = 400; }
          var duration = typeof speed === 'number' ? speed : (speed === 'fast' ? 200 : 400);
          arr.forEach(function(el) {
            el.style.display = '';
            el.style.transition = 'opacity ' + duration + 'ms ease';
            el.style.opacity = '0';
            el.offsetHeight; // Force reflow
            el.style.opacity = '1';
            if (callback) { setTimeout(function() { callback.call(el); }, duration); }
          });
          return arr;
        };
        arr.fadeOut = function(speed, callback) {
          if (typeof speed === 'function') { callback = speed; speed = 400; }
          var duration = typeof speed === 'number' ? speed : (speed === 'fast' ? 200 : 400);
          arr.forEach(function(el) {
            el.style.transition = 'opacity ' + duration + 'ms ease';
            el.style.opacity = '0';
            setTimeout(function() {
              el.style.display = 'none';
              if (callback) callback.call(el);
            }, duration);
          });
          return arr;
        };
        arr.fadeToggle = function(speed, callback) {
          arr.forEach(function(el) {
            var isHidden = el.style.display === 'none' || !(el.offsetWidth || el.offsetHeight);
            if (isHidden) { makeResult([el]).fadeIn(speed, callback); }
            else { makeResult([el]).fadeOut(speed, callback); }
          });
          return arr;
        };
        arr.slideDown = function(speed, callback) {
          if (typeof speed === 'function') { callback = speed; speed = 400; }
          arr.forEach(function(el) {
            el.style.display = '';
            if (callback) callback.call(el);
          });
          return arr;
        };
        arr.slideUp = function(speed, callback) {
          if (typeof speed === 'function') { callback = speed; speed = 400; }
          arr.forEach(function(el) {
            el.style.display = 'none';
            if (callback) callback.call(el);
          });
          return arr;
        };
        arr.slideToggle = function(speed, callback) {
          arr.forEach(function(el) {
            var isHidden = el.style.display === 'none' || !(el.offsetWidth || el.offsetHeight);
            if (isHidden) { makeResult([el]).slideDown(speed, callback); }
            else { makeResult([el]).slideUp(speed, callback); }
          });
          return arr;
        };
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
        // jQuery .load(url, [data], [complete]) - 通过 AJAX 加载内容并插入到匹配元素
        // 用于角色卡状态栏模板：$('body').load('状态栏/index.html')
        arr.load = function(url, data, complete) {
          if (typeof data === 'function') { complete = data; data = null; }
          var urlStr = String(url || '');
          // 支持 "url #selector" 语法，只提取匹配 selector 的部分
          var selector = null;
          var spaceIdx = urlStr.indexOf(' ');
          if (spaceIdx > 0) {
            selector = urlStr.slice(spaceIdx + 1).trim();
            urlStr = urlStr.slice(0, spaceIdx).trim();
          }
          arr.forEach(function(el) {
            fetch(urlStr)
              .then(function(res) { return res.text(); })
              .then(function(htmlText) {
                if (selector) {
                  // 解析返回的 HTML，只提取匹配 selector 的元素内容
                  var tmp = document.createElement('div');
                  tmp.innerHTML = htmlText;
                  var found = tmp.querySelector(selector);
                  el.innerHTML = found ? found.innerHTML : '';
                } else {
                  el.innerHTML = htmlText;
                }
                // 执行加载内容中的 <script> 标签
                var scripts = el.querySelectorAll('script');
                scripts.forEach(function(oldScript) {
                  var newScript = document.createElement('script');
                  for (var i = 0; i < oldScript.attributes.length; i++) {
                    newScript.setAttribute(oldScript.attributes[i].name, oldScript.attributes[i].value);
                  }
                  newScript.textContent = oldScript.textContent;
                  oldScript.parentNode.replaceChild(newScript, oldScript);
                });
                if (complete) { complete.call(el, null, 'success'); }
              })
              .catch(function(err) {
                __thWarn('[TH Message Iframe] .load() failed for', urlStr, err);
                if (complete) { complete.call(el, err, 'error'); }
              });
          });
          return arr;
        };
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
    // Dynamic getters to resolve parent libraries on demand (including Vue)
    var parentLibs = ['_', 'lodash', 'z', 'YAML', 'showdown', 'toastr', 'EjsTemplate', 'TavernHelper', 'tavern_events', 'appendInexistentScriptButtons', 'getScriptButtons', 'replaceScriptButtons', 'getButtonEvent', 'Vue'];
    parentLibs.forEach(function(p) {
      Object.defineProperty(window, p, {
        get: function() {
          var val = window.parent[p === 'lodash' ? '_' : p];
          if (p === 'TavernHelper' && val) {
            return new Proxy(val, {
              get: function(target, prop) {
                if (typeof window[prop] === 'function') {
                  return window[prop];
                }
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
                var val2 = target[prop];
                if (typeof val2 === 'function') {
                  return val2.bind(target);
                }
                return val2;
              }
            });
          }
          return val;
        },
        configurable: true
      });
    });

    var keys = [
      'getScriptId', 'getCurrentMessageId', 'getVariables', 'getAllVariables',
      'replaceVariables', 'getSetting', 'setSetting', 'getChatSession',
      'getChatHistory', 'setChatMessage', 'addChatMessage', 'sendSystemMessage',
      'getCharacterBook', 'addCharacterBookEntry', 'updateCharacterBookEntry',
      'getCharacterExpressions', 'addCharacterExpression', 'updateCharacterExpression',
      'getMvuSchema', 'registerMvuSchema', 'getMvuVariables', 'updateMvuVariables',
      'waitGlobalInitialized', 'errorCatched',
      'updateVariablesWith', 'insertOrAssignVariables', 'deleteVariable',
      'getCurrentChatId', 'saveChat', 'saveSettingsDebounced', 'callGenericPopup',
      'getTavernHelperVersion', 'getScriptButtons', 'replaceScriptButtons',
      'appendInexistentScriptButtons', 'getButtonEvent', 'showHelpPopup',
      'setChatMessages', 'getChatMessages', 'getLastMessageId', 'getCharLorebooks',
      'getCharWorldbookNames', 'getCurrentCharPrimaryLorebook', 'getLorebookEntries',
      'getLorebookSettings', 'setLorebookSettings', 'setExtraAnalysisStates',
      'normalizeBaseURL', 'generate', 'generateRaw', 'isToolCallingSupported',
      'registerFunctionTool', 'unregisterFunctionTool', 'fetch'
    ];
    keys.forEach(function(ck) {
      Object.defineProperty(window, ck, {
        get: function() {
          var parentTH = window.parent.TavernHelper;
          var bind = parentTH && parentTH._bind;
          var bk = '_' + ck;
          if (!bind || typeof bind[bk] !== 'function') {
            return function() { return {}; };
          }
          return function() {
            var args = Array.prototype.slice.call(arguments);
            if (ck === 'getCurrentMessageId' && args.length === 0) {
              args.push(window.__TH_MESSAGE_ID);
            } else if (ck === 'getVariables' || ck === 'replaceVariables') {
              if (window.__TH_MESSAGE_ID !== undefined) {
                if (args.length === 0) {
                  args.push({ type: 'message', message_id: window.__TH_MESSAGE_ID });
                } else if (args[0] && (args[0].type === 'chat' || args[0].type === 'message' || args[0].type === undefined)) {
                  args[0].type = 'message';
                  if (args[0].message_id === undefined) {
                    args[0].message_id = window.__TH_MESSAGE_ID;
                  }
                }
              }
            } else if (ck === 'setChatMessage' && args.length > 0 && (args[0] === undefined || args[0] === null || isNaN(Number(args[0])))) {
              args[0] = window.__TH_MESSAGE_ID;
            }
            return bind[bk].apply(bind, args);
          };
        },
        configurable: true
      });
    });

    // ─── SillyTavern 命令全局函数代理 ───
    // 角色卡脚本常以裸函数形式调用 triggerSlash（如 typeof triggerSlash === 'function'），
    // 但 triggerSlash 实际挂在 window.parent.TavernHelper 上。
    // 此处将其暴露为 iframe 顶层全局，使卡片脚本无需显式引用 TavernHelper 即可调用。
    var slashCommands = ['triggerSlash', 'triggerSlashWithResult', 'substitudeMacros'];
    slashCommands.forEach(function(fn) {
      Object.defineProperty(window, fn, {
        get: function() {
          var parentTH = window.parent.TavernHelper;
          if (parentTH && typeof parentTH[fn] === 'function') {
            return parentTH[fn].bind(parentTH);
          }
          return undefined;
        },
        configurable: true
      });
    });

    // Intercept event emitter bindings on iframe window to track listeners locally for cleanup and auto-forwarding
    var localRegisteredEvents = [];

    window.eventOn = function(event, cb) {
      localRegisteredEvents.push({ type: 'on', event: event, cb: cb, bound: false });
      flushEvents();
    };

    window.eventOnce = function(event, cb) {
      var wrapper = function() {
        localRegisteredEvents = localRegisteredEvents.filter(function(item) {
          return item.cb !== wrapper;
        });
        cb.apply(this, arguments);
      };
      localRegisteredEvents.push({ type: 'once', event: event, cb: wrapper, bound: false });
      flushEvents();
    };

    window.eventRemoveListener = function(event, cb) {
      localRegisteredEvents = localRegisteredEvents.filter(function(item) {
        return !(item.event === event && item.cb === cb);
      });
      var parentTH = window.parent.TavernHelper;
      var bind = parentTH && parentTH._bind;
      if (bind && typeof bind._eventRemoveListener === 'function') {
        try { bind._eventRemoveListener(event, cb); } catch(e) {}
      }
    };

    window.eventClearAll = function() {
      var parentTH = window.parent.TavernHelper;
      var bind = parentTH && parentTH._bind;
      localRegisteredEvents.forEach(function(item) {
        if (item.bound && bind && typeof bind._eventRemoveListener === 'function') {
          try { bind._eventRemoveListener(item.event, item.cb); } catch(e) {}
        }
      });
      localRegisteredEvents = [];
    };

    function flushEvents() {
      try {
        var parentTH = window.parent.TavernHelper;
        var bind = parentTH && parentTH._bind;
        if (!bind) return;
        localRegisteredEvents.forEach(function(item) {
          if (item.bound) return;
          if (item.type === 'on' && typeof bind._eventOn === 'function') {
            bind._eventOn(item.event, item.cb);
            item.bound = true;
          } else if (item.type === 'once' && typeof bind._eventOnce === 'function') {
            bind._eventOnce(item.event, item.cb);
            item.bound = true;
          }
        });
      } catch (err) {
        console.warn("[TH Message Iframe] Event flush error:", err);
      }
    }

    // Periodically poll to flush queued events once parent is fully initialized
    var flushInterval = setInterval(flushEvents, 100);

    Object.defineProperty(window, 'SillyTavern', {
      get: function() {
        var SillyTavern = window.parent.SillyTavern;
        if (!SillyTavern) return undefined;
        return new Proxy(SillyTavern, {
          get: function(target, prop) {
            if (prop === 'getContext') {
              return function() {
                var parentContext = target.getContext();
                if (!parentContext) return undefined;
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
            var val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });
      },
      configurable: true
    });

    Object.defineProperty(window, 'Mvu', {
      get: function() { return window.parent.Mvu; },
      set: function() {},
      configurable: true,
    });

    var __cleanupMsgInterval = function() {
      clearInterval(flushInterval);
      if (typeof window.eventClearAll === 'function') {
        window.eventClearAll();
      }
    };
    window.addEventListener('pagehide', __cleanupMsgInterval);
    window.addEventListener('beforeunload', __cleanupMsgInterval);

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
    var heightInitialized = false;
    function measureAndPost() {
      scheduled = false;
      try {
        var container = document.getElementById('th-iframe-wrapper') || document.body;
        if (!container) return;
        
        var isWrapper = container.id === 'th-iframe-wrapper';
        var height;
        // 优先使用 getBoundingClientRect 获取精确小数高度，避免 offsetHeight 取整造成的误差
        if (isWrapper && typeof container.getBoundingClientRect === 'function') {
          var rect = container.getBoundingClientRect();
          height = rect.height;
        } else {
          height = isWrapper ? container.offsetHeight : container.scrollHeight;
        }
        
        if (!Number.isFinite(height) || height <= 0) return;
        if (window.frameElement) {
          var currentHeight = window.frameElement.style.height;
          // 使用 Math.ceil 向上取整，确保内容完全容纳，不留底部裁剪线
          // 移除了之前的 +1px 余量，因为 getBoundingClientRect 已包含完整高度
          var newHeightStr = Math.ceil(height) + 'px';
          // 仅当高度发生真实改变时，才执行 DOM 写入，防范过度重排
          if (currentHeight !== newHeightStr) {
            window.frameElement.style.height = newHeightStr;
          }
          // 高度自适应首次成功后，锁定 overflow:hidden 防止出现滚动条
          if (!heightInitialized && document.body) {
            document.body.style.overflow = 'hidden';
            heightInitialized = true;
          }
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

    // 兜底：若 1.5s 后高度仍为 0 或极小（ResizeObserver 失败/图片懒加载未完成），恢复 overflow:auto 防止内容被静默裁剪
    setTimeout(function() {
      try {
        if (window.frameElement && !heightInitialized) {
          var h = parseInt(window.frameElement.style.height, 10) || 0;
          if (h < 10 && document.body) {
            document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';
          }
        }
      } catch(e) {}
    }, 1500);

    // 优先使用 ResizeObserver 监听 DOM 物理尺寸变化（能完美同步 CSS 过渡/折叠动画每一帧的高度）
    if (typeof ResizeObserver === 'function') {
      var resizeObserver = new ResizeObserver(throttledMeasure);
      document.addEventListener('DOMContentLoaded', function() {
        var el = document.getElementById('th-iframe-wrapper') || document.body;
        if (el) {
          resizeObserver.observe(el);
          throttledMeasure();
        }
      });
      // 遵循 AGENTS.md 准则十.4（彻底回收）：iframe 卸载时断开 observer，防止内存泄漏
      var __cleanupResize = function() {
        try { resizeObserver.disconnect(); } catch(e) {}
      };
      window.addEventListener('pagehide', __cleanupResize);
      window.addEventListener('beforeunload', __cleanupResize);
    } else {
      // 降级使用 MutationObserver
      var observer = new MutationObserver(throttledMeasure);
      document.addEventListener('DOMContentLoaded', function() {
        var el = document.getElementById('th-iframe-wrapper') || document.body;
        if (el) {
          observer.observe(el, { childList: true, subtree: true, attributes: true });
          throttledMeasure();
        }
      });
      // 遵循 AGENTS.md 准则十.4（彻底回收）：iframe 卸载时断开 observer，防止内存泄漏
      var __cleanupMutation = function() {
        try { observer.disconnect(); } catch(e) {}
      };
      window.addEventListener('pagehide', __cleanupMutation);
      window.addEventListener('beforeunload', __cleanupMutation);
    }
  })();
</script>
<script>
  // ─── Theme / CSS variables synchronization from parent to iframe ───
  (function() {
    var syncTimer = null;
    function syncTheme() {
      try {
        if (!window.parent) return;
        var pDoc = window.parent.document;
        if (!pDoc) return;
        // 1. 同步父级 documentElement 全部类名（覆盖 dark + Snow/Sand/Ocean 等主题切换类）
        document.documentElement.className = pDoc.documentElement.className;
        // 2. 同步 CSS 变量（扩展：圆角、字体、语义色、chart 色板）
        var ps = window.parent.getComputedStyle(pDoc.documentElement);
        var vars = [
          '--background','--foreground','--card','--card-foreground','--popover','--popover-foreground',
          '--primary','--primary-foreground','--secondary','--secondary-foreground','--muted','--muted-foreground',
          '--accent','--accent-foreground','--destructive','--destructive-foreground','--border','--input','--ring',
          '--radius','--radius-sm','--radius-md','--radius-lg','--radius-xl',
          '--font-sans','--font-mono','--font-serif','--success','--warning','--info',
          '--sidebar','--sidebar-foreground','--chart-1','--chart-2','--chart-3','--chart-4','--chart-5'
        ];
        vars.forEach(function(v) {
          var val = ps.getPropertyValue(v);
          if (val) document.documentElement.style.setProperty(v, val);
        });
        // 2.5 直接设置 html 背景色（内联样式优先级最高，确保覆盖角色卡自定义样式）
        //    这比依赖 CSS 变量更可靠，避免 WebView 中 var() 计算延迟导致的白边
        var cardColor = ps.getPropertyValue('--card').trim();
        if (cardColor) {
          document.documentElement.style.background = cardColor;
          document.documentElement.style.backgroundColor = cardColor;
        }
        // 3. 同步字体族、字号、颜色到 body，避免 iframe 回退系统默认字体
        if (ps.fontFamily) document.body.style.fontFamily = ps.fontFamily;
        if (ps.fontSize) document.body.style.fontSize = ps.fontSize;
        if (ps.color) document.body.style.color = ps.color;
      } catch (e) {
        console.warn('[TavernHelper Theme Sync] Failed:', e);
      }
    }
    function throttledSync() {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(syncTheme, 80);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') syncTheme();
    else document.addEventListener('DOMContentLoaded', syncTheme);
    window.addEventListener('load', syncTheme);
    // 监听父级 documentElement 的 class/style 变化，主题切换时实时同步
    try {
      var obs = new MutationObserver(throttledSync);
      obs.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
      if (window.parent.document.head) {
        obs.observe(window.parent.document.head, { childList: true, subtree: true });
      }
      // 遵循 AGENTS.md 准则十.4（彻底回收）：
      // 此 observer 持有父窗口 document 引用，必须在 iframe 卸载时显式 disconnect，
      // 否则会阻止 iframe 的 browsing context 被 GC 回收，造成内存泄漏。
      var __cleanupThemeObs = function() {
        try { obs.disconnect(); } catch(e) {}
      };
      window.addEventListener('pagehide', __cleanupThemeObs);
      window.addEventListener('beforeunload', __cleanupThemeObs);
    } catch(e) {
      console.warn('[TavernHelper Theme Sync] Observer setup failed:', e);
    }
  })();
</script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html {
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    background: var(--card, transparent) !important;
    background-color: var(--card, transparent) !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
  }
  body {
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    background: transparent !important;
    background-color: transparent !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
  }
  #th-iframe-wrapper {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: hidden !important;
    background: transparent !important;
    background-color: transparent !important;
  }
</style>
  `;

  if (hasHtmlTag) {
    let wrapped = processedHtml;

    // 直接使用硬编码的背景色（从父窗口读取的 --card 值），
    // 比 var(--card) 更可靠，避免 CSS 变量同步延迟导致的初始白边。
    const htmlBgStyle = `background:${cardBgColor} !important;background-color:${cardBgColor} !important;`;

    // Force inline background style on any html tag inside wrapped content to bypass WebView restrictions
    if (/<html\b/i.test(wrapped)) {
      wrapped = wrapped.replace(/<html\b([^>]*)>/gi, (match, htmlAttrs) => {
        if (/style\s*=\s*['"]/i.test(htmlAttrs)) {
          return `<html style="${htmlBgStyle}" ${htmlAttrs.replace(/style\s*=\s*(['"])/i, "style-orig=$1")}>`;
        } else {
          return `<html style="${htmlBgStyle}" ${htmlAttrs}>`;
        }
      });
    } else {
      wrapped = `<html style="${htmlBgStyle}">${wrapped}</html>`;
    }

    // Force inline transparency style on any body tag inside wrapped content, and inject our wrapper container to prevent infinite resize loop
    wrapped = wrapped.replace(/<body\b([^>]*)>/gi, (match, bodyAttrs) => {
      let bodyTag = "";
      if (/style\s*=\s*['"]/i.test(bodyAttrs)) {
        bodyTag = `<body style="background:transparent !important;background-color:transparent !important;" ${bodyAttrs.replace(/style\s*=\s*(['"])/i, "style-orig=$1")}>`;
      } else {
        bodyTag = `<body style="background:transparent !important;background-color:transparent !important;" ${bodyAttrs}>`;
      }
      return `${bodyTag}\n<div id="th-iframe-wrapper" style="overflow: hidden; display: flow-root; width: 100%;">`;
    });

    // Close the wrapper div container just before the closing body tag
    const closeBodyIdx = wrapped.lastIndexOf("</body>");
    if (closeBodyIdx !== -1) {
      // 在 </body> 之前注入 CSS reset 覆盖，确保能覆盖角色卡在 <head> 中定义的 body padding/margin
      // （同优先级 !important 规则，后定义的生效；放在 </body> 前保证是最后定义的）
      // 注意：只清零 html/body/#th-iframe-wrapper 的 margin/padding，不使用 * 通配符，
      // 避免破坏角色卡内部元素的设计样式（如 .mvu-wrapper { margin: 10px 0 } 是设计意图）
      const cssResetOverride = `<style id="th-css-reset-override">
html{margin:0 !important;padding:0 !important;max-width:100% !important;width:100% !important;background:${cardBgColor} !important;background-color:${cardBgColor} !important;overflow-x:hidden !important;overflow-y:hidden !important;}
body{margin:0 !important;padding:0 !important;max-width:100% !important;width:100% !important;background:transparent !important;background-color:transparent !important;overflow-x:hidden !important;overflow-y:hidden !important;}
#th-iframe-wrapper{margin:0 !important;padding:0 !important;width:100% !important;max-width:100% !important;overflow:hidden !important;background:transparent !important;background-color:transparent !important;}
</style>`;
      wrapped = wrapped.substring(0, closeBodyIdx) + "</div>" + cssResetOverride + wrapped.substring(closeBodyIdx);
    }

    // 仅当卡片未声明 viewport 时补充，避免移动端 vw/vh 单位失真与字体异常缩放
    const needsViewport = !/name\s*=\s*['"]viewport['"]/i.test(wrapped);
    const headInjects = `${needsViewport ? '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />' : ''}${scriptInjects}`;
    if (/<head>/i.test(wrapped)) {
      wrapped = wrapped.replace(/<head>/i, `<head>${headInjects}`);
    } else if (/<html>/i.test(wrapped)) {
      wrapped = wrapped.replace(/<html>/i, `<html><head>${headInjects}</head>`);
    } else {
      wrapped = `${headInjects}${wrapped}`;
    }
    if (!wrapped.trim().toLowerCase().startsWith("<!doctype")) {
      wrapped = `<!DOCTYPE html>\n${wrapped}`;
    }
    return wrapped;
  } else {
    return `<!DOCTYPE html>
<html style="background: ${cardBgColor} !important; background-color: ${cardBgColor} !important;">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${scriptInjects}
</head>
<body style="background: transparent !important; background-color: transparent !important;">
  <div id="th-iframe-wrapper" style="overflow: hidden; display: flow-root; width: 100%;">
    ${processedHtml}
  </div>
</body>
</html>`;
  }
}
