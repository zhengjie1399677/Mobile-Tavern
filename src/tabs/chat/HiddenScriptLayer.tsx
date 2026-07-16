// 隐藏脚本容器 + A11y Live Region
// 从原 ChatTab.tsx L1809-1847 + L1862-1865 抽离

import React from "react";

import { createScriptIframeSrcDoc, notifyVariablesUpdated, hasCardScripts } from "../../utils/tavernHelper";
import { useKernel } from "../../contexts/KernelContext";

interface HiddenScriptLayerProps {
  settings: any;
  activeCharacter: any;
  announcement: string;
}

/** iframe / 原生桥接侧动态挂载到 window 的脚本库引用。 */
interface WindowWithScriptLibs extends Window {
  TavernHelperMvuLibs?: { defineStore?: unknown };
  _?: unknown;
}

interface ScriptIframeItemProps {
  script: any;
  enableLoopProtection: boolean;
}

const ScriptIframeItem = React.memo(
  ({ script, enableLoopProtection }: ScriptIframeItemProps) => {
    const iframeId = `TH-script--${script.name || "unnamed"}--${script.id}`;

    const srcDoc = React.useMemo(() => {
      return createScriptIframeSrcDoc(script.content, script.id, enableLoopProtection);
    }, [script.content, script.id, enableLoopProtection]);

    // 强制清理：组件卸载时主动将 iframe 导航到 about:blank，
    // 这会触发 iframe 内部的 beforeunload/pagehide 事件，
    // 确保 setInterval、MutationObserver、ResizeObserver 等全部被销毁。
    // Android WebView 在 React 直接移除 DOM 时可能不触发 pagehide，
    // 此清理机制作为兜底防线，防止已移除 iframe 的定时器与观察器泄露。
    React.useEffect(() => {
      return () => {
        const iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
        if (iframe) {
          try {
            // 强制导航到 blank 页面，触发浏览上下文销毁
            iframe.src = "about:blank";
          } catch {
            // 跨域限制下静默降级
          }
        }
      };
    }, [iframeId]);

    return (
      <iframe
        id={iframeId}
        name={script.name || "unnamed"}
        srcDoc={srcDoc}
        style={{ display: "none" }}
        // 关键修复：Android WebView 中，srcdoc iframe 若无 sandbox（含 allow-same-origin），
        // 会被赋予 opaque origin，导致 window.parent.* 访问被跨域策略阻止，
        // 脚本内库继承（window.parent._、window.parent.TavernHelper 等）会失败。
        // 必须统一设置 allow-same-origin，使 iframe 继承父文档 of origin。
        // eslint-disable-next-line react/no-unknown-property
        sandbox="allow-scripts allow-same-origin"
      />
    );
  },
  // 自定义比较：仅在脚本 id、内容或保护模式的值真正变化时才重建 iframe。
  // 防止 activeCharacter 对象引用刷新（但内容不变）时 memo 浅比较失效，
  // 导致 srcDoc 被重新赋值给 iframe，从而触发脚本重新执行。
  (prev, next) =>
    prev.script.id === next.script.id &&
    prev.script.content === next.script.content &&
    prev.enableLoopProtection === next.enableLoopProtection
);

ScriptIframeItem.displayName = "ScriptIframeItem";

const HiddenScriptLayer = ({
  settings,
  activeCharacter,
  announcement,
}: HiddenScriptLayerProps) => {
  const kernel = useKernel();
  const [libsReady, setLibsReady] = React.useState(false);

  // 检测库是否就绪。依赖 activeCharacter 以便在角色切换时重新检查。
  // 【关键】：此 effect 仅调用 setLibsReady(true)，从不重置为 false，
  // 因此不会引起 iframe unmount/remount（避免脚本重复执行）。
  // iframe 的自然生命周期由 React key 机制管理：角色切换时 script.id 不同
  // → React 自动 unmount 旧 iframe、mount 新 iframe，无需手动干预。
  React.useEffect(() => {
    let isMounted = true;
    const checkLibs = () => {
      const w = window as WindowWithScriptLibs;
      // P2 修复：统一使用 hasCardScripts 检测角色卡是否含可执行脚本/MVU 配置，
      // 避免与 bridgeCore 的检测逻辑产生分叉。
      if (!hasCardScripts(activeCharacter)) {
        if (isMounted) setLibsReady(true);
        return;
      }

      if (w.TavernHelperMvuLibs?.defineStore && w._) {
        if (isMounted) setLibsReady(true);
      } else {
        setTimeout(checkLibs, 50);
      }
    };
    checkLibs();
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacter?.id]);

  // P0-B 修复：订阅 script:mvuVariablesUpdated 降级事件
  // 当 ScriptService 的 bridge 未就绪或 notifyVariablesUpdated 抛错时，
  // 会通过 kernel 消息总线广播 script:mvuVariablesUpdated 作为降级通道。
  // 此处订阅并转发为 tavern_helper:mag_variable_initialized 等 iframe 可识别的事件，
  // 确保 bridge 缺失时变量更新通知仍能到达 iframe 内的 MVU 脚本。
  React.useEffect(() => {
    const unsub = kernel.subscribe("script:mvuVariablesUpdated", (msg) => {
      const { session } = msg.payload || {};
      if (session) {
        try {
          notifyVariablesUpdated(session);
        } catch (e) {
          console.warn("[HiddenScriptLayer] Failed to forward script:mvuVariablesUpdated:", e);
        }
      }
    });
    return () => {
      unsub();
    };
  }, [kernel]);

  // P1-A 修复：订阅 script:destroyed 事件
  // ScriptService 销毁时广播此事件，通知本组件主动停止渲染 iframe，
  // 防止 ScriptService 已注销但 iframe 仍在运行导致的事件总线空转与资源泄漏。
  // 遵循 AGENTS.md 准则十.4（彻底回收）。
  const [scriptDestroyed, setScriptDestroyed] = React.useState(false);
  React.useEffect(() => {
    const unsub = kernel.subscribe("script:destroyed", () => {
      setScriptDestroyed(true);
    });
    return () => {
      unsub();
    };
  }, [kernel]);

  const canRenderScripts = libsReady && settings.enableScriptExecution && !scriptDestroyed;

  return (
    <>
      {/* Hidden background script runtimes for TavernHelper compatibility */}
      {/* MVU compatibility: #tavern_helper container with data-script-id elements */}
      <div id="tavern_helper" style={{ display: "none" }} aria-hidden="true">
        {canRenderScripts &&
          activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
            if (script.enabled && script.content) {
              return (
                <div
                  key={script.id}
                  data-script-id={script.id}
                  data-script-name={script.name || "unnamed"}
                />
              );
            }
            return null;
          })}
      </div>
      {canRenderScripts &&
        activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
          if (script.enabled && script.content) {
            return (
              <ScriptIframeItem
                key={script.id}
                script={script}
                enableLoopProtection={settings.enableLoopProtection !== false}
              />
            );
          }
          return null;
        })}
      {/* 4. A11y Screen Reader Live Region */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
};

export default HiddenScriptLayer;
