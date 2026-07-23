import React, { Suspense, useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { SplashScreen } from "./SplashScreen";
import { VenetianMask, MessageSquare, Book, Settings, HelpCircle, LoaderCircle } from "lucide-react";
import { useKernel } from "../contexts/KernelContext";
import type { TabType } from "../contexts/AppContext";
import { useTranslation } from "../contexts/LanguageContext";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  VenetianMask,
  MessageSquare,
  Book,
  Settings,
};

import CharacterEditModal from "./CharacterEditModal";
import TimelineModal from "./TimelineModal";
import SessionManagerModal from "./SessionManagerModal";
import CustomConfirmDialog from "./CustomConfirmDialog";
import DbWritingOverlay from "./DbWritingOverlay";
import { FloatingCat } from "./FloatingCat";
import UpdatePrompt from "./UpdatePrompt";
import { PromptWorkbenchFocusProvider } from "../contexts/PromptWorkbenchFocusContext";

function TabLoadingFallback() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 350);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-label="正在加载功能页面"
      className="flex min-h-full w-full items-center justify-center bg-background text-muted-foreground"
    >
      {visible && <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />}
    </div>
  );
}

export default function MainLayout() {
  const kernel = useKernel();
  const {
    activeTab,
    setActiveTab,
    showSplash,
    safeAreas,
  } = useUnifiedApp((state) => ({
    activeTab: state.activeTab,
    setActiveTab: state.setActiveTab,
    showSplash: state.showSplash,
    safeAreas: state.safeAreas,
  }));
  const { t } = useTranslation();
  // Suspense 在新的懒加载页就绪前继续渲染上一个已完成页面，避免快速分包加载时
  // 局部 loading 转圈闪现；底栏仍立即使用 activeTab 提供触控反馈。
  const deferredActiveTab = React.useDeferredValue(activeTab);

  const [viewportHeight, setViewportHeight] = React.useState<number | null>(null);
  const [promptFocusActive, setPromptFocusActive] = React.useState(false);

  React.useEffect(() => {
    if (!promptFocusActive || activeTab === "settings") return;
    const bridge = (window as Window & {
      AndroidThemeBridge?: { setScreenOrientation?: (mode: "auto") => boolean };
    }).AndroidThemeBridge;
    bridge?.setScreenOrientation?.("auto");
    setPromptFocusActive(false);
  }, [activeTab, promptFocusActive]);

  React.useEffect(() => {
    const vvp = window.visualViewport;
    if (!vvp) return;
    const handleResize = () => {
      setViewportHeight(Math.min(vvp.height, window.innerHeight));
    };
    vvp.addEventListener("resize", handleResize);
    handleResize();
    return () => vvp.removeEventListener("resize", handleResize);
  }, []);

  // 全局输入框聚焦滚动保障（KB-04/KB-05）：监听 document 的 focusin 事件，
  // 当任意 input/textarea 获得焦点时，延迟将其滚动到可见区域中央，
  // 解决页面级输入框在软键盘弹出时被遮挡的问题。
  React.useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      if (activeTab === "chat" || activeTab === "playground") {
        return; // 聊天页面与游乐场有专属的视口动态缩放和精确归底避让，无需且严禁全局逻辑插手
      }
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        setTimeout(() => {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 300);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [activeTab]);

  const tabs = kernel.getExtensions("main:tabs");
  const bottomBarTabs = tabs.filter(t => t.meta?.showInBottomBar);

  const isActive = (tab: any) => {
    if (tab.meta?.highlightOnActiveTabs) {
      return tab.meta.highlightOnActiveTabs.includes(activeTab);
    }
    return activeTab === tab.id;
  };

  return (
    <PromptWorkbenchFocusProvider value={{
      active: promptFocusActive,
      managed: true,
      setActive: setPromptFocusActive,
    }}>
      <SplashScreen isVisible={showSplash} />
      <div
        style={viewportHeight ? { height: `${viewportHeight}px` } : undefined}
        className={`flex flex-col h-[100dvh] mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] ${
        activeTab === "settings" ? "max-w-lg landscape:max-w-none" : "max-w-lg"
      } ${
        activeTab === "chat" || activeTab === "playground" ? "pt-0" : "pt-[var(--safe-area-top)]"
      }`}>
        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && activeTab !== "playground" && !promptFocusActive && (
          <div
            role="tablist"
            aria-label="底栏导航页签"
            style={{ bottom: `${2 + (safeAreas?.bottom ?? 0)}px` }}
            className="absolute left-2 right-2 h-12 rounded-xl bg-card/70 backdrop-blur-xl border border-white/10 flex items-center justify-around z-20 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)]"
          >
            {bottomBarTabs.map(tab => {
              const IconComp = (tab.meta?.icon && ICON_MAP[tab.meta.icon]) || HelpCircle;
              const selected = isActive(tab);
              const localizedName = t("nav." + tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  role="tab"
                  aria-selected={selected}
                  aria-label={`${localizedName}${selected ? " (selected)" : ""}`}
                  className={`relative flex h-full flex-1 flex-col items-center justify-center rounded-xl tap-scale transition-colors duration-200 ${
                    selected
                      ? "text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <IconComp className={`w-5 h-5 mb-0.5 transition-[filter] ${selected ? "drop-shadow-[0_0_5px_var(--primary)]" : ""}`} aria-hidden="true" />
                  <span className="text-[10px] landscape:hidden">{localizedName}</span>
                  {selected && (
                    <span className="absolute bottom-0.5 h-0.5 w-5 rounded-full bg-primary shadow-[0_0_7px_var(--primary)]" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 2. Content Sections Grid */}
        <div
          aria-busy={deferredActiveTab !== activeTab}
          style={activeTab !== "chat" && activeTab !== "playground" && !promptFocusActive ? {
            paddingBottom: `${54 + (safeAreas?.bottom ?? 0)}px`
          } : undefined}
          className={`flex-1 relative ${activeTab === "chat" || activeTab === "playground" || promptFocusActive
              ? "flex flex-col min-h-0 pb-0 overflow-hidden"
              : "overflow-y-auto"
            }`}
        >
          {tabs.map(tab => {
            if (deferredActiveTab !== tab.id) return null;
            const Comp = tab.component;
            if (tab.id === "playground") {
              return (
                <Suspense key={tab.id} fallback={<TabLoadingFallback />}>
                  <Comp onBack={() => setActiveTab("settings")} />
                </Suspense>
              );
            }
            return (
              <Suspense key={tab.id} fallback={<TabLoadingFallback />}>
                <Comp />
              </Suspense>
            );
          })}
        </div>

        {/* 3. Global Modal Overlays */}
        <CharacterEditModal />
        <TimelineModal />
        <SessionManagerModal />
        <CustomConfirmDialog />
        <DbWritingOverlay />
        <UpdatePrompt />

        {/* 4. Global Cat Mascot (Only displayed on lists/settings, unmounted in chat rooms) */}
        {activeTab !== "chat" && activeTab !== "playground" && activeTab !== "settings" && <FloatingCat />}
      </div>
    </PromptWorkbenchFocusProvider>
  );
}
