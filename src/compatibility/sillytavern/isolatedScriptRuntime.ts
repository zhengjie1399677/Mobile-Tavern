import { injectLoopProtection } from "../../utils/tavernHelper/scriptPreprocessor";

const ISOLATED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

function serializeInlineValue(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function stripCodeFence(content: string): string {
  return content.replace(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/i, "$1");
}

function createBridgeBootstrap(initialVariables: unknown, frameId: string): string {
  return `<script>
(function () {
  "use strict";
  if (window.__MT_ISOLATED_BRIDGE__) return;
  Object.defineProperty(window, "__MT_ISOLATED_BRIDGE__", { value: true });
  var variables = ${serializeInlineValue(initialVariables)};
  var frameId = ${serializeInlineValue(frameId)};
  var sequence = 0;
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function request(method, params) {
    window.parent.postMessage({
      mtCompatIsolated: 1,
      requestId: frameId + ":" + (++sequence),
      method: method,
      params: params
    }, "*");
  }
  function getVariables() { return clone(variables); }
  function replaceVariables(next, option) {
    variables = clone(next || {});
    request("variables.replace", { variables: variables, option: option || { type: "chat" } });
    return clone(variables);
  }
  window.getVariables = getVariables;
  window.replaceVariables = replaceVariables;
  window.TavernHelper = Object.freeze({
    getVariables: getVariables,
    replaceVariables: replaceVariables,
    updateVariablesWith: function (updater, option) {
      var next = typeof updater === "function" ? updater(getVariables()) : updater;
      return replaceVariables(next, option);
    }
  });
  function reportHeight() {
    var root = document.documentElement;
    var body = document.body;
    var height = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0);
    request("frame.resize", { height: height });
  }
  window.addEventListener("DOMContentLoaded", function () {
    reportHeight();
    if (typeof ResizeObserver === "function" && document.body) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
  });
})();
</script>`;
}

/** 构建 opaque-origin 后台脚本容器；不注入父窗口库或原生能力。 */
export function createIsolatedScriptIframeSrcDoc(
  content: string,
  scriptId: string,
  initialVariables: unknown,
  enableLoopProtection = true,
): string {
  const source = stripCodeFence(content);
  const prepared = enableLoopProtection ? injectLoopProtection(source) : source;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ISOLATED_CSP}"></head><body>${createBridgeBootstrap(initialVariables, `script:${scriptId}`)}<script>${prepared}\n<\/script></body></html>`;
}

/** 为消息 HTML 注入同一最小桥；原 HTML 保留，但网络、表单与父窗口访问由 CSP/sandbox 阻断。 */
export function createIsolatedMessageIframeSrcDoc(
  content: string,
  messageId: number | undefined,
  initialVariables: unknown,
): string {
  const securityHead = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ISOLATED_CSP}">${createBridgeBootstrap(initialVariables, `message:${messageId ?? "unknown"}`)}`;
  if (/<head(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${securityHead}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head>${securityHead}</head>`);
  }
  return `<!doctype html><html><head>${securityHead}</head><body>${content}</body></html>`;
}
