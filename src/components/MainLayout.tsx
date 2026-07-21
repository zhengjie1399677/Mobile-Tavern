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

function TabLoadingFallback() {
  return (
    <div
      role="status"
      aria-label="正在加载功能页面"
      className="flex min-h-full w-full items-center justify-center bg-background text-muted-foreground"
    >
      <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
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

  const [viewportHeight, setViewportHeight] = React.useState<number | null>(null);

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
    <>
      <SplashScreen isVisible={showSplash} />
      <div
        style={viewportHeight ? { height: `${viewportHeight}px` } : undefined}
        className={`flex flex-col h-[100dvh] mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] ${
        activeTab === "settings" ? "max-w-lg landscape:max-w-none" : "max-w-lg"
      } ${
        activeTab === "chat" || activeTab === "playground" ? "pt-0" : "pt-[var(--safe-area-top)]"
      }`}>
        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && activeTab !== "playground" && (
          <div
            role="tablist"
            aria-label="底栏导航页签"
            style={{ bottom: `${(activeTab === "settings" ? 2 : 16) + (safeAreas?.bottom ?? 0)}px` }}
            className={`absolute bg-card/60 backdrop-blur-xl border border-white/10 flex items-center justify-around z-20 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)] ${
              activeTab === "settings"
                ? "left-2 right-2 h-12 landscape:h-11 rounded-xl"
                : "left-4 right-4 h-16 rounded-2xl"
            }`}
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
                  className={`relative flex flex-col items-center justify-center flex-1 my-auto mx-1 rounded-xl tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    activeTab === "settings" ? "h-full" : "h-[80%]"
                  } ${
                    selected
                      ? "text-primary scale-105 font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {/* 胶囊背景平移动效 */}
                  <div className={`absolute inset-0 rounded-xl bg-primary/8 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] -z-10 ${
                    selected ? "scale-100 opacity-100" : "scale-75 opacity-0 pointer-events-none"
                  }`} />
                  <IconComp className="w-5 h-5 mb-0.5" aria-hidden="true" />
                  <span className={`text-[10px] ${activeTab === "settings" ? "landscape:hidden" : ""}`}>{localizedName}</span>
                  {selected && (
                    <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--primary)]" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 2. Content Sections Grid */}
        <div
          style={activeTab !== "chat" && activeTab !== "playground" ? {
            paddingBottom: `${(activeTab === "settings" ? 54 : 96) + (safeAreas?.bottom ?? 0)}px`
          } : undefined}
          className={`flex-1 relative ${activeTab === "chat" || activeTab === "playground"
              ? "flex flex-col min-h-0 pb-0 overflow-hidden"
              : "overflow-y-auto"
            }`}
        >
          {tabs.map(tab => {
            if (activeTab !== tab.id) return null;
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
    </>
  );
}
