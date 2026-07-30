import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAvatar } from "../../src/tabs/chat/message-bubble/MessageAvatar";
import { ReasoningBlock } from "../../src/tabs/chat/message-bubble/ReasoningBlock";
import { GeneratedImageBlock } from "../../src/tabs/chat/message-bubble/GeneratedImageBlock";
import { MessageTimestamp } from "../../src/tabs/chat/message-bubble/MessageTimestamp";
import { SystemReportPanel } from "../../src/tabs/settings/sections/system-report/SystemReportPanel";
import type { CharacterCard, Message } from "../../src/types";

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string>) =>
      variables ? `${key}:${JSON.stringify(variables)}` : key,
  }),
}));

function createMessage(overrides?: Partial<Message>): Message {
  return {
    id: "message-1",
    sender: "assistant",
    content: "正文",
    timestamp: new Date("2026-07-30T05:00:00Z").getTime(),
    ...overrides,
  } as Message;
}

afterEach(() => {
  delete (window as Window & { AndroidThemeBridge?: unknown }).AndroidThemeBridge;
  vi.unstubAllGlobals();
});

describe("拆分后的消息展示组件契约", () => {
  it("头像与时间戳保持角色信息、轮次和生成指标展示", () => {
    const character = {
      id: "character-1",
      name: "角色甲",
      avatar: "character.png",
    } as CharacterCard;
    const message = createMessage({
      generationTime: 1.5,
      tokenCount: 32,
      promptTokenCount: 12,
    });

    const { container } = render(
      <>
        <MessageAvatar
          isUser={false}
          activePortraitUrl=""
          activeCharacter={character}
        />
        <MessageTimestamp message={message} roundNum={2} isUser={false} />
      </>,
    );

    expect(container.querySelector('img[src="character.png"]')).not.toBeNull();
    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(screen.getByText("32 Token")).toBeInTheDocument();
    expect(screen.getByText(/round_label/)).toBeInTheDocument();
  });

  it("思维链展开与复制状态由父级状态契约驱动", () => {
    const setExpandedIds = vi.fn();
    const setCopiedIds = vi.fn();
    const message = createMessage({ reasoningContent: "内部推理" });

    render(
      <ReasoningBlock
        message={message}
        isStreaming={false}
        isSending={false}
        expandedIds={{ [message.id]: true }}
        setExpandedIds={setExpandedIds}
        copiedIds={{}}
        setCopiedIds={setCopiedIds}
      />,
    );

    expect(screen.getByText("内部推理")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("message_bubble.copy_reasoning"));
    expect(setCopiedIds).toHaveBeenCalled();
  });

  it("生成图片继续优先通过 Android Native Adapter 保存 Base64", async () => {
    const saveFileBase64 = vi.fn(() => "/Download/draw.png");
    (window as Window & {
      AndroidThemeBridge?: {
        saveFile: (fileName: string, content: string) => string;
        saveFileBase64: (fileName: string, base64: string, mimeType: string) => string;
      };
    }).AndroidThemeBridge = {
      saveFile: vi.fn(() => "/Download/draw.png"),
      saveFileBase64,
    };
    const showCustomAlert = vi.fn().mockResolvedValue(undefined);
    const showCustomConfirm = vi.fn().mockResolvedValue(true);

    render(
      <GeneratedImageBlock
        image="data:image/png;base64,AAAA"
        showCustomAlert={showCustomAlert}
        showCustomConfirm={showCustomConfirm}
      />,
    );

    fireEvent.click(screen.getByAltText("Generated Scene"));
    await waitFor(() => {
      expect(saveFileBase64).toHaveBeenCalledWith(
        expect.stringMatching(/^draw_\d+\.png$/),
        "AAAA",
        "image/png",
      );
      expect(showCustomAlert).toHaveBeenCalled();
    });
  });
});

describe("拆分后的系统报告展示契约", () => {
  it("按诊断分区呈现错误并委托复制与复检操作", () => {
    vi.stubGlobal("__APP_VERSION__", "1.7.4");
    const onRunSelfCheck = vi.fn().mockResolvedValue(undefined);
    const onCopySection = vi.fn();
    const section = {
      id: "DB",
      title: "数据库",
      lines: ["ERROR: failed"],
      hasError: true,
      hasWarning: false,
    };

    render(
      <SystemReportPanel
        sections={[section]}
        diagnoseLog=""
        isChecking={false}
        isTauri={true}
        deviceModel="Test Device"
        viewportSize={{ w: 390, h: 844, vW: 390, vH: 800 }}
        safeAreas={{ top: 24, bottom: 16 }}
        onRunSelfCheck={onRunSelfCheck}
        onCopyFullReport={vi.fn()}
        onCopyErrorsOnly={vi.fn()}
        onCopySection={onCopySection}
        onCopyDiagnoseLog={vi.fn()}
        onClearDiagnoseLog={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("[report.copy_section]"));
    fireEvent.click(screen.getByText("report.check_start"));

    expect(screen.getByText("ERROR: failed")).toBeInTheDocument();
    expect(onCopySection).toHaveBeenCalledWith(section);
    expect(onRunSelfCheck).toHaveBeenCalledOnce();
  });
});
