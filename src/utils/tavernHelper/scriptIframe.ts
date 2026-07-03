/**
 * scriptIframe.ts — MVU 脚本预处理与 Iframe 沙盒工厂
 *
 * 职责：
 * - 对 MVU 框架脚本（mvu.js / mvu_zod.js / mvu_bundle.js）做 CDN 替换，生成离线可执行 IIFE
 * - preprocessScriptContent：对用户角色卡脚本中的 ESM CDN 导入做本地化替换
 * - createScriptIframeSrcDoc：构建完整的 MVU 脚本执行沙盒 HTML（含库注入、预定义桥接函数）
 * - createMessageIframeSrcDoc：为消息内嵌 HTML 构建安全沙盒（含 jQuery shim、高度自适应）
 *
 * 此模块依赖 Vite 的 ?raw 语法读取脚本文件内容，仅在 Vite 构建环境下可用。
 * Node.js 测试环境不应直接 import 此模块。
 */

// Vite ?raw 语法：将脚本文件内容作为字符串导入
import mvuBundleContent from "../mvu_bundle.js?raw";
import mvuZodContent from "../mvu_zod.js?raw";
import mvuContent from "../mvu.js?raw";

// ──────────────────────────────────────────────────────────────────────────────
// 泛化 ESM CDN import 替换器（方案 B）
// ──────────────────────────────────────────────────────────────────────────────

/**
 * CDN 包配置描述符
 *
 * - type "named"     ：对应 `import { X as Y } from '...'` 形式
 * - type "namespace" ：对应 `import * as Z from '...'` 形式
 * - libKey            ：TavernHelperMvuLibs 上的属性名；为 null 时直接解构整个对象
 * - defaultAlias      ：`default as X` 时 default 对应的 libKey 名（如 "JSON5"）
 */
interface CdnLibConfig {
  type: "named" | "namespace";
  libKey: string | null;
  defaultAlias?: string;
}

/**
 * 通用 ESM CDN import 替换器
 *
 * 对 code 中所有符合 jsdelivr CDN URL 格式的 ESM import 语句，
 * 根据 libMap 动态解析绑定关系并生成等价的 const 赋值语句。
 * 与具体 minified 变量名完全无关，bundle 重新构建后自动适配。
 *
 * 支持的 import 形式：
 *   - `import { X as localName, Y as localName2 } from 'CDN_URL'`
 *   - `import * as localName from 'CDN_URL'`
 *   - `import { default as localName } from 'CDN_URL'`（通过 defaultAlias 映射）
 */
function replaceEsmImports(code: string, libMap: Record<string, CdnLibConfig>): string {
  // 匹配 CDN URL 中的包名（含 scope，如 @scope/pkg）
  const CDN_PKG_RE = /https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/@][^/]*|@[^/]+\/[^/]+)(?:@[^/]+)?\/\+esm/;

  // 替换 `import * as Z from '...'`（namespace import）
  code = code.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, localName: string, url: string) => {
      const pkgMatch = url.match(CDN_PKG_RE);
      if (!pkgMatch) return _match;
      const pkgName = pkgMatch[1];
      const cfg = libMap[pkgName];
      if (!cfg || cfg.type !== "namespace") return _match;
      const prop = cfg.libKey ?? pkgName;
      return `const ${localName} = window.parent.TavernHelperMvuLibs.${prop};`;
    }
  );

  // 替换 `import { X as Y, ... } from '...'`（named import）
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, bindingsStr: string, url: string) => {
      const pkgMatch = url.match(CDN_PKG_RE);
      if (!pkgMatch) return _match;
      const pkgName = pkgMatch[1];
      const cfg = libMap[pkgName];
      if (!cfg || cfg.type !== "named") return _match;

      // 解析每个绑定 "origName as localName" 或 "name"
      const bindings = bindingsStr.split(",").map((s) => s.trim()).filter(Boolean);
      const parts = bindings.map((binding) => {
        const asMatch = binding.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
          const [, origName, localName] = asMatch;
          // `default as X` 需要映射到 defaultAlias 指定的 key
          if (origName === "default") {
            const alias = cfg.defaultAlias ?? pkgName;
            return `${alias}: ${localName}`;
          }
          return `${origName}: ${localName}`;
        }
        // 无别名，直接使用原名
        return binding;
      });

      // libKey 非 null：该包只暴露单一值（如 klona），直接取属性
      if (cfg.libKey) {
        const singleMatch = bindings[0]?.match(/^(?:\S+)\s+as\s+(\S+)$/);
        const localName = singleMatch?.[1];
        if (localName) {
          return `const ${localName} = window.parent.TavernHelperMvuLibs.${cfg.libKey};`;
        }
      }

      // 多导出或无 libKey：直接从 TavernHelperMvuLibs 解构
      return `const { ${parts.join(", ")} } = window.parent.TavernHelperMvuLibs;`;
    }
  );

  return code;
}

// MVU bundle / mvu / mvu_zod 共用的 libMap 配置
const MVU_LIB_MAP: Record<string, CdnLibConfig> = {
  "klona":            { type: "named",     libKey: "klona"        },
  "pinia":            { type: "named",     libKey: null           },
  "compare-versions": { type: "named",     libKey: null           },
  "json5":            { type: "named",     libKey: null,  defaultAlias: "JSON5" },
  "jsonrepair":       { type: "named",     libKey: null           },
  "mathjs":           { type: "namespace", libKey: "math"         },
};

// ──────────────────────────────────────────────────────────────────────────────
// 预处理常量：将 CDN import 替换为本地 TavernHelperMvuLibs 查找，并包装为 IIFE
// ──────────────────────────────────────────────────────────────────────────────

// 预处理 mvu_zod 脚本：移除其 ES 模块 export 声明并包裹为 IIFE 以隔离作用域
const processedMvuZod = `(function(){
  ${mvuZodContent
    .replace(/export\s*\{\s*s\s*as\s*registerMvuSchema\s*\};?/g, "")
    .replace(/\/\/#\s*sourceMappingURL=.*/g, "")}
})();`;

// 预处理 mvu 脚本：泛化替换 pinia CDN import 后包裹为 IIFE
const processedMvu = `(function(){
  ${replaceEsmImports(mvuContent, { "pinia": { type: "named", libKey: null } })
    .replace(/\bexport\s*\{\s*(\w+)\s+as\s+defineMvuDataStore\s*\};?/g, (_m, local) =>
      `window.defineMvuDataStore = ${local};`
    )}
})();`;

// 预处理 mvu_bundle 脚本：泛化替换所有 CDN import 后包裹为 IIFE
const processedMvuBundle = `(function(){
  ${replaceEsmImports(
    mvuBundleContent.replace(/\/\/#\s*sourceMappingURL=.*/g, ""),
    MVU_LIB_MAP
  )}
})();`;

// ──────────────────────────────────────────────────────────────────────────────
// 脚本内容预处理：将角色卡脚本中的 CDN 导入替换为本地查找
// ──────────────────────────────────────────────────────────────────────────────

export function preprocessScriptContent(content: string): string {
  let processed = content;

  // 1. 移除 MVU bundle 的 side-effect import（bundle 已在沙盒中预加载）
  processed = processed.replace(
    /import\s*['"][^'"]*bundle(?:\.js)?['"];?/g,
    `// 本地 MVU bundle 已预加载`
  );

  // 2. 替换 mvu_zod 的具名导入为 window.registerMvuSchema
  processed = processed.replace(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"][^'"]*mvu_zod(?:\.js)?['"];?/g,
    `const registerMvuSchema = window.registerMvuSchema;`
  );

  // 3. 替换 mvu 框架导入（CDN URL 与相对路径两种形式统一处理）
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"](?:https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/mvu(?:\.js)?\/\+esm|[^'"]*mvu(?:\.js)?)['"];?/g,
    (_match, importsStr: string) => {
      const parts = importsStr.split(",").map((p: string) => {
        const item = p.trim();
        const asMatch = item.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
          const [, orig, alias] = asMatch;
          if (orig === "default" || orig === "defineMvuDataStore") {
            return `defineMvuDataStore: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(", ")} } = { defineMvuDataStore: window.defineMvuDataStore };`;
    }
  );

  // 4. 泛化替换 jsdelivr CDN 上的所有 named / namespace import
  processed = replaceEsmImports(processed, MVU_LIB_MAP);

  // 5. 清理 ES 模块 export 声明（卡片脚本运行在同步沙盒中，不支持 export）
  processed = processed.replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  processed = processed.replace(/\bexport\s*\{[^}]*\};?/g, "");
  processed = processed.replace(/\bexport\s+default\b/g, "");

  return processed;
}

// ──────────────────────────────────────────────────────────────────────────────
// 脚本执行沙盒 Iframe HTML 生成
// ──────────────────────────────────────────────────────────────────────────────

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
          var cleanKey = key.replace('_', '');
          if (typeof window[cleanKey] === 'function') {
            var obj = {};
            obj[cleanKey] = window[cleanKey];
            return obj;
          }
          var obj = {};
          obj[cleanKey] = typeof value === 'function' ? value.bind(window) : value;
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

// ──────────────────────────────────────────────────────────────────────────────
// 消息内嵌 HTML 沙盒生成（含 jQuery shim、高度自适应）
// ──────────────────────────────────────────────────────────────────────────────

export function createMessageIframeSrcDoc(htmlContent: string, messageIndex?: number): string {
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
  window.__TH_MESSAGE_ID = ${messageIndex !== undefined ? messageIndex : 'undefined'};
</script>
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
    window.TavernHelper = new Proxy(TavernHelper, {
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
        var val = target[prop];
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      }
    });
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
          var cleanKey = key.replace('_', '');
          if (typeof window[cleanKey] === 'function') {
            var obj = {};
            obj[cleanKey] = window[cleanKey];
            return obj;
          }
          var obj = {};
          obj[cleanKey] = typeof value === 'function' ? value.bind(window) : value;
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
