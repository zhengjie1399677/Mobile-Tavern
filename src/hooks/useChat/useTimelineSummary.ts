import React, { useState, useCallback } from "react";
import { ChatSession, ChatSessionMetadataPatch, SummaryCard, UserSettings, CharacterCard, Message } from "../../types";
import { IDatabaseService, KernelServices } from "@/src/application/serviceContracts";
import { useKernel } from "../../contexts/KernelContext";
import type { MemoryServiceTyped } from "../../application/services/memory";
import { generateUniqueId } from "./helpers";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
export interface TimelineSummaryState {
  timelineModalOpen: boolean;
  setTimelineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newSummaryTag: string;
  setNewSummaryTag: React.Dispatch<React.SetStateAction<string>>;
  newSummaryLoc: string;
  setNewSummaryLoc: React.Dispatch<React.SetStateAction<string>>;
  newSummaryContent: string;
  setNewSummaryContent: React.Dispatch<React.SetStateAction<string>>;
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
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSummarizing: (v: boolean) => void;
  databaseService: IDatabaseService<
    ChatSession,
    CharacterCard,
    SummaryCard,
    Message,
    ChatSessionMetadataPatch
  >;
  showCustomAlert: (msg: string) => Promise<void>;
}): TimelineSummaryState {
  const kernel = useKernel();
  const { activeSession, settings, activeCharacter, setSessionViews, setIsSummarizing, databaseService, showCustomAlert } = params;

  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [newSummaryTag, setNewSummaryTag] = useState("");
  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);

  const handleAutoSummaryCheck = useCallback(async (
    session: ChatSession,
    force: boolean = false,
    signal?: AbortSignal
  ) => {
    try {
      const memoryService = kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
      const summary = memoryService.getSummary();
      setIsSummarizing(true);
      const updatedSession = await summary.checkAndSummarize(
        session, settings, activeCharacter, force, signal
      );
      if (updatedSession !== session) {
        setSessionViews((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
        if (force) await showCustomAlert("会话记忆已整理并更新到故事年表。");
      } else if (force) {
        await showCustomAlert("当前没有需要整理的新对话内容。");
      }
    } catch (e: unknown) {
      if (getErrorName(e) === "AbortError" || getErrorMessage(e) === "AbortError") return;
      console.warn("Conversation memory summary failed:", e);
      if (force) {
        await showCustomAlert("会话记忆暂未整理完成。请检查当前模型服务配置，或稍后重试。");
      }
    } finally {
      setIsSummarizing(false);
    }
  }, [settings, activeCharacter, showCustomAlert, setSessionViews, setIsSummarizing]);

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
            }
          : s
      );
    } else {
      const lastMsgId = activeSession.messages && activeSession.messages.length > 0
        ? activeSession.messages[activeSession.messages.length - 1]?.id
        : undefined;
      const newCard: SummaryCard = {
        id: generateUniqueId("summary_"),
        timeTag: newSummaryTag.trim(),
        location: newSummaryLoc.trim() || "未知地点",
        content: newSummaryContent.trim(),
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

    setSessionViews((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      if (editingSummaryId) {
        const editedSummary = updatedSummaries.find((summary) => summary.id === editingSummaryId);
        if (editedSummary) {
          await databaseService.updateSessionSummary(updatedSession.id, editedSummary);
        }
      } else {
        const appendedSummary = updatedSummaries[updatedSummaries.length - 1];
        if (appendedSummary) {
          await databaseService.appendSessionSummary(updatedSession.id, appendedSummary);
        }
      }
    } catch (err: unknown) {
      console.error("Failed to save timeline summary:", err);
    }

    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
    setEditingSummaryId(null);
    setTimelineModalOpen(false);
  }, [
    newSummaryTag, newSummaryContent, newSummaryLoc, activeSession, editingSummaryId,
    setSessionViews, databaseService,
  ]);

  return {
    timelineModalOpen, setTimelineModalOpen,
    newSummaryTag, setNewSummaryTag,
    newSummaryLoc, setNewSummaryLoc,
    newSummaryContent, setNewSummaryContent,
    editingSummaryId, setEditingSummaryId,
    handleAddTimelineSummary,
    handleAutoSummaryCheck,
  };
}
