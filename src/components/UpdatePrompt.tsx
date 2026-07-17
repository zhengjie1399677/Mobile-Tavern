import React, { useEffect, useState } from "react";
import { DownloadCloud, Loader2, ArrowUpCircle, X } from "lucide-react";
import { IKernel, globalKernel } from "../kernel";
import { useKernel } from "../contexts/KernelContext";
import { useTranslation } from "../contexts/LanguageContext";
import { IUpdateCheckService, UpdateInfo } from "../kernel/types";

// === 更新检查策略常量 ===
// 6 小时冷却期：避免用户频繁冷启动 App 导致重复请求 FC 接口
const UPDATE_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// 24 小时定时轮询：App 长时间运行时周期性检查新版本
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 冷启动后延迟 2 秒发起首次检查，让主界面先渲染稳定
const UPDATE_CHECK_STARTUP_DELAY_MS = 2000;
const LAST_CHECK_KEY = "tavern_last_update_check_at";
const SHOW_UPDATE_PROMPT_EVENT = "tavern:show-update-prompt";

/**
 * 执行更新检查。
 * @param force true 时跳过 6h 冷却期强制检查（手动按钮触发场景）
 * @param kernel 传入的内核实例，用于解耦
 * @returns UpdateInfo；若冷却期内被跳过返回 null
 */
export async function performUpdateCheck(force = false, kernel?: IKernel): Promise<UpdateInfo | null> {
  // 冷却期检查：非强制模式下，距上次检查不足 6h 则跳过
  if (!force) {
    try {
      const lastCheckAt = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
      const elapsed = Date.now() - lastCheckAt;
      if (elapsed < UPDATE_CHECK_COOLDOWN_MS) {
        console.log(
          `[UpdateCheck] Skip: last check ${Math.floor(elapsed / 60000)}min ago, cooldown 6h`
        );
        return null;
      }
    } catch {
      // localStorage 不可用（如隐私模式）时继续执行检查
    }
  }

  const k = kernel || globalKernel;
  const updateService = k.getService<IUpdateCheckService>("updateCheck");
  if (!updateService) {
    console.warn("[UpdateCheck] UpdateCheckService not registered in kernel");
    return null;
  }

  // __APP_VERSION__ 注入 package.json 中的最新版本，符合版本同步规范
  const currentVersion = __APP_VERSION__;
  const res = await updateService.checkUpdate(currentVersion, undefined, force);

  // 记录检查时间戳（无论是否有更新），用于冷却期判断
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // ignore localStorage 写入失败
  }

  return res;
}

/**
 * 触发 UpdatePrompt 弹窗显示。
 * 供外部组件（如 SettingsTab 手动检查按钮）在拿到 UpdateInfo 后调用，
 * 避免重复发起 HTTP 请求。
 * @param info.message FC 函数返回的更新日志，会在弹窗中展示给用户
 */
export function showUpdatePrompt(info: { latestVersion?: string; downloadUrl?: string; message?: string }): void {
  window.dispatchEvent(
    new CustomEvent(SHOW_UPDATE_PROMPT_EVENT, {
      detail: {
        latestVersion: info.latestVersion || "1.6.0",
        downloadUrl: info.downloadUrl || "",
        message: info.message || "",
      },
    })
  );
}

/** 原生 Android 桥接对象（仅声明本文件用到的 openUrl 子集）。 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: { openUrl: (url: string) => void };
}

export default function UpdatePrompt() {
  const { t } = useTranslation();
  const kernel = useKernel();
  const [show, setShow] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  // FC 函数传下来的更新日志，替代原先 the fixed window text
  const [updateLog, setUpdateLog] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    // 内部辅助：执行检查并在检测到新版本时弹出 Modal
    const performCheckAndShow = async () => {
      // 本次会话已 dismiss 则不再弹窗打扰用户
      if (sessionStorage.getItem("tavern_update_dismissed") === "true") {
        return;
      }

      try {
        const res = await performUpdateCheck(false, kernel);
        if (res?.hasUpdate && res.downloadUrl) {
          if (res.enablePush === false) {
            console.log("[UpdatePrompt] New version detected, but enablePush is false. Skipping auto-prompt.");
            return;
          }
          setLatestVersion(res.latestVersion || "1.6.0");
          setDownloadUrl(res.downloadUrl);
          setUpdateLog(res.message || "");
          setShow(true);
        }
      } catch (err) {
        console.warn("[UpdatePrompt] Periodic check update failed:", err);
      }
    };

    // 1. 冷启动后延迟 2 秒发起首次检查（受 6h 冷却期约束）
    const timer = setTimeout(performCheckAndShow, UPDATE_CHECK_STARTUP_DELAY_MS);

    // 2. 24 小时定时轮询（App 长时间运行时周期性检查）
    const interval = setInterval(performCheckAndShow, UPDATE_CHECK_INTERVAL_MS);

    // 3. 监听外部触发弹窗事件（SettingsTab 手动检查后调用 showUpdatePrompt）
    const onShowUpdatePrompt = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        latestVersion: string;
        downloadUrl: string;
        message: string;
      };
      setLatestVersion(detail.latestVersion);
      setDownloadUrl(detail.downloadUrl);
      setUpdateLog(detail.message || "");
      setShow(true);
    };
    window.addEventListener(SHOW_UPDATE_PROMPT_EVENT, onShowUpdatePrompt);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(SHOW_UPDATE_PROMPT_EVENT, onShowUpdatePrompt);
    };
  }, []);

  const handleDownload = () => {
    if (!downloadUrl) return;
    setIsDownloading(true);

    // 延迟 1 秒后开始跳转，以便让用户看到 Premium 的反馈微动画
    setTimeout(() => {
      const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
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
          <DownloadCloud className="w-8 h-8" />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-indigo-950 animate-ping" />
        </div>

        {/* 主标题 + FC 传下来的更新日志 */}
        <div className="space-y-2 z-10 w-full">
          <h2 className="text-xl font-extrabold tracking-tight text-white bg-clip-text text-center">
            {t("update.new_version_title", { version: latestVersion })}
          </h2>
          {updateLog ? (
            <div className="text-xs text-slate-200 leading-relaxed max-h-[180px] overflow-y-auto scrollbar-thin bg-white/5 border border-white/10 rounded-xl p-3 whitespace-pre-wrap break-words text-left">
              {updateLog}
            </div>
          ) : null}
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
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("update.downloading")}</span>
              </>
            ) : (
              <>
                <ArrowUpCircle className="w-4 h-4" />
                <span>{t("update.download_now")}</span>
              </>
            )}
          </button>

          <button
            onClick={handleDismiss}
            disabled={isDownloading}
            className="w-full py-2.5 text-[11px] text-slate-400 hover:text-white font-medium hover:underline transition"
          >
            {t("update.later")}
          </button>
        </div>

        {/* 右上角关闭小叉 */}
        <button
          onClick={handleDismiss}
          disabled={isDownloading}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition"
          aria-label={t("update.close_aria")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
