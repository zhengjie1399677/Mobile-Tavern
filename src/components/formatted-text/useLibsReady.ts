import { useEffect, useState } from "react";
import type { CompatibilityRendererDefinition } from "../../application/compatibility/contracts";

/**
 * 等待可选 Compatibility Renderer 的脚本运行库就绪。
 *
 * 脚本执行关闭时无需轮询；开启时持续检测 MVU 与 lodash，
 * 并在组件卸载时回收尚未触发的定时器。
 */
export function useLibsReady(
  enableScriptExecution: boolean,
  renderer: CompatibilityRendererDefinition | null,
): boolean {
  const [libsReady, setLibsReady] = useState(false);

  useEffect(() => {
    if (!enableScriptExecution) {
      setLibsReady(true);
      return;
    }

    let isMounted = true;
    let checkCount = 0;
    let checkTimer: number | undefined;

    const checkLibs = () => {
      if (!isMounted) return;

      checkCount++;
      const ready = renderer?.areRuntimeLibrariesReady() ?? true;

      // 前 3 次与第 20 次、第 60 次打印诊断（避免日志爆炸）
      if (checkCount === 1 || checkCount === 3 || checkCount === 20 || checkCount === 60) {
        console.log("[FormattedText] libsReady 检测 #" + checkCount, {
          rendererId: renderer?.id ?? null,
          libsReady: ready,
        });
      }

      if (ready) {
        if (isMounted) setLibsReady(true);
        console.log("[FormattedText] libsReady=true，停止轮询");
      } else {
        checkTimer = window.setTimeout(checkLibs, 50);
      }
    };

    checkLibs();

    return () => {
      isMounted = false;
      if (checkTimer !== undefined) {
        window.clearTimeout(checkTimer);
      }
    };
  }, [enableScriptExecution, renderer]);

  return libsReady;
}
