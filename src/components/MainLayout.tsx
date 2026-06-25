import React, { useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { SplashScreen } from "./SplashScreen";
import * as Icons from "lucide-react";
import { globalKernel } from "../kernel";

import CharacterEditModal from "./CharacterEditModal";
import TimelineModal from "./TimelineModal";
import SessionManagerModal from "./SessionManagerModal";
import CustomConfirmDialog from "./CustomConfirmDialog";
import DbWritingOverlay from "./DbWritingOverlay";
import { FloatingCat } from "./FloatingCat";

export default function MainLayout() {
  const {
    activeTab,
    setActiveTab,
    showSplash,
    safeAreas,
  } = useUnifiedApp();

  const [viewportHeight, setViewportHeight] = React.useState<number | null>(null);

  React.useEffect(() => {
    const vvp = window.visualViewport;
    if (!vvp) return;
    const handleResize = () => {
      setViewportHeight(vvp.height);
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
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        setTimeout(() => {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 300);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  const tabs = globalKernel.getExtensions("main:tabs");
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
        className={`flex flex-col h-[100dvh] max-w-lg mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] ${
        activeTab === "chat" || activeTab === "playground" ? "pt-0" : "pt-[var(--safe-area-top)]"
      }`}>
        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && activeTab !== "playground" && (
          <div
            role="tablist"
            aria-label="底栏导航页签"
            style={{ bottom: `${16 + (safeAreas?.bottom ?? 0)}px` }}
            className="absolute left-4 right-4 h-16 rounded-2xl bg-card/60 backdrop-blur-xl border border-white/10 flex items-center justify-around z-20 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)]"
          >
            {bottomBarTabs.map(tab => {
              const IconComp = (Icons as any)[tab.meta?.icon] || Icons.HelpCircle;
              const selected = isActive(tab);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  role="tab"
                  aria-selected={selected}
                  aria-label={`页签，${tab.meta?.name}${selected ? "，当前选中" : ""}`}
                  className={`relative flex flex-col items-center justify-center flex-1 h-full tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    selected
                      ? "text-primary scale-110 font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <IconComp className="w-5 h-5 mb-0.5" aria-hidden="true" />
                  <span className="text-[10px]">{tab.meta?.name}</span>
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
          style={activeTab !== "chat" && activeTab !== "playground" ? { paddingBottom: `${96 + (safeAreas?.bottom ?? 0)}px` } : undefined}
          className={`flex-1 relative ${activeTab === "chat" || activeTab === "playground"
              ? "flex flex-col min-h-0 pb-0 overflow-hidden"
              : "overflow-y-auto"
            }`}
        >
          {tabs.map(tab => {
            if (activeTab !== tab.id) return null;
            const Comp = tab.component;
            if (tab.id === "playground") {
              return <Comp key={tab.id} onBack={() => setActiveTab("settings")} />;
            }
            return <Comp key={tab.id} />;
          })}
        </div>

        {/* 3. Global Modal Overlays */}
        <CharacterEditModal />
        <TimelineModal />
        <SessionManagerModal />
        <CustomConfirmDialog />
        <DbWritingOverlay />

        {/* 4. Global Cat Mascot (Only displayed on lists/settings, unmounted in chat rooms) */}
        {activeTab !== "chat" && activeTab !== "playground" && <FloatingCat />}
      </div>
    </>
  );
}
