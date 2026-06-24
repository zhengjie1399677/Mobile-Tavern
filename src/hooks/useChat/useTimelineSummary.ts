import React, { useState, useCallback } from "react";
import { ChatSession, SummaryCard, UserSettings, CharacterCard } from "../../types";
import { IDatabaseService } from "../../kernel/types";
import { globalKernel } from "../../kernel";
import { generateUniqueId } from "./helpers";

export interface TimelineSummaryState {
  timelineModalOpen: boolean;
  setTimelineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newSummaryTag: string;
  setNewSummaryTag: React.Dispatch<React.SetStateAction<string>>;
  newSummaryLoc: string;
  setNewSummaryLoc: React.Dispatch<React.SetStateAction<string>>;
  newSummaryContent: string;
  setNewSummaryContent: React.Dispatch<React.SetStateAction<string>>;
  newSummaryCondition: string;
  setNewSummaryCondition: React.Dispatch<React.SetStateAction<string>>;
  newSummaryInventory: string;
  setNewSummaryInventory: React.Dispatch<React.SetStateAction<string>>;
  newSummaryBonding: string;
  setNewSummaryBonding: React.Dispatch<React.SetStateAction<string>>;
  editingSummaryId: string | null;
  setEditingSummaryId: React.Dispatch<React.SetStateAction<string | null>>;
  handleAddTimelineSummary: () => Promise<void>;
  handleAutoSummaryCheck: (session: ChatSession, force?: boolean, signal?: AbortSignal) => Promise<void>;
}

/**
 * 管理手动编辑时间轴摘要卡片以及自动总结触发，不包含任何流式对话逻辑。
 */
export function useTimelineSummary(params: {
  activeSession: ChatSession | null;
  settings: UserSettings;
  activeCharacter: CharacterCard | null;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSummarizing: (v: boolean) => void;
  databaseService: IDatabaseService;
  showCustomAlert: (msg: string) => Promise<void>;
}): TimelineSummaryState {
  const { activeSession, settings, activeCharacter, setSessions, setIsSummarizing, databaseService, showCustomAlert } = params;

  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [newSummaryTag, setNewSummaryTag] = useState("");
  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");
  const [newSummaryCondition, setNewSummaryCondition] = useState("");
  const [newSummaryInventory, setNewSummaryInventory] = useState("");
  const [newSummaryBonding, setNewSummaryBonding] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);

  const handleAutoSummaryCheck = useCallback(async (
    session: ChatSession,
    force: boolean = false,
    signal?: AbortSignal
  ) => {
    const autoSummaryService = globalKernel.getService<any>("autoSummary");
    try {
      setIsSummarizing(true);
      const updatedSession = await autoSummaryService.handleAutoSummaryCheck(
        session, settings, activeCharacter, force, signal
      );
      if (updatedSession !== session) {
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
        if (force) await showCustomAlert("记忆整理完毕，已收录至潜意识年表！");
      } else if (force) {
        await showCustomAlert("当前无需强制压缩。");
      }
    } catch (e: any) {
      if (e.name === "AbortError" || e.message === "AbortError") return;
      console.warn("Auto-compactor service bypassed or offline:", e);
      if (force) await showCustomAlert("记忆整理出错: " + e.message);
    } finally {
      setIsSummarizing(false);
    }
  }, [settings, activeCharacter, showCustomAlert, setSessions, setIsSummarizing]);

  const handleAddTimelineSummary = useCallback(async () => {
    if (!newSummaryTag.trim() || !newSummaryContent.trim() || !activeSession) return;

    let updatedSummaries: SummaryCard[];
    if (editingSummaryId) {
      updatedSummaries = (activeSession.summaries || []).map((s) =>
        s.id === editingSummaryId
          ? {
              ...s,
              timeTag: newSummaryTag.trim(),
              location: newSummaryLoc.trim() || "未知地点",
              content: newSummaryContent.trim(),
              condition: newSummaryCondition.trim() || undefined,
              inventory: newSummaryInventory.trim() || undefined,
              bonding: newSummaryBonding.trim() || undefined,
            }
          : s
      );
    } else {
      const lastMsgId = activeSession.messages[activeSession.messages.length - 1]?.id;
      const newCard: SummaryCard = {
        id: generateUniqueId("summary_"),
        timeTag: newSummaryTag.trim(),
        location: newSummaryLoc.trim() || "未知地点",
        content: newSummaryContent.trim(),
        condition: newSummaryCondition.trim() || undefined,
        inventory: newSummaryInventory.trim() || undefined,
        bonding: newSummaryBonding.trim() || undefined,
        lastMessageId: lastMsgId,
      };
      updatedSummaries = [...(activeSession.summaries || []), newCard];
    }

    const updatedSession = {
      ...activeSession,
      summaries: updatedSummaries,
      lastSummarizedMessageId: editingSummaryId
        ? activeSession.lastSummarizedMessageId
        : (updatedSummaries[updatedSummaries.length - 1]?.lastMessageId || activeSession.lastSummarizedMessageId),
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await databaseService.saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save timeline summary:", err);
    }

    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
    setNewSummaryCondition("");
    setNewSummaryInventory("");
    setNewSummaryBonding("");
    setEditingSummaryId(null);
    setTimelineModalOpen(false);
  }, [
    newSummaryTag, newSummaryContent, newSummaryLoc, newSummaryCondition,
    newSummaryInventory, newSummaryBonding, activeSession, editingSummaryId,
    setSessions, databaseService,
  ]);

  return {
    timelineModalOpen, setTimelineModalOpen,
    newSummaryTag, setNewSummaryTag,
    newSummaryLoc, setNewSummaryLoc,
    newSummaryContent, setNewSummaryContent,
    newSummaryCondition, setNewSummaryCondition,
    newSummaryInventory, setNewSummaryInventory,
    newSummaryBonding, setNewSummaryBonding,
    editingSummaryId, setEditingSummaryId,
    handleAddTimelineSummary,
    handleAutoSummaryCheck,
  };
}
