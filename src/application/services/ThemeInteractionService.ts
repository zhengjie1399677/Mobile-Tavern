import type {
  IKernel,
  IThemeInteractionService,
  ThemeInteractionEnvironment,
  ThemeInteractionEvent,
  ThemeInteractionSnapshot,
  ThemeMediaRuntimeState,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import {
  THEME_INTERACTION_LIMITS,
  type ThemeInteractionAction,
  type ThemeInteractionCondition,
  type ThemeInteractionConfig,
  type ThemeInteractionRule,
  type ThemeMediaSurface,
  type ThemeStateValue,
} from "../../domain/themes/themeInteractionContract";

const DEFAULT_ENVIRONMENT: ThemeInteractionEnvironment = {
  mediaEnabled: false,
  orientation: "portrait",
  activeTab: "characters",
  appVisible: true,
  reducedMotion: false,
};

function emptySnapshot(revision = 0, mediaEnabled = false): ThemeInteractionSnapshot {
  return {
    revision,
    themeId: null,
    mediaEnabled,
    media: {},
    surfaces: {},
    state: {},
    styleStates: [],
  };
}

/**
 * 主题声明式交互的应用层编排器。
 *
 * 它只维护有限状态、规则冷却和延迟任务；DOM、媒体元素与本地资源解析由 UI Host 负责。
 */
export class ThemeInteractionService implements IThemeInteractionService {
  readonly name = KernelServices.ThemeInteractions;
  readonly isCritical = false;

  private environment: ThemeInteractionEnvironment = { ...DEFAULT_ENVIRONMENT };
  private config: ThemeInteractionConfig | null = null;
  private snapshot: ThemeInteractionSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly lastRunAt = new Map<string, number>();
  private readonly completedOnce = new Set<string>();
  private readonly explicitStyleStates = new Set<string>();
  private activationGeneration = 0;

  init(_kernel: IKernel): void {
    this.environment = { ...DEFAULT_ENVIRONMENT };
    this.snapshot = emptySnapshot();
  }

  destroy(_kernel?: IKernel): void {
    this.deactivateTheme();
    this.listeners.clear();
  }

  activateTheme(themeId: string, config: ThemeInteractionConfig): void {
    if (this.config) this.dispatch({ type: "theme.deactivate" });
    this.clearRuntime();
    this.config = config;
    this.activationGeneration += 1;

    const media = Object.fromEntries(Object.entries(config.media).map(([id, definition]) => [
      id,
      {
        definition,
        status: "stopped",
        volume: definition.volume,
        muted: definition.type === "video" ? definition.muted : false,
      } satisfies ThemeMediaRuntimeState,
    ]));
    const state = Object.fromEntries(Object.entries(config.state).map(([key, definition]) => [
      key,
      definition.default,
    ]));
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      themeId,
      mediaEnabled: this.environment.mediaEnabled,
      media,
      surfaces: {},
      state,
      styleStates: this.buildStyleStates(state),
    };
    this.emit();
    this.dispatch({ type: "theme.activate" });
  }

  deactivateTheme(): void {
    if (this.config) this.dispatch({ type: "theme.deactivate" });
    const nextRevision = this.snapshot.revision + 1;
    this.config = null;
    this.activationGeneration += 1;
    this.clearRuntime();
    this.snapshot = emptySnapshot(nextRevision, this.environment.mediaEnabled);
    this.emit();
  }

  setEnvironment(patch: Partial<ThemeInteractionEnvironment>): void {
    this.environment = { ...this.environment, ...patch };
    const mediaAllowed = this.environment.mediaEnabled && this.environment.appVisible;
    const media = Object.fromEntries(Object.entries(this.snapshot.media).map(([id, runtime]) => [
      id,
      mediaAllowed || runtime.status !== "playing"
        ? runtime
        : { ...runtime, status: "paused" as const },
    ]));
    this.commit({ mediaEnabled: this.environment.mediaEnabled, media });
  }

  dispatch(event: ThemeInteractionEvent): void {
    if (!this.config) return;
    if (event.type === "media.ended" && event.mediaId) {
      this.updateMedia(event.mediaId, runtime => ({ ...runtime, status: "stopped" }));
    }

    const now = Date.now();
    for (const rule of this.config.interactions) {
      if (!this.matchesEvent(rule, event) || !this.matchesConditions(rule.if)) continue;
      if (rule.once && this.completedOnce.has(rule.id)) continue;
      const lastRunAt = this.lastRunAt.get(rule.id);
      if (lastRunAt !== undefined && now - lastRunAt < rule.cooldownMs) continue;

      this.lastRunAt.set(rule.id, now);
      if (rule.once) this.completedOnce.add(rule.id);
      for (const action of rule.do) this.runAction(action);
    }
  }

  getSnapshot(): ThemeInteractionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private matchesEvent(rule: ThemeInteractionRule, event: ThemeInteractionEvent): boolean {
    const when = rule.when;
    return when.event === event.type &&
      (!when.target || when.target === event.target) &&
      (!when.tabId || when.tabId === event.tabId) &&
      (!when.orientation || when.orientation === event.orientation) &&
      (!when.mediaId || when.mediaId === event.mediaId);
  }

  private matchesConditions(conditions: ThemeInteractionCondition[]): boolean {
    return conditions.every(condition => {
      switch (condition.condition) {
        case "state.equals":
          return this.snapshot.state[condition.key] === condition.value;
        case "tab.is":
          return this.environment.activeTab === condition.value;
        case "orientation.is":
          return this.environment.orientation === condition.value;
        case "media.enabled":
          return this.environment.mediaEnabled === condition.value;
        case "accessibility.reducedMotion":
          return this.environment.reducedMotion === condition.value;
      }
    });
  }

  private runAction(action: ThemeInteractionAction): void {
    if (action.delayMs > 0) {
      if (this.timers.size >= THEME_INTERACTION_LIMITS.maxPendingTimers) return;
      const generation = this.activationGeneration;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (generation === this.activationGeneration && this.config) {
          this.executeAction({ ...action, delayMs: 0 } as ThemeInteractionAction);
        }
      }, action.delayMs);
      this.timers.add(timer);
      return;
    }
    this.executeAction(action);
  }

  private executeAction(action: ThemeInteractionAction): void {
    switch (action.action) {
      case "media.play":
        if (this.environment.mediaEnabled && this.environment.appVisible) {
          this.updateMedia(action.target, runtime => ({ ...runtime, status: "playing" }));
        }
        return;
      case "media.pause":
        this.updateMedia(action.target, runtime => ({ ...runtime, status: "paused" }));
        return;
      case "media.stop":
        this.updateMedia(action.target, runtime => ({ ...runtime, status: "stopped" }));
        return;
      case "media.setVolume":
        this.updateMedia(action.target, runtime => ({ ...runtime, volume: action.volume }));
        return;
      case "media.setMuted":
        this.updateMedia(action.target, runtime => ({ ...runtime, muted: action.muted }));
        return;
      case "surface.show":
        if (this.environment.mediaEnabled) {
          this.commit({ surfaces: { ...this.snapshot.surfaces, [action.target]: { visible: true, mediaId: action.mediaId } } });
        }
        return;
      case "surface.hide": {
        const surfaces = { ...this.snapshot.surfaces };
        delete surfaces[action.target];
        this.commit({ surfaces });
        return;
      }
      case "state.set":
        this.updateState(action.key, action.value);
        return;
      case "state.toggle":
        this.updateState(action.key, !this.snapshot.state[action.key]);
        return;
      case "state.increment": {
        const definition = this.config?.state[action.key];
        const current = this.snapshot.state[action.key];
        if (definition?.type === "counter" && typeof current === "number") {
          this.updateState(action.key, Math.min(definition.max, Math.max(definition.min, current + action.amount)));
        }
        return;
      }
      case "theme.state.add":
        this.explicitStyleStates.add(action.value);
        this.commitStyleStates();
        return;
      case "theme.state.remove":
        this.explicitStyleStates.delete(action.value);
        this.commitStyleStates();
        return;
      case "theme.state.replace":
        for (const token of this.explicitStyleStates) {
          if (token === action.group || token.startsWith(`${action.group}-`)) {
            this.explicitStyleStates.delete(token);
          }
        }
        this.explicitStyleStates.add(action.value);
        this.commitStyleStates();
        return;
    }
  }

  private updateMedia(id: string, update: (runtime: ThemeMediaRuntimeState) => ThemeMediaRuntimeState): void {
    const current = this.snapshot.media[id];
    if (!current) return;
    this.commit({ media: { ...this.snapshot.media, [id]: update(current) } });
  }

  private updateState(key: string, value: ThemeStateValue): void {
    const state = { ...this.snapshot.state, [key]: value };
    this.commit({ state, styleStates: this.buildStyleStates(state) });
  }

  private commitStyleStates(): void {
    this.commit({ styleStates: this.buildStyleStates(this.snapshot.state) });
  }

  private buildStyleStates(state: Record<string, ThemeStateValue>): string[] {
    const derived = Object.entries(state).map(([key, value]) => `${key}-${String(value)}`);
    return [...new Set([...this.explicitStyleStates, ...derived])].sort();
  }

  private commit(patch: Partial<Omit<ThemeInteractionSnapshot, "revision" | "themeId">>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private clearRuntime(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.lastRunAt.clear();
    this.completedOnce.clear();
    this.explicitStyleStates.clear();
  }
}
