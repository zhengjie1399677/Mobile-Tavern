import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemoryFragmentEditor from "../../src/components/MemoryFragmentEditor";
import type {
  MemoryFragment,
  MemoryPersistencePort,
} from "../../src/kernel/services/memory/types";

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string>) =>
      variables?.turn ? `${key}:${variables.turn}` : key,
  }),
}));

const fragment: MemoryFragment = {
  id: "fragment-1",
  sessionId: "session-1",
  content: "旧事实",
  participants: [],
  tags: ["旧标签"],
  sourceMessageIds: ["message-1"],
  sourceRole: "assistant",
  sourceTurnStart: 2,
  sourceTurnEnd: 2,
  status: "active",
  importance: 0.8,
  confidence: 0.9,
  createdAt: 1,
  updatedAt: 1,
};

function createPersistence(): MemoryPersistencePort {
  return {
    appendMessage: vi.fn(),
    updateMessageExtraction: vi.fn(),
    getMessageById: vi.fn(),
    getMessagesBySession: vi.fn(),
    getMessagesByTag: vi.fn(),
    deleteMessagesBySession: vi.fn(),
    upsertDictEntry: vi.fn(),
    getDictEntryById: vi.fn(),
    getDictBySession: vi.fn(),
    deleteDictBySession: vi.fn(),
    deleteDictEntryById: vi.fn(),
    upsertFragment: vi.fn(),
    getFragmentById: vi.fn(),
    getFragmentsBySession: vi.fn(),
    getFragmentsByTags: vi.fn(),
    supersedeFragment: vi.fn(),
    updateFragmentStatus: vi.fn(),
    deleteFragmentsBySession: vi.fn(),
  };
}

describe("MemoryFragmentEditor", () => {
  it("编辑时建立可审计修订链", async () => {
    const persistence = createPersistence();
    render(
      <MemoryFragmentEditor
        sessionId="session-1"
        sourceTurnEnd={2}
        fragments={[fragment]}
        persistence={persistence}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("memory.content_placeholder"), {
      target: { value: "修订后的事实" },
    });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(persistence.supersedeFragment).toHaveBeenCalledOnce());
    const [originalId, replacement] = vi.mocked(persistence.supersedeFragment).mock.calls[0];
    expect(originalId).toBe(fragment.id);
    expect(replacement).toMatchObject({
      content: "修订后的事实",
      supersedesId: fragment.id,
      status: "active",
    });
  });

  it("支持在空节点新增记忆", async () => {
    const persistence = createPersistence();
    render(
      <MemoryFragmentEditor
        sessionId="session-1"
        sourceTurnEnd={4}
        fragments={[]}
        persistence={persistence}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("memory.content_placeholder"), {
      target: { value: "新事实" },
    });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(persistence.upsertFragment).toHaveBeenCalledOnce());
    expect(vi.mocked(persistence.upsertFragment).mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
      sourceTurnStart: 4,
      sourceTurnEnd: 4,
      content: "新事实",
    });
  });

  it("删除操作将记忆标记为失效而非物理抹除", async () => {
    const persistence = createPersistence();
    render(
      <MemoryFragmentEditor
        sessionId="session-1"
        sourceTurnEnd={2}
        fragments={[fragment]}
        persistence={persistence}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("common.delete"));

    await waitFor(() =>
      expect(persistence.updateFragmentStatus).toHaveBeenCalledWith(fragment.id, "invalid"),
    );
  });
});
