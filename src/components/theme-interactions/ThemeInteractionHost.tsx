import React from "react";
import type {
  ILocalResourceService,
  IThemeInteractionService,
  ThemeInteractionSnapshot,
  ThemeMediaRuntimeState,
  ThemeOrientation,
} from "../../application/serviceContracts";
import { KernelServices } from "../../application/serviceContracts";
import type { ThemeMediaDefinition, ThemeMediaSurface } from "../../domain/themes/themeInteractionContract";
import { parseThemeInteractionConfig } from "../../domain/themes/themeInteractionContract";
import type { CustomThemePackage } from "../../utils/themePackage";
import { useKernel } from "../../contexts/KernelContext";

interface ThemeInteractionHostProps {
  currentTheme: string;
  customThemes: CustomThemePackage[];
  activeTab: string;
  mediaEnabled: boolean;
}

const EMPTY_SNAPSHOT: ThemeInteractionSnapshot = {
  revision: 0,
  themeId: null,
  mediaEnabled: false,
  media: {},
  surfaces: {},
  state: {},
  styleStates: [],
};

function getOrientation(): ThemeOrientation {
  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
}

function shouldRenderSurface(surface: ThemeMediaSurface, activeTab: string): boolean {
  if (surface === "main.background") return true;
  if (surface === "characters.background") return activeTab === "characters";
  return activeTab === "chat";
}

/** 将主题有限状态机连接到宿主可控的语义事件、本地资源与媒体元素。 */
export function ThemeInteractionHost({
  currentTheme,
  customThemes,
  activeTab,
  mediaEnabled,
}: ThemeInteractionHostProps) {
  const kernel = useKernel();
  const interactionService = React.useMemo(
    () => kernel.getService<IThemeInteractionService>(KernelServices.ThemeInteractions),
    [kernel],
  );
  const resourceService = React.useMemo(
    () => kernel.getService<ILocalResourceService>(KernelServices.LocalResources),
    [kernel],
  );
  const subscribe = React.useCallback(
    (listener: () => void) => interactionService.subscribe(listener),
    [interactionService],
  );
  const getSnapshot = React.useCallback(
    () => interactionService.getSnapshot(),
    [interactionService],
  );
  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_SNAPSHOT,
  );
  const [resourceUrls, setResourceUrls] = React.useState<Record<string, string>>({});
  const audioRefs = React.useRef(new Map<string, HTMLAudioElement>());
  const videoRefs = React.useRef(new Map<string, HTMLVideoElement>());
  const blockedPlayback = React.useRef(new Set<HTMLMediaElement>());
  const previousTab = React.useRef(activeTab);

  const themePackage = React.useMemo(
    () => customThemes.find(theme => theme.id === currentTheme),
    [currentTheme, customThemes],
  );

  React.useLayoutEffect(() => {
    interactionService.setEnvironment({
      mediaEnabled,
      activeTab,
      appVisible: document.visibilityState === "visible",
      orientation: getOrientation(),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, [activeTab, interactionService, mediaEnabled]);

  React.useEffect(() => {
    if (themePackage?.schemaVersion !== "1.1" || !themePackage.id) {
      interactionService.deactivateTheme();
      return;
    }
    const parsed = parseThemeInteractionConfig({
      media: themePackage.media ?? {},
      state: themePackage.state ?? {},
      interactions: themePackage.interactions ?? [],
    });
    if (!parsed.success || !parsed.config) {
      interactionService.deactivateTheme();
      return;
    }
    interactionService.activateTheme(themePackage.id, parsed.config);
    return () => interactionService.deactivateTheme();
  // 权限开关变化时重新激活主题，确保 theme.activate 的媒体动作和条件按新授权重算。
  }, [interactionService, mediaEnabled, themePackage]);

  React.useEffect(() => {
    interactionService.setEnvironment({ mediaEnabled });
  }, [interactionService, mediaEnabled]);

  React.useEffect(() => {
    const oldTab = previousTab.current;
    if (oldTab !== activeTab) interactionService.dispatch({ type: "tab.leave", tabId: oldTab });
    previousTab.current = activeTab;
    interactionService.setEnvironment({ activeTab });
    interactionService.dispatch({ type: "tab.enter", tabId: activeTab });
  }, [activeTab, interactionService]);

  React.useEffect(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateOrientation = () => {
      const orientation = getOrientation();
      interactionService.setEnvironment({ orientation });
      interactionService.dispatch({ type: "orientation.change", orientation });
    };
    const updateReducedMotion = () => interactionService.setEnvironment({ reducedMotion: reducedMotionQuery.matches });
    const updateVisibility = () => {
      const visible = document.visibilityState === "visible";
      interactionService.setEnvironment({ appVisible: visible });
      interactionService.dispatch({ type: visible ? "app.resume" : "app.pause" });
    };
    window.addEventListener("resize", updateOrientation);
    document.addEventListener("visibilitychange", updateVisibility);
    reducedMotionQuery.addEventListener("change", updateReducedMotion);
    return () => {
      window.removeEventListener("resize", updateOrientation);
      document.removeEventListener("visibilitychange", updateVisibility);
      reducedMotionQuery.removeEventListener("change", updateReducedMotion);
    };
  }, [interactionService]);

  React.useEffect(() => {
    const handleTap = (event: PointerEvent) => {
      const source = event.target;
      if (!(source instanceof Element)) return;
      const semanticTarget = source.closest<HTMLElement>("[data-ui]")?.dataset.ui;
      if (semanticTarget) interactionService.dispatch({ type: "ui.tap", target: semanticTarget });
    };
    document.addEventListener("pointerup", handleTap);
    return () => document.removeEventListener("pointerup", handleTap);
  }, [interactionService]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme-state", snapshot.styleStates.join(" "));
    return () => document.documentElement.removeAttribute("data-theme-state");
  }, [snapshot.styleStates]);

  React.useEffect(() => {
    let cancelled = false;
    const resolveResources = async () => {
      try {
        const definitions = Object.entries(snapshot.media);
        if (definitions.length === 0 || !snapshot.mediaEnabled) {
          setResourceUrls({});
          return;
        }
        const metadata = await resourceService.listResources();
        const kindById = new Map(metadata.map(resource => [resource.id, resource.kind]));
        const entries = await Promise.all(definitions.map(async ([mediaId, runtime]) => {
          const resourceId = runtime.definition.src.slice("tavern-resource://".length);
          if (kindById.get(resourceId) !== runtime.definition.type) return null;
          try {
            return [mediaId, await resourceService.resolveResourceReference(runtime.definition.src)] as const;
          } catch {
            return null;
          }
        }));
        if (!cancelled) setResourceUrls(Object.fromEntries(entries.filter(entry => entry !== null)));
      } catch {
        if (!cancelled) setResourceUrls({});
      }
    };
    void resolveResources();
    return () => { cancelled = true; };
  }, [resourceService, snapshot.media, snapshot.mediaEnabled, snapshot.themeId]);

  React.useEffect(() => {
    const syncElement = (element: HTMLMediaElement, runtime: ThemeMediaRuntimeState) => {
      element.volume = runtime.volume;
      if (runtime.status === "playing") {
        void element.play().then(() => blockedPlayback.current.delete(element)).catch(() => {
          blockedPlayback.current.add(element);
        });
      } else {
        element.pause();
        blockedPlayback.current.delete(element);
        if (runtime.status === "stopped") {
          try {
            element.currentTime = 0;
          } catch {
            // 尚未载入元数据或资源不可 seek 时，暂停本身已完成安全降级。
          }
        }
      }
    };
    for (const [mediaId, element] of audioRefs.current) {
      const runtime = snapshot.media[mediaId];
      if (runtime) syncElement(element, runtime);
    }
    for (const [key, element] of videoRefs.current) {
      const mediaId = key.slice(key.indexOf(":") + 1);
      const runtime = snapshot.media[mediaId];
      if (runtime) syncElement(element, runtime);
    }
  }, [resourceUrls, snapshot.media, snapshot.revision]);

  React.useEffect(() => {
    const retryBlockedPlayback = () => {
      for (const element of blockedPlayback.current) {
        void element.play().then(() => blockedPlayback.current.delete(element)).catch(() => undefined);
      }
    };
    document.addEventListener("pointerdown", retryBlockedPlayback);
    return () => document.removeEventListener("pointerdown", retryBlockedPlayback);
  }, []);

  const audioEntries = Object.entries(snapshot.media).filter((entry): entry is [string, ThemeMediaRuntimeState & { definition: Extract<ThemeMediaDefinition, { type: "audio" }> }] => (
    entry[1].definition.type === "audio" && Boolean(resourceUrls[entry[0]])
  ));
  const surfaceEntries = Object.entries(snapshot.surfaces).filter((entry): entry is [ThemeMediaSurface, { visible: boolean; mediaId: string }] => (
    Boolean(entry[1]?.visible) && shouldRenderSurface(entry[0] as ThemeMediaSurface, activeTab)
  ));

  return (
    <div data-ui="theme-media-host" className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {surfaceEntries.map(([surface, surfaceState]) => {
        const runtime = snapshot.media[surfaceState.mediaId];
        const definition = runtime?.definition;
        const url = resourceUrls[surfaceState.mediaId];
        if (!url || definition?.type !== "video") return null;
        const refKey = `${surface}:${surfaceState.mediaId}`;
        return (
          <video
            key={refKey}
            ref={element => {
              if (element) videoRefs.current.set(refKey, element);
              else videoRefs.current.delete(refKey);
            }}
            src={url}
            loop={definition.loop}
            muted={runtime.muted}
            preload={definition.preload}
            playsInline
            onEnded={() => interactionService.dispatch({ type: "media.ended", mediaId: surfaceState.mediaId })}
            className="absolute inset-0 h-full w-full"
            style={{ objectFit: definition.fit, zIndex: surface === "main.background" ? 0 : 1 }}
          />
        );
      })}
      {audioEntries.map(([mediaId, runtime]) => (
        <audio
          key={mediaId}
          ref={element => {
            if (element) audioRefs.current.set(mediaId, element);
            else audioRefs.current.delete(mediaId);
          }}
          src={resourceUrls[mediaId]}
          loop={runtime.definition.loop}
          preload={runtime.definition.preload}
          onEnded={() => interactionService.dispatch({ type: "media.ended", mediaId })}
        />
      ))}
    </div>
  );
}
