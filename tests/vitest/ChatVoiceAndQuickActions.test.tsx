import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ChatInputArea from "../../src/tabs/chat/ChatInputArea";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { KernelServices, type IVoiceCaptureService } from "../../src/application/serviceContracts";
import type { PendingAttachment } from "../../src/tabs/chat/attachment-composer/PendingAttachmentStrip";

const WAV_FILE = new File([], "voice.wav", { type: "audio/wav" });

const mockStartCapture = vi.fn().mockResolvedValue(undefined);
const mockCancelCapture = vi.fn().mockResolvedValue(undefined);
const mockStopCapture = vi.fn().mockResolvedValue(WAV_FILE);
const mockStageFile = vi.fn(async (file: File) => ({
  id: "att_voice",
  kind: "audio" as const,
  mimeType: file.type,
  originalName: file.name,
  size: 1024,
  state: "staging" as const,
  referenceIds: [],
  createdAt: 0,
  updatedAt: 0,
}));
const mockGetObjectUrl = vi.fn(async () => "blob:voice");

const mockGetAmplitude = vi.fn(() => 0.5);

const mockVoiceService: IVoiceCaptureService = {
  name: "voice-capture",
  init: vi.fn().mockResolvedValue(undefined),
  isCapturing: () => false,
  startCapture: mockStartCapture,
  stopCapture: mockStopCapture,
  cancelCapture: mockCancelCapture,
  getAmplitude: mockGetAmplitude,
};

const mockAttachmentService = {
  stageFile: mockStageFile,
  getObjectUrl: mockGetObjectUrl,
};

const mockHandleSendMessage = vi.fn(async () => true);
const mockShowCustomAlert = vi.fn(async () => undefined);

const mockAppState = {
  isSending: false,
  setIsSending: vi.fn(),
  activeSession: {
    id: "session-1",
    characterId: "char-1",
    messages: [],
    summaries: [],
  },
  settings: {
    enableReplySuggestions: false,
    enableExternalCapabilities: false,
    enableMultiMessageQueue: false,
    replySuggestionsClickMode: "fill" as const,
    memory: { recentTurns: 5 },
    asrConfig: { enabled: false },
  },
  activeCharacter: {
    id: "char-1",
    name: "测试助手",
  },
  handleRerollLast: vi.fn(),
  showCustomAlert: mockShowCustomAlert,
  handleSendMessage: mockHandleSendMessage,
  handleStopGeneration: vi.fn(),
  safeAreas: { bottom: 0 },
  userInputMessage: "",
  setUserInputMessage: vi.fn(),
  replySuggestions: [],
  setReplySuggestions: vi.fn(),
  updateSettings: vi.fn(),
  isBisonLocking: false,
  lastRecalledMemories: [],
  triggerScroll: vi.fn(),
  getKernelService: vi.fn((name: string) => {
    if (name === KernelServices.VoiceCapture) return mockVoiceService;
    if (name === KernelServices.Attachments) return mockAttachmentService;
    return { list: () => [] };
  }),
  messageHydrationStatus: "ready",
  handleStartNewSession: vi.fn(),
  createNewBranch: vi.fn(),
  handleAutoSummaryCheck: vi.fn(),
  showCustomConfirm: vi.fn(),
  setActiveTab: vi.fn(),
};

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: typeof mockAppState) => unknown) => selector(mockAppState),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

/** 语言固定为 zh-CN：组件文案已全部走 i18n，不固定就会随宿主语言漂移。 */
function enterVoiceMode(): void {
  fireEvent.click(screen.getByLabelText("切换为语音输入"));
}

function holdButton(): HTMLElement {
  return screen.getByRole("button", { name: "按住 说话" });
}

/**
 * 按住时长由 Date.now 决定，而 <500ms 会被判为误触。
 * 这里用可控偏移量制造真实的按住时长，避免依赖真实时钟拖慢用例。
 */
let holdClockOffset = 0;
const realDateNow = Date.now;

async function pointerDown(clientY = 0): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(holdButton(), { pointerId: 1, button: 0, clientY });
  });
}

/** 按住 → 松手（默认按住 600ms，越过误触阈值）。 */
async function holdAndRelease(holdMs = 600, clientY = 0): Promise<void> {
  await pointerDown(clientY);
  holdClockOffset = holdMs;
  await act(async () => {
    fireEvent.pointerUp(holdButton(), { pointerId: 1, button: 0, clientY });
  });
}

describe("ChatInputArea 微信语音交互与快捷栏持久化", () => {
  beforeEach(() => {
    holdClockOffset = 0;
    // 取消阈值按视口高度的 1/6 计算：600px → 100px，便于用固定坐标断言。
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    vi.spyOn(Date, "now").mockImplementation(() => realDateNow.call(Date) + holdClockOffset);
    localStorage.clear();
    localStorage.setItem("mobile_tavern_language", "zh-CN");
    vi.clearAllMocks();
    mockStartCapture.mockResolvedValue(undefined);
    mockStopCapture.mockResolvedValue(WAV_FILE);
    mockHandleSendMessage.mockResolvedValue(true);
  });

  it("记住加号面板中的快捷栏开关状态并持久化到 localStorage", () => {
    // 初始 localStorage 为空，默认快捷栏不显示
    const { unmount } = renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    expect(screen.queryByTitle("消除整条故事分支的最后一条AI回复并进行重新生成")).not.toBeInTheDocument();

    // 点击加号展开菜单，并点击快捷栏切换项
    fireEvent.click(screen.getByRole("button", { name: "添加内容" }));
    const quickBarCheckbox = screen.getByRole("menuitemcheckbox", { name: "快捷栏" });
    fireEvent.click(quickBarCheckbox);

    // 此时快捷栏展开，localStorage 记录为 true
    expect(localStorage.getItem("mobile_tavern_show_quick_actions")).toBe("true");
    expect(screen.getByTitle("消除整条故事分支的最后一条AI回复并进行重新生成")).toBeInTheDocument();
    unmount();

    // 重新挂载组件（模拟重启/切换页面重新进入），验证自动恢复为开启状态
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    expect(screen.getByTitle("消除整条故事分支的最后一条AI回复并进行重新生成")).toBeInTheDocument();
  });

  it("支持微信式底栏布局：键盘/语音切换并呈现【按住 说话】大按钮", () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);

    // 默认处于文本模式：左侧是“切换为语音输入”切换按钮，中间是 textarea
    const switchBtn = screen.getByLabelText("切换为语音输入");
    expect(switchBtn).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("按住 说话")).not.toBeInTheDocument();

    // 点击切换为语音模式
    fireEvent.click(switchBtn);

    // 此时 textarea 隐藏，中间呈现【按住 说话】
    expect(holdButton()).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("切换为键盘输入")).toBeInTheDocument();

    // 再次点击切回文本模式
    fireEvent.click(screen.getByLabelText("切换为键盘输入"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("按住 说话")).not.toBeInTheDocument();
  });

  it("按住说话按钮支持 pointerdown 触发原生录音", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown();

    expect(mockStartCapture).toHaveBeenCalledTimes(1);
    expect(mockStartCapture).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 180_000 }),
    );
  });

  it("松手后把录音暂存并自动发送", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();
    await holdAndRelease();

    await waitFor(() => expect(mockStopCapture).toHaveBeenCalledTimes(1));
    expect(mockStageFile).toHaveBeenCalledWith(WAV_FILE);
    expect(mockHandleSendMessage).toHaveBeenCalledTimes(1);
    const [, options] = mockHandleSendMessage.mock.calls[0] as unknown as [
      string,
      { attachmentParts: Array<Record<string, unknown>> },
    ];
    expect(options.attachmentParts).toEqual([
      { type: "audio", assetId: "att_voice", purpose: "model-input" },
    ]);
  });

  it("发送被拒时保留录音与草稿，不清空输入区", async () => {
    mockHandleSendMessage.mockResolvedValue(false);
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();
    await holdAndRelease();

    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
    // 暂停后的暂存条仍在（没有被 setPendingAttachments([]) 清掉）
    expect(screen.getByText("voice.wav")).toBeInTheDocument();
  });

  it("到达三分钟上限时自动发送，且随后松手不重复发送", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown();
    const onLimitReached = mockStartCapture.mock.calls[0][0].onLimitReached as () => void;
    await act(async () => {
      onLimitReached();
    });

    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
    expect(mockStopCapture).toHaveBeenCalledTimes(1);

    // 手指仍按着：此时松手只是收尾一个已经结束的状态
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, button: 0, clientY: 0 });
    });
    expect(mockHandleSendMessage).toHaveBeenCalledTimes(1);
    expect(mockStopCapture).toHaveBeenCalledTimes(1);
  });

  it("上滑超过取消阈值后松手取消，不发送", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(200);
    // 视口 600px → 阈值为 100px；上滑 120px 进入取消态。
    await act(async () => {
      fireEvent.pointerMove(holdButton(), { pointerId: 1, clientY: 80 });
    });
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 80 });
    });

    expect(mockCancelCapture).toHaveBeenCalled();
    expect(mockStopCapture).not.toHaveBeenCalled();
    expect(mockHandleSendMessage).not.toHaveBeenCalled();
  });

  it("取消阈值随视口高度缩放：900px 视口上滑 100px 不会取消", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(300);
    holdClockOffset = 600;
    // 挂载时的会话切换 effect 会安全取消一次录音，这里只关心松手后是否又取消。
    const cancelCallsBeforeRelease = mockCancelCapture.mock.calls.length;
    // 视口 900px → 阈值为 150px；上滑 100px 低于阈值，应正常发送。
    await act(async () => {
      fireEvent.pointerMove(holdButton(), { pointerId: 1, clientY: 200 });
    });
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 200 });
    });

    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
    expect(mockCancelCapture).toHaveBeenCalledTimes(cancelCallsBeforeRelease);
  });

  it("上滑距离不足时松手仍发送，不会因轻微上移误取消", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(200);
    holdClockOffset = 600;
    // 挂载时的会话切换 effect 会安全取消一次录音，这里只关心松手后是否又取消。
    const cancelCallsBeforeRelease = mockCancelCapture.mock.calls.length;
    await act(async () => {
      fireEvent.pointerMove(holdButton(), { pointerId: 1, clientY: 140 });
    });
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 140 });
    });

    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
    expect(mockCancelCapture).toHaveBeenCalledTimes(cancelCallsBeforeRelease);
  });

  it("进入取消态后回退一点仍按取消处理（滞回），不会在阈值边界反复跳变", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(200);
    // 先上滑 120px 进入取消态，再回退到 80px：仍高于退出阈值 75px。
    await act(async () => {
      fireEvent.pointerMove(holdButton(), { pointerId: 1, clientY: 80 });
    });
    await act(async () => {
      fireEvent.pointerMove(holdButton(), { pointerId: 1, clientY: 120 });
    });
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 120 });
    });

    expect(mockCancelCapture).toHaveBeenCalled();
    expect(mockHandleSendMessage).not.toHaveBeenCalled();
  });

  it("滑动取消的判定按松手坐标现算：即使 pointermove 未提交也不误发", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(200);
    // 只发 pointerup，坐标已经在阈值之外（模拟 pointermove 与 pointerup 同帧合并）
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 80 });
    });

    expect(mockCancelCapture).toHaveBeenCalled();
    expect(mockHandleSendMessage).not.toHaveBeenCalled();
  });

  it("指针按住期间失焦不会取消录音（滑过快捷栏）", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown(200);
    holdClockOffset = 600;
    // 挂载时的会话切换 effect 会安全取消一次录音，这里只关心失焦是否又取消。
    const cancelCallsBeforeBlur = mockCancelCapture.mock.calls.length;
    await act(async () => {
      fireEvent.blur(holdButton());
    });
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, clientY: 200 });
    });

    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
    expect(mockCancelCapture).toHaveBeenCalledTimes(cancelCallsBeforeBlur);
  });

  it("第二根手指按下不会打断正在进行的录音", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown();
    await act(async () => {
      fireEvent.pointerDown(holdButton(), { pointerId: 2, button: 0 });
    });

    expect(mockStartCapture).toHaveBeenCalledTimes(1);
  });

  it("启动期间的松手等 startCapture 落地后再收尾，不会撞上 NOT_ACTIVE", async () => {
    let resolveStart!: () => void;
    mockStartCapture.mockImplementation(
      () => new Promise<void>((resolve) => { resolveStart = resolve; }),
    );
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown();
    // getUserMedia / 权限弹窗还未返回时就松手
    holdClockOffset = 600;
    await act(async () => {
      fireEvent.pointerUp(holdButton(), { pointerId: 1, button: 0, clientY: 0 });
    });
    expect(mockStopCapture).not.toHaveBeenCalled();

    await act(async () => {
      resolveStart();
    });
    await waitFor(() => expect(mockStopCapture).toHaveBeenCalledTimes(1));
    expect(mockHandleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("切换会话时取消进行中的录音", async () => {
    const { rerender } = renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();
    await pointerDown();

    mockAppState.activeSession = { ...mockAppState.activeSession, id: "session-2" };
    try {
      await act(async () => {
        rerender(<LanguageProvider><ChatInputArea isKeyboardOpen={false} /></LanguageProvider>);
      });
      expect(mockCancelCapture).toHaveBeenCalled();
      expect(screen.queryByText("松开发送，上滑取消")).not.toBeInTheDocument();
    } finally {
      mockAppState.activeSession = { ...mockAppState.activeSession, id: "session-1" };
    }
  });

  it("持握中切换按钮被禁用，避免卸载按住按钮搁浅录音", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await act(async () => {
      fireEvent.pointerDown(holdButton(), { pointerId: 1, button: 0 });
    });
    expect(screen.getByLabelText("切换为键盘输入")).toBeDisabled();
  });

  it("键盘可用 Space 起止按住说话", async () => {
    renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();
    const button = holdButton();

    await act(async () => {
      fireEvent.keyDown(button, { key: " " });
    });
    expect(mockStartCapture).toHaveBeenCalledTimes(1);

    holdClockOffset = 600;
    await act(async () => {
      fireEvent.keyUp(button, { key: " " });
    });
    await waitFor(() => expect(mockHandleSendMessage).toHaveBeenCalledTimes(1));
  });

  it("语音模式下仍能看到发送按钮与草稿内容", () => {
    mockAppState.userInputMessage = "帮我写一封信";
    try {
      renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
      enterVoiceMode();

      expect(screen.getByText("帮我写一封信")).toBeInTheDocument();
      expect(screen.getByLabelText("发送消息")).toBeInTheDocument();
    } finally {
      mockAppState.userInputMessage = "";
    }
  });

  it("卸载时取消录音并停止振幅轮询", async () => {
    const { unmount } = renderWithProviders(<ChatInputArea isKeyboardOpen={false} />);
    enterVoiceMode();

    await pointerDown();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const callsWhileHolding = mockGetAmplitude.mock.calls.length;
    expect(callsWhileHolding).toBeGreaterThan(0);

    unmount();

    expect(mockCancelCapture).toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    // 卸载后 100ms 轮询不应再触发采样
    expect(mockGetAmplitude.mock.calls.length).toBe(callsWhileHolding);
  });
});
