/**
 * 为兼容 iframe 提供通用资源登记。
 * 该脚本不包含 SillyTavern 业务语义，只负责 browsing context 销毁前的资源回收。
 */
export function createIframeResourceCleanupBootstrap(): string {
  return `
(function () {
  "use strict";
  if (window.__MT_RESOURCE_CLEANUP__) return;
  var timeoutIds = [];
  var intervalIds = [];
  var animationFrameIds = [];
  var objectUrls = [];
  var dynamicStyles = [];
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);
  var nativeRequestAnimationFrame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : null;
  var nativeCancelAnimationFrame = typeof window.cancelAnimationFrame === "function"
    ? window.cancelAnimationFrame.bind(window)
    : null;
  var nativeCreateObjectURL = window.URL && typeof window.URL.createObjectURL === "function"
    ? window.URL.createObjectURL.bind(window.URL)
    : null;
  var nativeRevokeObjectURL = window.URL && typeof window.URL.revokeObjectURL === "function"
    ? window.URL.revokeObjectURL.bind(window.URL)
    : null;

  function remove(list, id) {
    var index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
  }

  window.setTimeout = function (handler, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var id;
    if (typeof handler === "function") {
      id = nativeSetTimeout(function () {
        remove(timeoutIds, id);
        handler.apply(window, args);
      }, delay);
    } else {
      id = nativeSetTimeout.apply(window, arguments);
    }
    timeoutIds.push(id);
    return id;
  };
  window.clearTimeout = function (id) {
    remove(timeoutIds, id);
    remove(intervalIds, id);
    nativeClearTimeout(id);
  };
  window.setInterval = function (handler, delay) {
    var id = nativeSetInterval.apply(window, arguments);
    intervalIds.push(id);
    return id;
  };
  window.clearInterval = function (id) {
    remove(intervalIds, id);
    remove(timeoutIds, id);
    nativeClearInterval(id);
  };
  if (nativeRequestAnimationFrame && nativeCancelAnimationFrame) {
    window.requestAnimationFrame = function (callback) {
      var id = nativeRequestAnimationFrame(function (time) {
        remove(animationFrameIds, id);
        callback(time);
      });
      animationFrameIds.push(id);
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      remove(animationFrameIds, id);
      nativeCancelAnimationFrame(id);
    };
  }

  if (nativeCreateObjectURL && nativeRevokeObjectURL && window.URL) {
    window.URL.createObjectURL = function (value) {
      var url = nativeCreateObjectURL(value);
      objectUrls.push(url);
      return url;
    };
    window.URL.revokeObjectURL = function (url) {
      remove(objectUrls, url);
      nativeRevokeObjectURL(url);
    };
  }

  var styleObserver = typeof MutationObserver === "function" && document.documentElement
    ? new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, function (node) {
            if (node && node.nodeType === 1 &&
              (node.tagName === "STYLE" || (node.tagName === "LINK" && node.rel === "stylesheet"))) {
              dynamicStyles.push(node);
            }
          });
        });
      })
    : null;
  if (styleObserver) styleObserver.observe(document.documentElement, { childList: true, subtree: true });

  var cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    timeoutIds.slice().forEach(nativeClearTimeout);
    intervalIds.slice().forEach(nativeClearInterval);
    if (nativeCancelAnimationFrame) animationFrameIds.slice().forEach(nativeCancelAnimationFrame);
    objectUrls.slice().forEach(function (url) {
      if (nativeRevokeObjectURL) nativeRevokeObjectURL(url);
    });
    if (styleObserver) styleObserver.disconnect();
    dynamicStyles.slice().forEach(function (node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    try {
      document.querySelectorAll("audio,video").forEach(function (media) {
        try { media.pause(); } catch (e) {}
        try { media.removeAttribute("src"); media.load(); } catch (e) {}
      });
    } catch (e) {}
    timeoutIds.length = 0;
    intervalIds.length = 0;
    animationFrameIds.length = 0;
    objectUrls.length = 0;
    dynamicStyles.length = 0;
    try { window.removeEventListener("pagehide", cleanup); } catch (e) {}
    try { window.removeEventListener("beforeunload", cleanup); } catch (e) {}
  }
  window.__MT_RESOURCE_CLEANUP__ = cleanup;
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
})();
`;
}
