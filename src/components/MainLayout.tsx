import React, { Suspense, useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { VenetianMask, MessageSquare, Book, Settings, Users, LayoutGrid, HelpCircle, LoaderCircle, type LucideIcon } from "lucide-react";
import { useKernel } from "../contexts/KernelContext";
import type { IExtension } from "@/src/application/serviceContracts";
import type { TabType } from "../contexts/AppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { getVisibleBottomBarTabs } from "../domain/ui/mainTabVisibility";
import { isOutsideVisibleViewport, resolveAppViewportHeight } from "../utils/viewportLayout";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

const ICON_MAP: Record<string, LucideIcon> = {
  VenetianMask,
  Users,
  MessageSquare,
  LayoutGrid,
  Book,
  Settings,
};

import CharacterEditModal from "./CharacterEditModal";
import TimelineModal from "./TimelineModal";
import SessionManagerModal from "./SessionManagerModal";
import CustomConfirmDialog from "./CustomConfirmDialog";
import DbWritingOverlay from "./DbWritingOverlay";
import { FloatingCat } from "./FloatingCat";
import { FloatingCharacter } from "./FloatingCharacter";
import UpdatePrompt from "./UpdatePrompt";
import { PromptWorkbenchFocusProvider } from "../contexts/PromptWorkbenchFocusContext";
import { ThemeInteractionHost } from "./theme-interactions/ThemeInteractionHost";

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
    safeAreas,
    settings,
    currentTheme,
    runningPlugin,
    charModalOpen,
    timelineModalOpen,
    showSessionManager,
  } = useUnifiedApp((state) => ({
    activeTab: state.activeTab,
    setActiveTab: state.setActiveTab,
    safeAreas: state.safeAreas,
    settings: state.settings,
    currentTheme: state.currentTheme,
    runningPlugin: state.runningPlugin,
    charModalOpen: state.charModalOpen,
    timelineModalOpen: state.timelineModalOpen,
    showSessionManager: state.showSessionManager,
  }));
  const { t } = useTranslation();
  // 已激活过的 Tab 集合，用于 Keep-Alive 离屏保活。
  // 首次访问按需触发代码分块下载与挂载，之后保持挂载并通过 CSS display: none 切换，
  // 避免高频来回切换时的重复 Unmount / 销毁重绘与滚动丢失。
  const [mountedTabIds, setMountedTabIds] = React.useState<Set<string>>(
    () => new Set([activeTab]),
  );

  React.useEffect(() => {
    setMountedTabIds((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const appViewportRef = React.useRef<HTMLDivElement>(null);
  const [promptFocusActive, setPromptFocusActive] = React.useState(false);

  React.useEffect(() => {
    if (!promptFocusActive || activeTab === "settings") return;
    const bridge = (window as Window & {
      AndroidThemeBridge?: { setScreenOrientation?: (mode: "auto") => boolean };
    }).AndroidThemeBridge;
    bridge?.setScreenOrientation?.("auto");
    setPromptFocusActive(false);
  }, [activeTab, promptFocusActive]);

  React.useLayoutEffect(() => {
    const vvp = window.visualViewport;
    let frameId: number | null = null;
    let lastHeight = -1;
    const applyViewportHeight = () => {
      frameId = null;
      const nextHeight = resolveAppViewportHeight(window.innerHeight, vvp?.height);
      if (nextHeight <= 0 || nextHeight === lastHeight) return;
      lastHeight = nextHeight;
      appViewportRef.current?.style.setProperty("--app-viewport-height", `${nextHeight}px`);
    };
    const handleResize = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applyViewportHeight);
    };
    // 同时监听 window.resize 与 visualViewport.resize：interactive-widget=resizes-content
    // 模式下，部分 Android WebView（如 Android 16）键盘弹出时只触发 window.resize 而不触发
    // vvp.resize，仅监听 vvp.resize 会导致容器高度不更新、输入框被键盘遮挡。
    window.addEventListener("resize", handleResize);
    window.addEventListener("mobileTavernNativeResume", handleResize);
    if (vvp) vvp.addEventListener("resize", handleResize);
    handleResize();
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mobileTavernNativeResume", handleResize);
      if (vvp) vvp.removeEventListener("resize", handleResize);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  // 全局输入框聚焦滚动保障（KB-04/KB-05）：监听 document 的 focusin 事件，
  // 当任意 input/textarea 获得焦点时，延迟将其滚动到可见区域中央，
  // 解决页面级输入框在软键盘弹出时被遮挡的问题。
  React.useEffect(() => {
    let focusTimer: number | null = null;
    const handleFocusIn = (e: FocusEvent) => {
      if (activeTab === "chat" || activeTab === "playground") {
        return; // 聊天页面与游乐场有专属的视口动态缩放和精确归底避让，无需且严禁全局逻辑插手
      }
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        if (focusTimer !== null) window.clearTimeout(focusTimer);
        focusTimer = window.setTimeout(() => {
          focusTimer = null;
          if (document.activeElement !== target || !target.isConnected) return;
          const vvp = window.visualViewport;
          const viewport = {
            height: vvp?.height ?? window.innerHeight,
            offsetTop: vvp?.offsetTop ?? 0,
          };
          if (isOutsideVisibleViewport(target.getBoundingClientRect(), viewport)) {
            target.scrollIntoView({ block: "nearest", behavior: "auto" });
          }
        }, 250);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      if (focusTimer !== null) window.clearTimeout(focusTimer);
    };
  }, [activeTab]);

  useMobileBackHandler(true, React.useCallback(() => {
    if (promptFocusActive) {
      setPromptFocusActive(false);
      return true;
    }
    if (activeTab === "characters") return false;
    setActiveTab("characters");
    return true;
  }, [activeTab, promptFocusActive, setActiveTab]), 0);

  const tabs = kernel.getExtensions<React.ComponentType<Record<string, unknown>>>("main:tabs");
  const bottomBarTabs = getVisibleBottomBarTabs(tabs, settings.hiddenMainTabs);
  const registeredTabIds = tabs.map((tab) => tab.id).join("|");

  const handleBottomTabKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (bottomBarTabs.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % bottomBarTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + bottomBarTabs.length) % bottomBarTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = bottomBarTabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = bottomBarTabs[nextIndex];
    setActiveTab(nextTab.id as TabType);
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-ui="main-tab"][data-tab-id="${nextTab.id}"]`,
      );
      target?.focus({ preventScroll: true });
    });
  }, [bottomBarTabs, setActiveTab]);

  React.useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("characters");
    }
  }, [activeTab, registeredTabIds, setActiveTab]);

  const isActive = (tab: IExtension<React.ComponentType<Record<string, unknown>>>) => {
    if (tab.meta?.highlightOnActiveTabs) {
      return (tab.meta.highlightOnActiveTabs as string[]).includes(activeTab);
    }
    return activeTab === tab.id;
  };

  return (
    <PromptWorkbenchFocusProvider value={{
      active: promptFocusActive,
      managed: true,
      setActive: setPromptFocusActive,
    }}>
      <div
        ref={appViewportRef}
        data-ui-density={settings.uiDensity ?? "compact"}
        style={{ height: "var(--app-viewport-height, 100dvh)" }}
        className={`flex flex-col mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] ${
        activeTab === "settings" ? "max-w-lg landscape:max-w-none" : "max-w-lg"
      } ${
        activeTab === "chat" || activeTab === "playground" ? "pt-0" : "pt-[var(--safe-area-top)]"
      }`}>
        <ThemeInteractionHost
          currentTheme={String(currentTheme)}
          customThemes={settings.customThemes ?? []}
          activeTab={activeTab}
          mediaEnabled={settings.themeMediaEnabled ?? false}
        />

        {/* 全局微环境光晕：极度克制 (4%~6%)，为全站所有页面的毛玻璃（底栏、顶栏、抽屉卡片）注入真实光学漫反射底色 */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
          <div className="absolute -top-32 right-[-10%] h-[460px] w-[460px] rounded-full bg-indigo-500/[0.06] blur-[140px]" />
          <div className="absolute -bottom-36 left-[-10%] h-[440px] w-[440px] rounded-full bg-cyan-500/[0.05] blur-[140px]" />
        </div>

        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && activeTab !== "playground" && !promptFocusActive && (
          <div
            role="tablist"
            aria-label="底栏导航页签"
            data-ui="main-tab-bar"
            style={{ bottom: `${2 + (safeAreas?.bottom ?? 0)}px` }}
            className="absolute left-2.5 right-2.5 h-12 rounded-2xl bg-card/75 backdrop-blur-2xl border border-white/12 flex items-center justify-around z-20 shadow-[0_8px_32px_0_rgba(0,0,0,0.36),inset_0_1px_1px_0_rgba(255,255,255,0.15)] transition-all"
          >
            {bottomBarTabs.map((tab, index) => {
              const IconComp = ((tab.meta?.icon && ICON_MAP[tab.meta.icon as keyof typeof ICON_MAP]) || HelpCircle) as LucideIcon;
              const selected = isActive(tab);
              const localizedName = t("nav." + tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  role="tab"
                  data-ui="main-tab"
                  data-tab-id={tab.id}
                  aria-selected={selected}
                  aria-label={`${localizedName}${selected ? " (selected)" : ""}`}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(event) => handleBottomTabKeyDown(event, index)}
                  className={`relative flex h-full flex-1 flex-col items-center justify-center rounded-xl tap-scale transition-colors duration-200 ${
                    selected
                      ? "text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <IconComp className={`w-4 h-4 mb-0.5 transition-[filter] ${selected ? "drop-shadow-[0_0_4px_var(--primary)]" : ""}`} aria-hidden="true" />
                  <span className="text-[10px] font-medium leading-none landscape:hidden">{localizedName}</span>
                  {selected && (
                    <span className="absolute bottom-0.5 h-0.5 w-4 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 2. Content Sections Grid */}
        <div
          data-ui="main-tab-content"
          data-active-tab={activeTab}
          className="flex-1 relative flex flex-col min-h-0 overflow-hidden"
        >
          {tabs.map((tab) => {
            if (!mountedTabIds.has(tab.id)) return null;
            const isCurrent = activeTab === tab.id;
            const Comp = tab.value;
            const isFullScreenTab = tab.id === "chat" || tab.id === "playground" || promptFocusActive;

            return (
              <div
                key={tab.id}
                role="tabpanel"
                id={`main-tabpanel-${tab.id}`}
                aria-labelledby={`main-tab-${tab.id}`}
                aria-hidden={!isCurrent}
                style={{
                  display: isCurrent ? undefined : "none",
                  paddingBottom: !isFullScreenTab && activeTab !== "chat" && activeTab !== "playground" && !promptFocusActive
                    ? `${54 + (safeAreas?.bottom ?? 0)}px`
                    : undefined,
                }}
                className={`w-full h-full ${
                  isFullScreenTab
                    ? "flex flex-col min-h-0 pb-0 overflow-hidden"
                    : "overflow-y-auto flex-1"
                }`}
              >
                <Suspense fallback={<TabLoadingFallback />}>
                  {tab.id === "playground" ? (
                    <Comp onBack={() => setActiveTab("settings")} />
                  ) : (
                    <Comp />
                  )}
                </Suspense>
              </div>
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
        {activeTab !== "chat" &&
          activeTab !== "playground" &&
          activeTab !== "settings" &&
          !runningPlugin &&
          !charModalOpen &&
          !timelineModalOpen &&
          !showSessionManager && <FloatingCat />}

        {/* 5. Floating Character Assistant (current character card pet mode)
            受 settings.enableFloatingCharacter 控制，全 Tab 可见（聊天页除外避免遮挡立绘），
            订阅 CharacterRenderService 实时同步情绪与立绘。 */}
        {settings?.enableFloatingCharacter &&
          activeTab !== "chat" &&
          activeTab !== "playground" &&
          !runningPlugin &&
          !charModalOpen &&
          !timelineModalOpen &&
          !showSessionManager && (
            <FloatingCharacter enabled={true} />
          )}
      </div>
    </PromptWorkbenchFocusProvider>
  );
}
