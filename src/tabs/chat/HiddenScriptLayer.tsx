// 隐藏脚本容器 + A11y Live Region
// 从原 ChatTab.tsx L1809-1847 + L1862-1865 抽离

import React from "react";

import { createScriptIframeSrcDoc } from "../../utils/tavernHelper";
import { globalKernel } from "../../kernel/Kernel";

interface HiddenScriptLayerProps {
  settings: any;
  activeCharacter: any;
  announcement: string;
}

const HiddenScriptLayer = ({
  settings,
  activeCharacter,
  announcement,
}: HiddenScriptLayerProps) => {
  const [libsReady, setLibsReady] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;
    const checkLibs = () => {
      const w = window as any;
      const hasScripts = activeCharacter && (
        (Array.isArray(activeCharacter.extensions?.tavern_helper?.scripts) &&
         activeCharacter.extensions.tavern_helper.scripts.length > 0) ||
        activeCharacter.extensions?.mvu_settings ||
        activeCharacter.extensions?.mvu ||
        activeCharacter.extensions?.MVU
      );

      if (!hasScripts) {
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
  }, [activeCharacter]);

  // ── iframe 生命周期清理协议 ──────────────────────────────────────────────────
  // 遵循 AGENTS.md 准则十.4（彻底回收）：
  // 监听 kernel 消息总线的 script:destroyed / script:bridgeCleaned 事件，
  // 主动从 DOM 中移除所有 TH-script-- 前缀的 iframe 元素，释放 browsing context
  // 与挂起的异步任务，防止 ScriptService 销毁或 bridge 清理后 iframe 残留导致的资源泄漏。
  React.useEffect(() => {
    const cleanupIframes = () => {
      try {
        const iframes = document.querySelectorAll('iframe[id^="TH-script--"]');
        iframes.forEach((iframe) => {
          const el = iframe as HTMLIFrameElement;
          // 先重置 src 以终止 iframe 内的脚本执行与网络请求
          try { el.src = "about:blank"; } catch {}
          // 再从 DOM 移除以释放 browsing context
          el.remove();
        });
      } catch {
        // 静默降级，避免清理流程影响主渲染
      }
    };

    const unsubDestroyed = globalKernel.subscribe("script:destroyed", () => {
      cleanupIframes();
    });
    const unsubBridgeCleaned = globalKernel.subscribe("script:bridgeCleaned", () => {
      cleanupIframes();
    });

    return () => {
      unsubDestroyed();
      unsubBridgeCleaned();
    };
  }, []);

  return (
    <>
      {/* Hidden background script runtimes for TavernHelper compatibility */}
      {/* MVU compatibility: #tavern_helper container with data-script-id elements */}
      <div id="tavern_helper" style={{ display: "none" }} aria-hidden="true">
        {libsReady && settings.enableScriptExecution &&
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
      {libsReady && settings.enableScriptExecution &&
        activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
          if (script.enabled && script.content) {
            const srcDoc = createScriptIframeSrcDoc(script.content, script.id);
            return (
              <iframe
                key={script.id}
                id={`TH-script--${script.name || "unnamed"}--${script.id}`}
                name={script.name || "unnamed"}
                srcDoc={srcDoc}
                style={{ display: "none" }}
                // eslint-disable-next-line react/no-unknown-property
                sandbox="allow-scripts allow-same-origin"
                // Note: allow-same-origin + allow-scripts is intentionally used here.
                // The MVU bundle requires parent window access (TavernHelper, $, _ etc.)
                // and script execution. Scripts only run from user-imported character cards
                // with explicit enableScriptExecution setting enabled.
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
