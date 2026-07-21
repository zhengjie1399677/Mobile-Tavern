import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StoryTimelineView from "../../src/tabs/chat/StoryTimelineView";
import { KernelProvider } from "../../src/contexts/KernelContext";
import { unifiedAppStore } from "../../src/UnifiedAppContext";
import type { IKernel } from "../../src/kernel";

describe("StoryTimelineView", () => {
  const originalState = unifiedAppStore.getState();

  afterEach(() => {
    unifiedAppStore.setRawState(originalState);
  });

  it("使用受约束的触屏滚动容器并完整展示多行长文本", () => {
    const longContent = `第一段完整剧情。\n第二段包含连续长文本：${"长".repeat(180)}`;
    const activeSession = {
      id: "timeline-session",
      characterId: "timeline-character",
      title: "年表测试",
      createdAt: Date.now(),
      messages: [],
      summaries: [{
        id: "summary-1",
        timeTag: "第一幕",
        location: "测试地点",
        content: longContent,
      }],
    };
    unifiedAppStore.setRawState({
      ...originalState,
      sessions: [activeSession],
      activeSessionId: activeSession.id,
      activeSession,
      activeCharacter: {
        id: "timeline-character",
        name: "测试角色",
      },
    } as typeof originalState);

    const kernel = {
      getService: vi.fn(() => ({ saveSession: vi.fn() })),
    } as unknown as IKernel;

    render(
      <KernelProvider kernel={kernel}>
        <StoryTimelineView />
      </KernelProvider>,
    );

    expect(screen.getByTestId("story-timeline-scroll")).toHaveClass(
      "h-full",
      "min-h-0",
      "touch-pan-y",
      "overflow-y-auto",
      "overscroll-contain",
    );
    const prose = screen.getByText((_, element) => element?.tagName === "P" && element.textContent === longContent);
    expect(prose).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(prose).not.toHaveClass("line-clamp-2", "truncate", "max-h-64");
  });
});
