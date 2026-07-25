import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { initViewportDiagnostic } from "./utils/viewportDiagnostic.ts";
import { installGlobalErrorHandlers, reportImmediate } from "./utils/telemetry.ts";
import { Logger } from "./utils/logger.ts";
import "./index.css";

// 视口诊断黑匣子：在 React 挂载前尽早初始化，捕获从启动起的完整 resize 事件序列，
// 供系统报告回溯键盘遮挡等瞬态问题的现场。
initViewportDiagnostic();
// 主应用级全局错误兜底：捕获 window.onerror 与 unhandledrejection 并上报遥测。
// 必须在 React 挂载前安装，以兜底捕获 React 渲染树之外的同步异常与 Promise rejection。
installGlobalErrorHandlers();

// Logger.error ↔ 遥测联动：注入 error handler，使所有 logger.error 自动触发 reportImmediate。
// 避免在每个 catch 块重复手动调用遥测；Logger 内部已有防递归与异常兜底，此回调只需关注上报本身。
Logger.setErrorHandler(({ module, traceId, message, errorName, errorMessage, fields }) => {
  // 遥测失败不得污染主流程（reportImmediate 内部已 catch，此处再兜一层）
  reportImmediate("logger_error", {
    detail: `[${module}] ${message}`,
    traceId: traceId || "",
    characterName: "",
    playerName: "",
    modelName: "",
    sessionId: fields?.sessionId as string || "",
    ...fields,
    // 显式覆盖错误名/消息字段，便于 SLS 侧按错误类型聚类
    ...(errorName ? { errorName } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }).catch(() => {
    // 静默：遥测不可用时不影响主流程
  });
});

// PERF-01: 在根组件层级包裹 ErrorBoundary，捕获渲染异常防止整个应用白屏
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
