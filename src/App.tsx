import React, { useEffect, useState } from "react";
import { LegacyAppContextProvider } from "./contexts/LegacyAppContextProvider";
import MainLayout from "./components/MainLayout";
import { initializeKernel, destroyKernel, globalKernel } from "./kernel";
import { SplashScreen } from "./components/SplashScreen";
import { registerMainTabExtensions } from "./composition/registerMainTabExtensions";
import { KernelProvider } from "./contexts/KernelContext";
import { LanguageProvider } from "./contexts/LanguageContext";

export {
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
} from "./contexts/LegacyAppContextProvider";

export default function App() {
  const [kernelReady, setKernelReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlistenClose: (() => void) | null = null;

    initializeKernel()
      .then(() => {
        if (active) {
          registerMainTabExtensions(globalKernel);
          setKernelReady(true);
        }
      })
      .catch((err: any) => {
        console.error("[App] Failed to initialize microkernel:", err);
        if (active) setInitError(err.message || String(err));
      });

    // 监听 Tauri 原生窗口关闭事件，确保内核资源在 App 被强杀前被正确回收
    // 动态导入避免 Web 开发模式下模块解析失败
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (!active) return;
        return getCurrentWindow().onCloseRequested(() => {
          void destroyKernel();
        });
      })
      .then((unlisten) => {
        if (typeof unlisten === "function") unlistenClose = unlisten;
      })
      .catch(() => {
        // 非 Tauri 环境（Web 开发模式），忽略
      });

    return () => {
      active = false;
      if (unlistenClose) {
        try {
          unlistenClose();
        } catch {
          // unlisten 失败不应阻塞 cleanup
        }
      }
      // React 组件卸载时（HMR 热更新、路由切换等）清理内核资源
      // destroy() 是幂等的，重复调用安全（空映射遍历后即返回）
      void destroyKernel();
    };
  }, []);

  if (initError) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-6 text-center text-foreground">
        <div className="bg-destructive/10 border border-destructive/20 p-6 rounded-2xl max-w-md space-y-4 shadow-2xl">
          <h2 className="text-lg font-bold text-destructive">🚨 核心引擎冷启动失败</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            关键致命服务（如本地数据库）初始化发生错误，系统已熔断阻断以防静默读写导致数据损坏。
          </p>
          <pre className="text-[10px] font-mono bg-muted p-3 rounded border border-border text-left overflow-x-auto text-rose-400">
            {initError}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-primary text-primary-foreground font-bold py-2 rounded-lg text-xs hover:bg-primary/90 transition active:scale-95 shadow"
          >
            🔄 重新尝试冷启动
          </button>
        </div>
      </div>
    );
  }

  if (!kernelReady) {
    return <SplashScreen isVisible={true} />;
  }

  return (
    <KernelProvider kernel={globalKernel}>
      <LegacyAppContextProvider>
        <LanguageProvider>
          <MainLayout />
        </LanguageProvider>
      </LegacyAppContextProvider>
    </KernelProvider>
  );
}
