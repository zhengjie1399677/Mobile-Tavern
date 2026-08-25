import type {
  EffectDisposer,
  EffectScopeState,
  IEffectScope,
} from "./types";

interface EffectEntry {
  active: boolean;
  disposer: EffectDisposer;
  releasePromise: Promise<void> | null;
}

/**
 * Scope 释放期间收集到的错误。
 *
 * 单个 Effect 失败不能阻止其他 Effect 回收；调用方仍会在全部清理结束后收到聚合错误，
 * 从而能够记录或阻断插件卸载结果。
 */
export class EffectScopeDisposeError extends Error {
  readonly scopeId: string;
  readonly errors: readonly unknown[];

  constructor(scopeId: string, errors: readonly unknown[]) {
    super(`EFFECT_SCOPE_DISPOSE_FAILED: ${scopeId} (${errors.length})`);
    this.name = "EffectScopeDisposeError";
    this.scopeId = scopeId;
    this.errors = [...errors];
  }
}

/**
 * 通用可撤销 Effect 作用域。
 *
 * Scope 不理解任何 Agent、聊天、插件或应用业务，只管理父子生命周期和清理顺序。
 */
export class EffectScope implements IEffectScope {
  readonly id: string;

  private stateValue: EffectScopeState = "active";
  private readonly effects: EffectEntry[] = [];
  private disposePromise: Promise<void> | null = null;

  constructor(id: string) {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error("EFFECT_SCOPE_ID_INVALID");
    this.id = normalizedId;
  }

  get state(): EffectScopeState {
    return this.stateValue;
  }

  add(disposer: EffectDisposer): EffectDisposer {
    this.assertActive();
    const entry: EffectEntry = { active: true, disposer, releasePromise: null };
    this.effects.push(entry);

    return async () => {
      await this.release(entry);
    };
  }

  fork(id: string): IEffectScope {
    this.assertActive();
    const child = new EffectScope(id);
    this.add(() => child.dispose());
    return child;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;

    this.stateValue = "disposing";
    // 延迟到微任务执行，确保 disposePromise 在任何 disposer 反向调用 dispose() 前已经赋值。
    this.disposePromise = Promise.resolve().then(() => this.disposeEffects());
    return this.disposePromise;
  }

  private async disposeEffects(): Promise<void> {
    const errors: unknown[] = [];
    const entries = [...this.effects].reverse();

    for (const entry of entries) {
      try {
        await this.release(entry);
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    this.stateValue = "disposed";
    if (errors.length > 0) throw new EffectScopeDisposeError(this.id, errors);
  }

  private release(entry: EffectEntry): Promise<void> {
    if (entry.releasePromise) return entry.releasePromise;
    if (!entry.active) return Promise.resolve();
    entry.active = false;
    // 条目必须保留到 disposer 真正结束。这样提前释放与 Scope.dispose() 并发时，
    // disposeEffects() 仍能看到该条目并等待同一个 releasePromise，而不会提前宣告 disposed。
    entry.releasePromise = Promise.resolve()
      .then(() => entry.disposer())
      .finally(() => {
        const index = this.effects.indexOf(entry);
        if (index >= 0) this.effects.splice(index, 1);
      });
    return entry.releasePromise;
  }

  private assertActive(): void {
    if (this.stateValue !== "active") {
      throw new Error(`EFFECT_SCOPE_NOT_ACTIVE: ${this.id} (${this.stateValue})`);
    }
  }
}

export function createEffectScope(id: string): IEffectScope {
  return new EffectScope(id);
}
