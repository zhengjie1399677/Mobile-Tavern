// 隐藏脚本容器 + A11y Live Region
// 从原 ChatTab.tsx L1809-1847 + L1862-1865 抽离

import React from "react";

import { useKernel } from "../../contexts/KernelContext";
import type {
  CharacterCard,
  ChatSession,
  CompatibilityScriptSecurityMode,
  UserSettings,
} from "../../types";
import {
  KernelServices,
  type ICompatibilityRuntimeService,
} from "../../application/serviceContracts";
import type {
  CompatibilityBackgroundScript,
  CompatibilityIframePolicy,
  CompatibilityRendererDefinition,
} from "../../application/compatibility/contracts";

interface HiddenScriptLayerProps {
  settings: UserSettings;
  activeCharacter: CharacterCard | null;
  announcement: string;
}

interface ScriptIframeItemProps {
  script: CompatibilityBackgroundScript;
  renderer: CompatibilityRendererDefinition;
  enableLoopProtection: boolean;
  iframePolicy: CompatibilityIframePolicy;
  securityMode: CompatibilityScriptSecurityMode;
}

const ScriptIframeItem = React.memo(
  ({ script, renderer, enableLoopProtection, iframePolicy, securityMode }: ScriptIframeItemProps) => {
    const iframeId = `TH-script--${script.name || "unnamed"}--${script.id}`;

    const srcDoc = React.useMemo(() => {
      return renderer.createScriptIframeSrcDoc(
        script.content,
        script.id,
        enableLoopProtection,
        securityMode,
      );
    }, [script.content, script.id, renderer, enableLoopProtection, securityMode]);

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
        sandbox={iframePolicy.sandbox}
        data-mt-compat-isolated={iframePolicy.isolated ? "true" : undefined}
      />
    );
  },
  // 自定义比较：仅在脚本 id、内容或保护模式的值真正变化时才重建 iframe。
  // 防止 activeCharacter 对象引用刷新（但内容不变）时 memo 浅比较失效，
  // 导致 srcDoc 被重新赋值给 iframe，从而触发脚本重新执行。
  (prev, next) =>
    prev.script.id === next.script.id &&
    prev.script.content === next.script.content &&
    prev.renderer === next.renderer &&
    prev.enableLoopProtection === next.enableLoopProtection &&
    prev.iframePolicy.isolated === next.iframePolicy.isolated &&
    prev.iframePolicy.sandbox === next.iframePolicy.sandbox &&
    prev.securityMode === next.securityMode
);

ScriptIframeItem.displayName = "ScriptIframeItem";

const HiddenScriptLayer = ({
  settings,
  activeCharacter,
  announcement,
}: HiddenScriptLayerProps) => {
  const kernel = useKernel();
  const compatibilityRuntime = kernel.getService<ICompatibilityRuntimeService>(
    KernelServices.CompatibilityRuntime,
  );
  const renderer = compatibilityRuntime.getRenderer();
  const securityMode = settings.scriptSecurityMode ?? "isolated";
  const iframePolicy = renderer?.getIframePolicy(securityMode);
  const backgroundScripts = renderer?.listBackgroundScripts(activeCharacter) ?? [];
  const [libsReady, setLibsReady] = React.useState(false);

  // 检测库是否就绪。依赖 activeCharacter 以便在角色切换时重新检查。
  // 【关键】：此 effect 仅调用 setLibsReady(true)，从不重置为 false，
  // 因此不会引起 iframe unmount/remount（避免脚本重复执行）。
  // iframe 的自然生命周期由 React key 机制管理：角色切换时 script.id 不同
  // → React 自动 unmount 旧 iframe、mount 新 iframe，无需手动干预。
  React.useEffect(() => {
    let isMounted = true;
    const checkLibs = () => {
      // P2 修复：统一使用 hasCardScripts 检测角色卡是否含可执行脚本/MVU 配置，
      // 避免与 bridgeCore 的检测逻辑产生分叉。
      if (!renderer?.hasCardScripts(activeCharacter)) {
        if (isMounted) setLibsReady(true);
        return;
      }

      if (renderer.areRuntimeLibrariesReady(securityMode)) {
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
  }, [activeCharacter?.id, renderer, securityMode]);

  // P0-B 修复：订阅 script:mvuVariablesUpdated 降级事件
  // 当 ScriptService 的 bridge 未就绪或 notifyVariablesUpdated 抛错时，
  // 会通过 kernel 消息总线广播 script:mvuVariablesUpdated 作为降级通道。
  // 此处订阅并转发为 tavern_helper:mag_variable_initialized 等 iframe 可识别的事件，
  // 确保 bridge 缺失时变量更新通知仍能到达 iframe 内的 MVU 脚本。
  React.useEffect(() => {
    const unsub = kernel.subscribe("script:mvuVariablesUpdated", (msg) => {
      // P2 待重构：IMessage 应泛型化为 IMessage<TPayload>，订阅方传入具体类型
      const { session } = (msg.payload || {}) as { session?: ChatSession };
      if (session) {
        try {
          compatibilityRuntime.notifyStateChanged(session);
        } catch (e) {
          console.warn("[HiddenScriptLayer] Failed to forward script:mvuVariablesUpdated:", e);
        }
      }
    });
    return () => {
      unsub();
    };
  }, [compatibilityRuntime, kernel]);

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

  const canRenderScripts = Boolean(
    renderer && libsReady && settings.enableScriptExecution && !scriptDestroyed,
  );

  return (
    <>
      {/* Hidden background script runtimes for TavernHelper compatibility */}
      {/* MVU compatibility: #tavern_helper container with data-script-id elements */}
      <div id="tavern_helper" style={{ display: "none" }} aria-hidden="true">
        {canRenderScripts &&
          backgroundScripts.map((script) => {
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
        renderer && backgroundScripts.map((script) => {
          if (script.enabled && script.content) {
            return (
              <ScriptIframeItem
                key={script.id}
                script={script}
                renderer={renderer}
                enableLoopProtection={settings.enableLoopProtection !== false}
                iframePolicy={iframePolicy ?? { isolated: true, sandbox: "allow-scripts" }}
                securityMode={securityMode}
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
