import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { initViewportDiagnostic } from "./utils/viewportDiagnostic.ts";
import "./index.css";

// 视口诊断黑匣子：在 React 挂载前尽早初始化，捕获从启动起的完整 resize 事件序列，
// 供系统报告回溯键盘遮挡等瞬态问题的现场。
initViewportDiagnostic();

// PERF-01: 在根组件层级包裹 ErrorBoundary，捕获渲染异常防止整个应用白屏
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
