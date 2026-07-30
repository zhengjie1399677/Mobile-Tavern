/**
 * CharacterRenderService 内核服务单元测试。
 *
 * 覆盖：
 *   - update / setState 状态推送与幂等性
 *   - subscribe 订阅与立即推送当前快照
 *   - getState 快照读取
 *   - destroy 资源清理
 */
import { describe, it, expect, vi } from "vitest";
import { CharacterRenderService } from "../../src/application/services/CharacterRenderService";
import { RenderState } from "../../src/services/characterRender/pipeline";

function makeState(overrides: Partial<RenderState> = {}): RenderState {
  return {
    emotion: "默认",
    portraitBase64: "avatar.png",
    glowColors: { light1: "rgba(1,2,3,0.5)", light2: "rgba(4,5,6,0.3)" },
    ...overrides,
  };
}

describe("CharacterRenderService — 生命周期", () => {
  it("init 不抛错", async () => {
    const service = new CharacterRenderService();
    await expect(service.init({} as any)).resolves.toBeUndefined();
  });

  it("destroy 清空 listeners 和 state", async () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);
    service.setState(makeState());
    expect(service.getState()).not.toBeNull();

    await service.destroy({} as any);

    expect(service.getState()).toBeNull();
    // destroy 后再 setState 不应通知已清空的 listeners
    service.setState(makeState({ emotion: "joy" }));
    expect(fn).not.toHaveBeenCalledWith(expect.objectContaining({ emotion: "joy" }));
  });
});

describe("CharacterRenderService — setState 幂等性", () => {
  it("相同状态不重复通知订阅者", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    const state = makeState();
    service.setState(state);
    expect(fn).toHaveBeenCalledTimes(1);

    // 完全相同状态再推送，不应通知
    service.setState(makeState());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("emotion 变化时通知", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    service.setState(makeState({ emotion: "默认" }));
    service.setState(makeState({ emotion: "joy" }));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ emotion: "joy" }));
  });

  it("portraitBase64 变化时通知", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    service.setState(makeState({ portraitBase64: "a.png" }));
    service.setState(makeState({ portraitBase64: "b.png" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("glowColors.light1 变化时通知", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    service.setState(makeState());
    service.setState(makeState({ glowColors: { light1: "new", light2: "rgba(4,5,6,0.3)" } }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("glowColors.light2 变化时通知", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    service.setState(makeState());
    service.setState(makeState({ glowColors: { light1: "rgba(1,2,3,0.5)", light2: "new" } }));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("CharacterRenderService — subscribe", () => {
  it("订阅时已有状态立即推送一次快照", () => {
    const service = new CharacterRenderService();
    service.setState(makeState({ emotion: "joy" }));

    const fn = vi.fn();
    service.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ emotion: "joy" }));
  });

  it("订阅时无状态不推送", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("取消订阅后不再接收通知", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    const unsubscribe = service.subscribe(fn);

    service.setState(makeState({ emotion: "joy" }));
    expect(fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    service.setState(makeState({ emotion: "sad" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("多订阅者独立接收", () => {
    const service = new CharacterRenderService();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    service.subscribe(fn1);
    service.subscribe(fn2);

    service.setState(makeState({ emotion: "joy" }));
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    // 取消 fn1 后只有 fn2 接收
    fn1.mockClear();
    fn2.mockClear();
    service.subscribe(fn1); // 重新订阅会立即推送
    fn1.mockClear();
    fn2.mockClear();

    service.setState(makeState({ emotion: "sad" }));
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

describe("CharacterRenderService — getState", () => {
  it("初始状态为 null", () => {
    const service = new CharacterRenderService();
    expect(service.getState()).toBeNull();
  });

  it("setState 后返回最新状态", () => {
    const service = new CharacterRenderService();
    const state = makeState({ emotion: "anger" });
    service.setState(state);
    expect(service.getState()).toEqual(state);
  });
});

describe("CharacterRenderService — update 集成", () => {
  it("update 调用 computeRenderState 并推送结果", () => {
    const service = new CharacterRenderService();
    const fn = vi.fn();
    service.subscribe(fn);

    const result = service.update({
      lastAssistantText: "",
      character: { avatar: "test.png" } as any,
      expressionTriggers: {},
    });

    expect(result.emotion).toBe("默认");
    expect(result.portraitBase64).toBe("test.png");
    expect(fn).toHaveBeenCalledWith(result);
  });
});
