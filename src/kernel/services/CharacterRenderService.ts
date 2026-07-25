import { IKernel, IKernelService } from "../types";
import { computeRenderState, PipelineInput, RenderState } from "../../services/characterRender/pipeline";

/**
 * 角色渲染管线内核服务。
 *
 * 职责：持有当前 RenderState，接受聊天流的 update() 推送，并向多消费者
 * （聊天立绘 / 应用内悬浮助手 / AR Activity）分发状态变更。
 *
 * 设计：
 *   - isCritical = false：缺失时 SafeProxy no-op 降级，不影响聊天主链路
 *   - 纯转发：计算逻辑在 pipeline.ts 纯函数，服务只管状态持有与订阅分发
 *   - 推模式：update() 同步计算并立即通知所有订阅者
 *   - 幂等：相同 input 重复 update 只在状态变化时通知（避免 AR 层无谓重绘）
 */
export class CharacterRenderService implements IKernelService {
  name = "characterRender";
  isCritical = false;
  dependencies = [] as const;

  private state: RenderState | null = null;
  private listeners = new Set<(s: RenderState) => void>();

  async init(_kernel: IKernel, _signal?: AbortSignal): Promise<void> {
    // 无需特殊初始化，状态由首个 update() 填充
  }

  async destroy(_kernel: IKernel, _signal?: AbortSignal): Promise<void> {
    this.listeners.clear();
    this.state = null;
  }

  /**
   * 聊天流每轮调用：根据 input 计算新状态并推送给所有订阅者。
   * 返回最新状态。
   */
  update(input: PipelineInput): RenderState {
    const next = computeRenderState(input);
    this.setState(next);
    return next;
  }

  /**
   * 直接推送已计算的 RenderState（供已在外部完成计算的消费者使用，避免重复计算）。
   * useCharacterPortrait hook 已在 useMemo 中调用 computeRenderState，用此方法推送。
   * 状态变化时才通知，避免 AR 层每帧无谓重绘。
   */
  setState(next: RenderState): void {
    if (
      !this.state ||
      this.state.emotion !== next.emotion ||
      this.state.portraitBase64 !== next.portraitBase64 ||
      this.state.glowColors.light1 !== next.glowColors.light1 ||
      this.state.glowColors.light2 !== next.glowColors.light2
    ) {
      this.state = next;
      this.listeners.forEach((fn) => fn(next));
    }
  }

  /**
   * 订阅状态变更。订阅时若已有状态，立即推送一次当前快照。
   * 返回取消订阅函数。
   */
  subscribe(fn: (s: RenderState) => void): () => void {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** 获取当前状态快照（可能为 null，首个 update 之前）。 */
  getState(): RenderState | null {
    return this.state;
  }
}
