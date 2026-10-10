// 消息编辑框"按键路径"性能守卫
//
// 背景：长按气泡进入编辑后，编辑草稿曾存放在全局 store 的 editingMsgContent 上。
// 每次按键都会走一遍"useChatUI setState → 组合根重算 hook 值 → unifiedAppStore 广播"，
// 而虚拟列表内**每一条**已挂载的气泡都订阅了 editingMsgContent：
//   - React.memo 拦不住"组件自身订阅触发的重渲染"，于是全部可见气泡逐键重渲染（改前实测 8.4 次/键）；
//   - 编辑框的自适应高度与监听器挂在以编辑文本为依赖的 effect 上，逐键增删 4 个 resize 监听，
//     并做一次 height="auto" 写 → scrollHeight 读 → 高度写（两次强制同步重排）。
//
// 本用例用调用计数锁定"每个按键做了什么、绝不做什么"的可复现部分：
//   - 逐键 0 次 store 广播、0 次编辑框以外的气泡重渲染、0 次格式化预处理、0 次 resize 监听增删；
//   - 自适应高度每键最多一次 scrollHeight 读数，且绝不触碰消息列表滚动位置。
// 自适应高度的行内样式写入次数由 tests/vitest/composerInputPath.test.ts 用可控假节点精确断言。
// 同时钉住编辑、保存、取消与二次编辑的既有行为，防止"性能优化顺手改坏编辑语义"。
//
// 真机观感（软键盘动画、Android WebView 合成与强制重排耗时）无法在 happy-dom 复现，
// 需要真机时按 docs/agents/ui_webview_performance.md 与 scripts/measure-android-webview-ui.ps1 复核。
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedAppStore } from "../../src/UnifiedAppContext";
import MessageBubble from "../../src/tabs/chat/MessageBubble";
import FormattedText from "../../src/components/FormattedText";
import type { Message } from "../../src/types";

/** 逐键成本探针：全部为调用计数，不含时间测量，保证跨机器可复现 */
const probe = {
  storeNotifications: 0,
  /** 非编辑气泡的重渲染次数（MessageBubble 每次渲染都会调用一次 renderDialogueBubble） */
  dialogueBubbleRenders: 0,
  /** 逐字格式化预处理调用次数（Markdown/正则/兼容运行时渲染的统一入口） */
  preprocessCalls: 0,
  /** scrollHeight 读取次数：自适应高度允许的那一次读数 */
  scrollHeightReads: 0,
  resizeListenerAdds: 0,
  resizeListenerRemoves: 0,
  /** 消息列表 scrollTop 属性写入 / scrollTo 调用：编辑路径不得干预列表滚动 */
  listScrollTopWrites: 0,
  listScrollToCalls: 0,
  /** 每条气泡的提交次数，用于确认"只有被编辑的那条重渲染" */
  bubbleCommits: {} as Record<string, number>,
};

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../src/components/formatted-text/renderingRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/components/formatted-text/renderingRuntime")>();
  return {
    ...actual,
    preprocessFormattedText: (...args: Parameters<typeof actual.preprocessFormattedText>) => {
      probe.preprocessCalls += 1;
      return actual.preprocessFormattedText(...args);
    },
  };
});

const originalState = unifiedAppStore.getState();
const MESSAGE_COUNT = 8;
const EDIT_INDEX = 3;

function buildMessages(): Message[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
    id: `m-${index}`,
    sender: (index % 2 === 0 ? "user" : "assistant") as Message["sender"],
    content: `第 ${index} 条消息内容 ${"正文".repeat(10)}`,
    timestamp: 1_700_000_000_000 + index,
  }));
}

interface Harness {
  messages: Message[];
  textarea: HTMLTextAreaElement;
}

/**
 * 渲染与虚拟列表同构的一组气泡，并把编辑态指向第 EDIT_INDEX 条。
 * store 的写入方式与真实组合根一致：setEditingMsgContent / setEditingMsgId 都会广播一次。
 */
function setupEditHarness(): Harness {
  const messages = buildMessages();
  const editingId = messages[EDIT_INDEX].id;
  const ttsService = { getSpeakingMessageId: () => null, isSpeaking: () => false };

  unifiedAppStore.setRawState({
    ...originalState,
    activeCharacter: { id: "c1", name: "角色" },
    settings: { userName: "我" },
    isSending: false,
    activeSession: { id: "s1", characterId: "c1", messages },
    editingMsgId: editingId,
    setEditingMsgId: (id: string | null) => {
      unifiedAppStore.setState({ editingMsgId: id } as never);
    },
    editingMsgContent: messages[EDIT_INDEX].content,
    setEditingMsgContent: (content: string) => {
      unifiedAppStore.setState({ editingMsgContent: content } as never);
    },
    msgMenuId: null,
    setMsgMenuId: vi.fn(),
    renderDialogueBubble: (
      text: string,
      messageIndex?: number,
      isStreaming?: boolean,
      isAiMessage?: boolean,
    ) => {
      probe.dialogueBubbleRenders += 1;
      return (
        <FormattedText
          text={text}
          charName="角色"
          userName="我"
          messageIndex={messageIndex}
          isAiMessage={isAiMessage}
          isStreaming={isStreaming}
        />
      );
    },
    saveSessionWithMvu: vi.fn(async (session: { id: string }) => session),
    setSessionViews: vi.fn(),
    showCustomAlert: vi.fn(),
    showCustomConfirm: vi.fn(),
    showCustomPrompt: vi.fn(),
    getKernelService: () => ttsService,
    lastRecalledMemories: [],
  } as unknown as typeof originalState);

  const view = render(
    <>
      {messages.map((message, index) => (
        <React.Profiler
          key={message.id}
          id={message.id}
          onRender={() => {
            probe.bubbleCommits[message.id] = (probe.bubbleCommits[message.id] ?? 0) + 1;
          }}
        >
          <MessageBubble
            message={message}
            idx={index}
            roundNum={1}
            activePortraitUrl=""
            expandedReasoningIds={{}}
            setExpandedReasoningIds={vi.fn()}
            copiedReasoningIds={{}}
            setCopiedReasoningIds={vi.fn()}
            isStreamingThisMsg={false}
            swipedMsgId={null}
            setSwipedMsgId={vi.fn()}
            sessionId="s1"
          />
        </React.Profiler>
      ))}
    </>,
  );

  const textarea = view.container.querySelector("textarea");
  expect(textarea, "进入编辑态后应渲染编辑框").toBeTruthy();
  return { messages, textarea: textarea as HTMLTextAreaElement };
}

/** 清空逐键计数（挂载期计数单独断言，不参与逐键口径） */
function resetKeystrokeCounts() {
  probe.storeNotifications = 0;
  probe.dialogueBubbleRenders = 0;
  probe.preprocessCalls = 0;
  probe.scrollHeightReads = 0;
  probe.resizeListenerAdds = 0;
  probe.resizeListenerRemoves = 0;
  probe.listScrollTopWrites = 0;
  probe.listScrollToCalls = 0;
  probe.bubbleCommits = {};
}

function typeIntoEditor(textarea: HTMLTextAreaElement, base: string, keys: number): string {
  let text = base;
  for (let index = 0; index < keys; index += 1) {
    text += "x";
    fireEvent.change(textarea, { target: { value: text } });
  }
  return text;
}

describe("消息编辑框按键路径成本", () => {
  let unsubscribe: (() => void) | null = null;

  // 全局探针只装一次：在 beforeEach 里重复包装会把同一个读数记成多次（计数随用例数膨胀）
  beforeAll(() => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        probe.scrollHeightReads += 1;
        return scrollHeightDescriptor?.get?.call(this) ?? 0;
      },
    });

    const nativeAdd = window.addEventListener.bind(window);
    const nativeRemove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "resize") probe.resizeListenerAdds += 1;
      return (nativeAdd as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "resize") probe.resizeListenerRemoves += 1;
      return (nativeRemove as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.removeEventListener;

    // 任何元素上的 scrollTop 强写与 scrollTo 调用（编辑路径不得碰消息列表滚动位置）
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (scrollTopDescriptor?.get && scrollTopDescriptor.set) {
      Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        get(this: Element) {
          return scrollTopDescriptor.get!.call(this) as number;
        },
        set(this: Element, value: number) {
          probe.listScrollTopWrites += 1;
          scrollTopDescriptor.set!.call(this, value);
        },
      });
    }
    Element.prototype.scrollTo = function scrollToProbe() {
      probe.listScrollToCalls += 1;
    } as typeof Element.prototype.scrollTo;
  });

  beforeEach(() => {
    resetKeystrokeCounts();
    unsubscribe = unifiedAppStore.subscribe(() => {
      probe.storeNotifications += 1;
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    unifiedAppStore.setRawState(originalState);
  });

  it("逐键不广播 store、不重渲染其它气泡、不重复做格式化预处理", () => {
    const { messages, textarea } = setupEditHarness();

    // 探针自检：挂载期确实跑过格式化预处理，否则"逐键 0 次"没有意义
    expect(probe.preprocessCalls).toBeGreaterThan(0);

    resetKeystrokeCounts();
    const keys = 5;
    typeIntoEditor(textarea, messages[EDIT_INDEX].content, keys);

    expect(probe.storeNotifications, "逐键不得写全局 store").toBe(0);
    expect(probe.dialogueBubbleRenders, "编辑框以外的气泡不得逐键重渲染").toBe(0);
    expect(probe.preprocessCalls, "逐键不得重新做格式化预处理").toBe(0);
    expect(probe.scrollHeightReads, "自适应高度每键最多读一次 scrollHeight").toBeLessThanOrEqual(keys);
    expect(probe.resizeListenerAdds, "逐键不得增删 resize 监听").toBe(0);
    expect(probe.resizeListenerRemoves, "逐键不得增删 resize 监听").toBe(0);
    expect(probe.listScrollTopWrites, "编辑不得写 scrollTop").toBe(0);
    expect(probe.listScrollToCalls, "编辑不得程序化滚动消息列表").toBe(0);

    // 只有被编辑的那条气泡重渲染：其余气泡靠 React.memo 与"自身订阅未被触发"跳过
    expect(Object.keys(probe.bubbleCommits)).toEqual([messages[EDIT_INDEX].id]);
    expect(probe.bubbleCommits[messages[EDIT_INDEX].id]).toBeGreaterThanOrEqual(keys);
  });

  it("保存把编辑后的文本交给 MVU 写回，并同步全局草稿字段", async () => {
    const { messages, textarea } = setupEditHarness();
    const edited = typeIntoEditor(textarea, messages[EDIT_INDEX].content, 3);

    fireEvent.click(screen.getByRole("button", { name: /edit_save/ }));

    await waitFor(() => {
      expect(unifiedAppStore.getState().editingMsgId).toBeNull();
    });
    const saveMock = unifiedAppStore.getState().saveSessionWithMvu as unknown as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledTimes(1);
    const [savedSession, editedMessage] = saveMock.mock.calls[0] as [
      { id: string; messages: Message[] },
      Message,
    ];
    expect(editedMessage.id).toBe(messages[EDIT_INDEX].id);
    expect(editedMessage.content).toBe(edited);
    expect(
      savedSession.messages.find((item: Message) => item.id === messages[EDIT_INDEX].id)?.content,
    ).toBe(edited);
    // 保存成功后全局草稿字段才与最终文本对齐；按键期间从未写过它
    expect(unifiedAppStore.getState().editingMsgContent).toBe(edited);
    // 保存后回到展示态，编辑框消失
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("取消不写入会话，并在再次编辑时重新以消息正文为初值", () => {
    const { messages, textarea } = setupEditHarness();
    const original = messages[EDIT_INDEX].content;
    typeIntoEditor(textarea, original, 3);

    fireEvent.click(screen.getByRole("button", { name: /edit_cancel/ }));

    expect(unifiedAppStore.getState().saveSessionWithMvu).not.toHaveBeenCalled();
    expect(unifiedAppStore.getState().editingMsgId).toBeNull();
    expect(unifiedAppStore.getState().editingMsgContent).toBe(original);

    // 二次编辑同一条消息：本地草稿必须已丢弃，重新以消息正文为初值
    act(() => {
      unifiedAppStore.setState({ editingMsgId: messages[EDIT_INDEX].id } as never);
    });
    const reopened = document.querySelector("textarea");
    expect(reopened, "重新进入编辑态应重新渲染编辑框").toBeTruthy();
    expect((reopened as HTMLTextAreaElement).value).toBe(original);
  });
});
