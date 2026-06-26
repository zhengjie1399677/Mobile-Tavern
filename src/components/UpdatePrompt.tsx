import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { globalKernel } from "../kernel";
import { IUpdateCheckService } from "../kernel/types";
import pkg from "../../package.json";

export default function UpdatePrompt() {
  const [show, setShow] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    // 延迟 2 秒在冷启动完毕、主界面渲染稳定后静默发起检测
    const timer = setTimeout(async () => {
      // 检查 sessionStorage 避免在此次会话中重复弹窗打扰用户
      if (sessionStorage.getItem("tavern_update_dismissed") === "true") {
        return;
      }

      try {
        const updateService = globalKernel.getService<IUpdateCheckService>("updateCheck");
        if (updateService) {
          // pkg.version 自动读取 package.json 中的版本，符合版本同步规范
          const currentVersion = pkg.version || "1.5.9";
          const res = await updateService.checkUpdate(currentVersion);
          if (res.hasUpdate && res.downloadUrl) {
            setLatestVersion(res.latestVersion || "1.6.0");
            setDownloadUrl(res.downloadUrl);
            setShow(true);
          }
        }
      } catch (err) {
        console.warn("[UpdatePrompt] Check update failed", err);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleDownload = () => {
    if (!downloadUrl) return;
    setIsDownloading(true);

    // 延迟 1 秒后开始跳转，以便让用户看到 Premium 的反馈微动画
    setTimeout(() => {
      const bridge = (window as any).AndroidThemeBridge;
      if (bridge && typeof bridge.openUrl === "function") {
        // 原生 Android 桥接：吊起外部默认浏览器进行稳定下载与安装包触发
        bridge.openUrl(downloadUrl);
      } else {
        // 开发浏览器环境降级兜底：新标签页打开
        window.open(downloadUrl, "_blank");
      }
      
      // 弹出提示框，告知用户已唤起安全下载
      setTimeout(() => {
        setIsDownloading(false);
        setShow(false);
        // 本次会话标记为已处理
        sessionStorage.setItem("tavern_update_dismissed", "true");
      }, 800);
    }, 1000);
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem("tavern_update_dismissed", "true");
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-sm rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900/90 via-indigo-950/80 to-violet-950/90 border border-white/10 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col items-center text-center space-y-5">
        
        {/* 顶部绚丽的光晕底色 */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* 跃动感的更新图标 */}
        <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] animate-bounce">
          <Icons.DownloadCloud className="w-8 h-8" />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-indigo-950 animate-ping" />
        </div>

        {/* 主副标题 */}
        <div className="space-y-1 z-10">
          <h2 className="text-xl font-extrabold tracking-tight text-white bg-clip-text">
            ✨ 发现新版本 v{latestVersion}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed max-w-[280px]">
            检测到更稳定、流畅的版本已发布。为了获得最佳的使用体验，建议立即获取更新。
          </p>
        </div>

        {/* 提示环境信息 */}
        <div className="w-full py-2.5 px-4 rounded-xl bg-white/5 border border-white/5 text-[11px] text-indigo-200/90 flex items-center justify-center space-x-2 z-10 font-medium">
          <Icons.Wifi className="w-3.5 h-3.5 text-primary" />
          <span>推荐在 Wi-Fi 环境下极速升级</span>
        </div>

        {/* 按钮区域 */}
        <div className="w-full space-y-2 z-10">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="relative w-full h-11 bg-primary text-primary-foreground font-bold rounded-xl text-xs hover:bg-primary/90 active:scale-95 transition-all duration-150 flex items-center justify-center space-x-2 shadow-[0_4px_12px_rgba(var(--primary-rgb),0.2)] disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
                <span>正在唤起安全下载通道...</span>
              </>
            ) : (
              <>
                <Icons.ArrowUpCircle className="w-4 h-4" />
                <span>立即下载更新</span>
              </>
            )}
          </button>

          <button
            onClick={handleDismiss}
            disabled={isDownloading}
            className="w-full py-2.5 text-[11px] text-slate-400 hover:text-white font-medium hover:underline transition"
          >
            稍后更新
          </button>
        </div>

        {/* 右上角关闭小叉 */}
        <button
          onClick={handleDismiss}
          disabled={isDownloading}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition"
          aria-label="关闭更新提示"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
