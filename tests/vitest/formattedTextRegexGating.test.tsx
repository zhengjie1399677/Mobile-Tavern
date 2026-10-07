/**
 * 回归：消息来源（AI / 用户）必须由调用方显式传入。
 *
 * 历史缺陷：FormattedText 用 `activeSession.messages[messageIndex].sender` 反查来源，
 * 而 messageIndex 是"渲染列表"下标（野牛静默消息被过滤后与会话绝对下标错位），
 * AI 消息会被判成用户消息，placement=[2] 的预设/角色卡正则整条被跳过——
 * 表现为双星纪等预设的思维链美化、状态栏等前端只显示原始文本。
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FormattedText from "../../src/components/FormattedText";
import type { CharacterCard, ChatSession, RegexScript, UserSettings } from "../../src/types";
import {
  applySillyTavernRegexEngine,
  type RegexEngineScript,
} from "../../src/compatibility/sillytavern/regexEngine";

const mockSettings: Partial<UserSettings> = {
  enableHtmlRendering: true,
  enableScriptExecution: false,
  enableLoopProtection: true,
  enableAsteriskFormatting: false,
  globalRegexScripts: [],
  presetRegexScripts: [
    {
      id: "cot-beautify",
      scriptName: "CoT-简约美化-YO",
      findRegex: "/^([\\s\\S]*<\\/think(?:ing)?>)/i",
      replaceString: "[FOLDED]<!-- $1 -->",
      disabled: false,
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
    },
  ] as RegexScript[],
};

const mockSession: Partial<ChatSession> = {
  id: "session-1",
  messages: [
    { id: "m0", sender: "assistant", content: "开场", timestamp: 1 },
    // 渲染列表里 idx=1 指向这条用户消息；修复前 AI 消息会被反查成用户消息。
    { id: "m1", sender: "user", content: "你好", timestamp: 2 },
  ],
};

const mockContext: {
  settings: Partial<UserSettings>;
  activeCharacter: Partial<CharacterCard> | null;
  activeSession: Partial<ChatSession> | null;
  isSending: boolean;
} = {
  settings: mockSettings,
  activeCharacter: null,
  activeSession: mockSession,
  isSending: false,
};

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: () => mockContext,
}));

const mockKernel = {
  hasService: (name: string) => name === "compatibilityRuntime",
  getService: () => ({
    transformText: (request: {
      text: string;
      isAiMessage?: boolean;
      depth?: number;
      presetRegexScripts?: readonly unknown[];
    }) => applySillyTavernRegexEngine(
      request.text,
      (request.presetRegexScripts ?? []) as RegexEngineScript[],
      {
        isAiMessage: request.isAiMessage,
        mode: "render",
        depth: request.depth,
      },
    ),
    getRenderer: () => null,
  }),
};

vi.mock("../../src/contexts/KernelContext", () => ({
  useOptionalKernel: () => mockKernel,
}));

describe("FormattedText 正则来源门控", () => {
  it("显式 isAiMessage=true 时，即使索引反查落在用户消息上也执行 AI 输出正则", () => {
    render(
      <FormattedText
        text={"思考内容</thinking>正文"}
        charName="Bot"
        messageIndex={1}
        isAiMessage
      />,
    );
    expect(screen.getByText(/FOLDED/)).toBeInTheDocument();
  });

  it("不传显式来源时保持旧行为：索引指向用户消息则跳过 AI 输出正则", () => {
    render(
      <FormattedText text={"思考内容</thinking>正文"} charName="Bot" messageIndex={1} />,
    );
    expect(screen.queryByText(/FOLDED/)).toBeNull();
    expect(screen.getByText(/思考内容/)).toBeInTheDocument();
  });
});
