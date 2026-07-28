import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BranchUniverseDiagram from "../../src/components/BranchUniverseDiagram";
import type { ChatSession } from "../../src/types";
import type { MemoryFragment } from "../../src/kernel/services/memory/types";

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string>) =>
      variables?.turn ? `${key}:${variables.turn}` : key,
  }),
}));

const session: ChatSession = {
  id: "session-1",
  characterId: "character-1",
  title: "主线",
  createdAt: 1,
  messages: [
    { id: "message-1", sender: "assistant", content: "开场", timestamp: 1 },
  ],
  summaries: [],
};

const fragment: MemoryFragment = {
  id: "fragment-1",
  sessionId: session.id,
  content: "事件",
  participants: [],
  tags: [],
  sourceMessageIds: ["message-1"],
  sourceRole: "assistant",
  sourceTurnStart: 1,
  sourceTurnEnd: 1,
  status: "active",
  importance: 0.5,
  confidence: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("BranchUniverseDiagram", () => {
  it("任意轮次节点均可通过点击或键盘打开记忆审计", () => {
    const onInspectNode = vi.fn();
    render(
      <BranchUniverseDiagram
        sessions={[session]}
        activeSession={session}
        fragments={[fragment]}
        onSelectSession={vi.fn()}
        onInspectNode={onInspectNode}
      />,
    );

    const node = screen.getByLabelText("memory.inspect_turn:1");
    fireEvent.click(node);
    expect(onInspectNode).toHaveBeenLastCalledWith(session.id, 1, [fragment]);

    fireEvent.keyDown(node, { key: "Enter" });
    expect(onInspectNode).toHaveBeenCalledTimes(2);
  });
});
