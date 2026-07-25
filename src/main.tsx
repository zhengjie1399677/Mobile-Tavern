import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { initViewportDiagnostic } from "./utils/viewportDiagnostic.ts";
import { installGlobalErrorHandlers } from "./utils/telemetry.ts";
import "./index.css";

// 视口诊断黑匣子：在 React 挂载前尽早初始化，捕获从启动起的完整 resize 事件序列，
// 供系统报告回溯键盘遮挡等瞬态问题的现场。
initViewportDiagnostic();
// 主应用级全局错误兜底：捕获 window.onerror 与 unhandledrejection 并上报遥测。
// 必须在 React 挂载前安装，以兜底捕获 React 渲染树之外的同步异常与 Promise rejection。
installGlobalErrorHandlers();

// PERF-01: 在根组件层级包裹 ErrorBoundary，捕获渲染异常防止整个应用白屏
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
