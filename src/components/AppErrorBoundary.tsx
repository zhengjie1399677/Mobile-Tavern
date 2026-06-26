import React, { type ReactNode } from "react";

// PERF-01: 应用级 ErrorBoundary，捕获渲染异常防止整个 React 树白屏。
// 采用内联样式而非 Tailwind 类，确保即便 CSS 变量解析失败（如旧版 WebView 对 oklch() 不支持）
// 也能呈现可读的兜底界面与恢复入口。
// 注：沿用 FormattedText.tsx 中 LocalErrorBoundary 的写法（useDefineForClassFields=false 兼容）。
interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

class AppErrorBoundary extends React.Component<any, any> {
  state: any = { hasError: false, error: null };
  props: any;

  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[AppErrorBoundary] Render error caught:", error, errorInfo);
  }

  handleRetry = (): void => {
    // 强制刷新页面以恢复应用（页面重载会自动重置 React state）
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(
        this.state.error ?? new Error("Unknown error"),
        this.handleRetry
      );
    }

    const error = this.state.error;
    const errorMessage: string = error?.message || "未知错误";

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          paddingTop: "calc(24px + env(safe-area-inset-top))",
          paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
          background: "#1a1a1a",
          color: "#e5e5e5",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div style={{ maxWidth: "480px", width: "100%" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }} aria-hidden>⚠️</div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}>
            应用渲染异常
          </h1>
          <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "20px", lineHeight: 1.6 }}>
            Mobile Tavern 遇到了渲染错误。可以尝试重新加载应用以恢复；如反复出现，请检查最近导入的角色卡或世界书内容。
          </p>
          {error && (
            <pre
              style={{
                fontSize: "12px",
                background: "#000",
                color: "#f87171",
                padding: "12px",
                borderRadius: "6px",
                marginBottom: "20px",
                overflow: "auto",
                maxHeight: "200px",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: "0 0 20px 0",
              }}
            >
              {errorMessage}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: "10px 24px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            重新加载应用
          </button>
        </div>
      </div>
    );
  }
}

export { AppErrorBoundary };
export default AppErrorBoundary;
