// 输入框"按键路径"回归：按键不得触发可避免的样式写入/同步重排，也不得无故拉动消息列表滚动位置。
// 说明：绘制时序（useLayoutEffect 保证高度在绘制前定稿）与真机观感只能由 e2e 逐帧探针覆盖，
// 此处用 spy 计数锁定"每个按键做了什么、绝不做什么"的可复现部分。
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useComposerAutosize,
  useComposerCompatibilityVariables,
} from "../../src/tabs/chat/useComposerInputPath";
import type { ChatSession } from "../../src/types";
import {
  KernelServices,
  type IKernelService,
} from "../../src/application/serviceContracts";

/** 可变 ref 包装，绕过 React.RefObject 的 readonly 限制注入假节点 */
type MutableRef<T> = { current: T };

/** 假 textarea：只暴露 Hook 会访问的 style.height 与 scrollHeight，并记录写入与读取次数 */
function createFakeTextarea(contentHeight: number) {
  const state = {
    contentHeight,
    heightWrites: [] as string[],
    scrollHeightReads: 0,
  };
  const element = {
    style: {
      get height(): string {
        return state.heightWrites.at(-1) ?? "";
      },
      set height(value: string) {
        state.heightWrites.push(value);
      },
    },
    get scrollHeight(): number {
      state.scrollHeightReads += 1;
      return state.contentHeight;
    },
  };
  return { state, element: element as unknown as HTMLTextAreaElement };
}

/** 假消息列表滚动容器：贴底判定所需的三个数字，并按浏览器行为把 scrollTop 收敛到合法区间 */
function createFakeScroller(options: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const state = {
    scrollHeight: options.scrollHeight,
    clientHeight: options.clientHeight,
    scrollTop: options.scrollTop,
    /** scrollTop 属性写法：贴底补偿绝不允许走这条路径 */
    scrollTopWrites: [] as number[],
    /** scrollTo 调用：贴底补偿允许走这条路径 */
    scrollToCalls: [] as { top: number; behavior?: ScrollBehavior }[],
  };
  const applyScrollTop = (value: number) => {
    const maxScrollTop = Math.max(0, state.scrollHeight - state.clientHeight);
    state.scrollTop = Math.max(0, Math.min(value, maxScrollTop));
  };
  const element = {
    get scrollHeight(): number {
      return state.scrollHeight;
    },
    get clientHeight(): number {
      return state.clientHeight;
    },
    get scrollTop(): number {
      return state.scrollTop;
    },
    set scrollTop(value: number) {
      state.scrollTopWrites.push(value);
      applyScrollTop(value);
    },
    scrollTo(scrollOptions: { top: number; behavior?: ScrollBehavior }) {
      state.scrollToCalls.push(scrollOptions);
      applyScrollTop(scrollOptions.top);
    },
  };
  return { state, element: element as unknown as HTMLDivElement };
}

describe("输入框自适应高度与贴底补偿", () => {
  it("输入字符但行数不变时，不写行内高度、也不触碰滚动位置", () => {
    const textarea = createFakeTextarea(38);
    const scroller = createFakeScroller({ scrollHeight: 600, clientHeight: 400, scrollTop: 200 });
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };
    const scrollerRef: MutableRef<HTMLDivElement | null> = { current: scroller.element };

    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useComposerAutosize({ textareaRef, value, messageScrollerRef: scrollerRef }),
      { initialProps: { value: "第一行" } },
    );
    // 挂载：先归零测量，再写回固定高度；此时不做任何滚动补偿
    expect(textarea.state.heightWrites).toEqual(["auto", "38px"]);
    expect(scroller.state.scrollTopWrites).toEqual([]);
    expect(scroller.state.scrollToCalls).toEqual([]);

    for (const value of ["第一行a", "第一行ab", "第一行abc"]) {
      rerender({ value });
    }
    // 逐键只读一次 scrollHeight 确认没有换行，不产生额外样式写入，也不动滚动位置
    expect(textarea.state.scrollHeightReads).toBe(4);
    expect(textarea.state.heightWrites).toEqual(["auto", "38px"]);
    expect(scroller.state.scrollTopWrites).toEqual([]);
    expect(scroller.state.scrollToCalls).toEqual([]);
  });

  it("删除一个字符但行数不变时，仍不触碰滚动位置（报告中的跳动场景）", () => {
    const textarea = createFakeTextarea(38);
    const scroller = createFakeScroller({ scrollHeight: 600, clientHeight: 400, scrollTop: 200 });
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };
    const scrollerRef: MutableRef<HTMLDivElement | null> = { current: scroller.element };

    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useComposerAutosize({ textareaRef, value, messageScrollerRef: scrollerRef }),
      { initialProps: { value: "第一行abc" } },
    );

    // 文本变短会走"归零重测"分支，但高度未变化 → 不补底、不动滚动
    rerender({ value: "第一行ab" });
    expect(textarea.state.heightWrites).toEqual(["auto", "38px", "auto", "38px"]);
    expect(scroller.state.scrollTopWrites).toEqual([]);
    expect(scroller.state.scrollToCalls).toEqual([]);
  });

  it("删除换行导致输入区变矮且用户贴着底部时，在同一次提交内补回贴底位置", () => {
    const textarea = createFakeTextarea(58);
    const scroller = createFakeScroller({ scrollHeight: 600, clientHeight: 400, scrollTop: 200 });
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };
    const scrollerRef: MutableRef<HTMLDivElement | null> = { current: scroller.element };

    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useComposerAutosize({ textareaRef, value, messageScrollerRef: scrollerRef }),
      { initialProps: { value: "第一行\n第二行" } },
    );
    expect(textarea.state.heightWrites).toEqual(["auto", "58px"]);

    textarea.state.contentHeight = 38;
    rerender({ value: "第一行" });

    expect(textarea.state.heightWrites).toEqual(["auto", "58px", "auto", "38px"]);
    // 贴底补偿在同一次提交内调用一次 scrollTo，目标就是列表底部（浏览器会收敛到最新最大值）
    expect(scroller.state.scrollToCalls).toEqual([{ top: 600, behavior: "auto" }]);
    expect(scroller.state.scrollTopWrites).toEqual([]);
    expect(scroller.state.scrollTop).toBe(200);
  });

  it("用户正在翻看历史（未贴底）时，高度变化一律不改滚动位置", () => {
    const textarea = createFakeTextarea(58);
    const scroller = createFakeScroller({ scrollHeight: 600, clientHeight: 400, scrollTop: 0 });
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };
    const scrollerRef: MutableRef<HTMLDivElement | null> = { current: scroller.element };

    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useComposerAutosize({ textareaRef, value, messageScrollerRef: scrollerRef }),
      { initialProps: { value: "第一行\n第二行" } },
    );

    textarea.state.contentHeight = 38;
    rerender({ value: "第一行" });

    // 视觉上仍然按内容收缩，但绝不把用户从历史位置拽回底部
    expect(textarea.state.heightWrites.at(-1)).toBe("38px");
    expect(scroller.state.scrollTopWrites).toEqual([]);
    expect(scroller.state.scrollToCalls).toEqual([]);
  });

  it("未提供消息列表引用时不做任何滚动干预", () => {
    const textarea = createFakeTextarea(58);
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };

    const { rerender } = renderHook(
      ({ value }: { value: string }) => useComposerAutosize({ textareaRef, value }),
      { initialProps: { value: "第一行\n第二行" } },
    );
    textarea.state.contentHeight = 38;
    expect(() => rerender({ value: "第一行" })).not.toThrow();
    expect(textarea.state.heightWrites.at(-1)).toBe("38px");
  });
});

describe("消息编辑框复用同一份自适应实现", () => {
  // 编辑框的高度上下限由可视区现算（MessageBubble 的 resolveEditorBounds），
  // 这里用可变基准模拟软键盘开合导致的视口变化。
  function renderEditorAutosize(initialValue: string, contentHeight: number) {
    const textarea = createFakeTextarea(contentHeight);
    const textareaRef: MutableRef<HTMLTextAreaElement | null> = { current: textarea.element };
    const maxHeightRef = { current: 120 };
    const { rerender, result } = renderHook(
      ({ value }: { value: string }) =>
        useComposerAutosize({
          textareaRef,
          value,
          resolveBounds: () => ({ minHeight: 42, maxHeight: maxHeightRef.current }),
        }),
      { initialProps: { value: initialValue } },
    );
    return { textarea, rerender, result, maxHeightRef };
  }

  it("挂载时只测一次并按上下限钳制，逐键不写行内高度", () => {
    const { textarea, rerender } = renderEditorAutosize("第一行", 400);

    // 挂载：归零一次 → 读数一次 → 写回被上限钳制的高度
    expect(textarea.state.scrollHeightReads).toBe(1);
    expect(textarea.state.heightWrites).toEqual(["auto", "120px"]);

    for (const value of ["第一行a", "第一行ab", "第一行abc"]) {
      rerender({ value });
    }
    // 逐键只读一次确认行数未变，不产生样式写入（编辑框因此不会逐键强制同步重排）
    expect(textarea.state.scrollHeightReads).toBe(4);
    expect(textarea.state.heightWrites).toEqual(["auto", "120px"]);
  });

  it("软键盘改变上下限后，remeasure 在文本不变时也能重新钳制高度", () => {
    const { textarea, result, maxHeightRef } = renderEditorAutosize("第一行", 400);
    expect(textarea.state.heightWrites).toEqual(["auto", "120px"]);

    // 软键盘弹出：可视区变小，上限收紧 → 复用最近一次文本长度重测一次
    maxHeightRef.current = 80;
    act(() => {
      result.current.remeasure();
    });
    expect(textarea.state.heightWrites).toEqual(["auto", "120px", "80px"]);

    // 软键盘收起：上限放宽 → 恢复被钳制的高度
    maxHeightRef.current = 280;
    act(() => {
      result.current.remeasure();
    });
    expect(textarea.state.heightWrites).toEqual(["auto", "120px", "80px", "280px"]);
    // 编辑框不参与列表贴底补偿：文本不变时不会因 remeasure 产生额外读数以外的工作
    expect(textarea.state.scrollHeightReads).toBe(3);
  });

  it("文本变长超过上限时不写入新的行内高度（避免无意义的样式失效）", () => {
    const { textarea, rerender } = renderEditorAutosize("第一行", 400);
    textarea.state.contentHeight = 900;
    rerender({ value: "第一行很长很长" });
    // 高度仍被钳制在 120px，与缓存一致 → 不写样式，只保留那次读数
    expect(textarea.state.heightWrites).toEqual(["auto", "120px"]);
    expect(textarea.state.scrollHeightReads).toBe(2);
  });
});

describe("快捷栏兼容变量的按需读取", () => {
  const session = { id: "session-1" } as unknown as ChatSession;

  const asKernelGetter = (service: unknown) =>
    ((name: string) => service) as unknown as <T extends IKernelService>(name: string) => T;

  it("快捷栏未展开时，连续按键不会触发 readState（避免逐键深拷贝变量表）", () => {
    const readState = vi.fn(() => ({ hp: 80 }));
    const getKernelService = asKernelGetter({ readState });

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useComposerCompatibilityVariables({ enabled, session, getKernelService }),
      { initialProps: { enabled: false } },
    );
    for (let index = 0; index < 5; index += 1) {
      rerender({ enabled: false });
    }

    expect(readState).not.toHaveBeenCalled();
  });

  it("快捷栏展开后按会话读取一次并复用结果，不会因重渲染反复读取", () => {
    const variables = { hp: 80 };
    const readState = vi.fn(() => variables);
    const getKernelService = vi.fn(asKernelGetter({ readState }));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useComposerCompatibilityVariables({
          enabled,
          session,
          getKernelService: getKernelService as unknown as <T extends IKernelService>(name: string) => T,
        }),
      { initialProps: { enabled: false } },
    );
    expect(result.current).toEqual({});

    rerender({ enabled: true });
    expect(readState).toHaveBeenCalledTimes(1);
    expect(readState).toHaveBeenCalledWith(session);
    expect(result.current).toBe(variables);
    expect(getKernelService).toHaveBeenCalledWith(KernelServices.CompatibilityRuntime);

    rerender({ enabled: true });
    expect(readState).toHaveBeenCalledTimes(1);
  });

  it("没有活动会话时不读取；兼容运行时缺失或读取失败时降级为空表", () => {
    const readState = vi.fn(() => ({ hp: 80 }));
    const noSession = renderHook(() =>
      useComposerCompatibilityVariables({
        enabled: true,
        session: null,
        getKernelService: asKernelGetter({ readState }),
      }),
    );
    expect(noSession.result.current).toEqual({});
    expect(readState).not.toHaveBeenCalled();

    const failing = renderHook(() =>
      useComposerCompatibilityVariables({
        enabled: true,
        session,
        getKernelService: (() => {
          throw new Error("兼容运行时未注册");
        }) as unknown as <T extends IKernelService>(name: string) => T,
      }),
    );
    expect(failing.result.current).toEqual({});
  });
});
