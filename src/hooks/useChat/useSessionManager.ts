import React, { useCallback } from "react";
import { ChatSession, CharacterCard, Message, SummaryCard, UserSettings } from "../../types";
import { IDatabaseService } from "../../kernel/types";
import { ITelemetryService } from "../../kernel/types";

interface SessionManagerParams {
  isSending: boolean;
  isSendingRef: React.MutableRefObject<boolean>;
  activeCharId: string | null;
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  sessions: ChatSession[];
  characters: CharacterCard[];
  settings: UserSettings;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setActiveCharId: (id: string) => void;
  setActiveSessionId: (id: string | null) => void;
  setActiveTab: (tab: string) => void;
  setChatSubTab: React.Dispatch<React.SetStateAction<"dialogue" | "timeline">>;
  setShowSessionManager: React.Dispatch<React.SetStateAction<boolean>>;
  setMsgMenuId: React.Dispatch<React.SetStateAction<string | null>>;
  deleteSession: (id: string) => Promise<void>;
  databaseService: IDatabaseService;
  telemetryService: ITelemetryService;
  triggerScroll: () => void;
  showCustomAlert: (msg: string) => Promise<void>;
  showCustomConfirm: (msg: string) => Promise<boolean>;
  showCustomPrompt: (msg: string, defaultValue?: string) => Promise<string | null>;
}

/**
 * 管理聊天会话与分支的生命周期：
 * 新建会话、角色切换、创建/删除分支、消息回溯分支。
 */
export function useSessionManager(p: SessionManagerParams) {
  const handleStartNewSession = useCallback(async (customFirstMessage?: string) => {
    if (!p.activeCharacter) return;
    const starterMsg = customFirstMessage ?? p.activeCharacter.first_mes;
    const defaultGreetingSuggestions = `\n<suggestions>["继续对话", "打个招呼", "静观其变", "进行互动"]</suggestions>`;
    let finalStarterMsg = starterMsg;
    let initialSuggestions: string[] | undefined = undefined;

    // 仅当设置启用回复建议时才处理 suggestions 标签
    // 注意：默认问候语由角色卡 first_mes 或用户传入，此处不硬编码剧情逻辑
    if (starterMsg && p.settings.enableReplySuggestions) {
      if (starterMsg.includes("<suggestions>")) {
        const { cleanSuggestionsFromText, parseSuggestions } = await import("./helpers");
        const cleanedTextObj = cleanSuggestionsFromText(starterMsg);
        if (cleanedTextObj.suggestionsText) {
          initialSuggestions = parseSuggestions(cleanedTextObj.suggestionsText);
        }
      } else {
        finalStarterMsg = `${starterMsg.trim()}${defaultGreetingSuggestions}`;
        initialSuggestions = ["继续对话", "打个招呼", "静观其变", "进行互动"];
      }
    }

    try {
      const newSession = await p.databaseService.createNewSession(
        p.activeCharacter, finalStarterMsg, initialSuggestions
      );
      p.setSessions((prev) => [...prev, newSession]);
      p.setActiveSessionId(newSession.id);
      p.triggerScroll();
    } catch (err: any) {
      console.error("Failed to save new session:", err);
    }
  }, [p]);

  const selectCharacter = useCallback(async (charId: string) => {
    if (p.isSending) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再切换角色卡。");
      return;
    }
    const loadStartTime = performance.now();
    try {
      p.setActiveCharId(charId);
      const charSessions = p.sessions.filter((s) => s.characterId === charId);
      if (charSessions.length > 0) {
        const lastSession = [...charSessions].sort((a, b) => {
          const aTime = a.messages?.at(-1)?.timestamp ?? a.createdAt;
          const bTime = b.messages?.at(-1)?.timestamp ?? b.createdAt;
          return bTime - aTime;
        })[0];
        p.setActiveSessionId(lastSession.id);
      } else {
        const targetChar = p.characters.find((c) => c.id === charId);
        const newSession = await p.databaseService.createNewSession(targetChar, targetChar?.first_mes);
        p.setSessions((prev) => [...prev, newSession]);
        p.setActiveSessionId(newSession.id);
      }
      p.setActiveTab("chat");
      p.setChatSubTab("dialogue");
      p.triggerScroll();
    } finally {
      const duration = performance.now() - loadStartTime;
      try {
        p.telemetryService.reportUsage("performance_chat_load", {
          detail: "Chat session load completed",
          generationTime: duration,
        });
      } catch (e) {
        console.warn("Failed to report chat load time telemetry:", e);
      }
    }
  }, [p]);

  const createNewBranch = useCallback(async () => {
    if (!p.activeCharId) return;
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建新分支。");
      return;
    }
    const branchTitle = await p.showCustomPrompt(
      "请输入全新独立分支存档名称:",
      `${p.activeCharacter?.name} - 新分支线 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;
    try {
      const newSession = await p.databaseService.createEmptyBranch(p.activeCharacter, branchTitle);
      p.setSessions((prev) => [...prev, newSession]);
      p.setActiveSessionId(newSession.id);
      p.setShowSessionManager(false);
    } catch (err: any) {
      console.error("Failed to save new branch session:", err);
    }
  }, [p]);

  const deleteBranch = useCallback(async (id: string) => {
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再删除分支。");
      return;
    }
    const confirm = await p.showCustomConfirm("确定要永久删除这个聊天分支吗？(无法恢复)");
    if (!confirm) return;
    try {
      await p.deleteSession(id);
      const remaining = p.sessions.filter((s) => s.id !== id);
      if (p.activeSessionId === id) {
        const charRemaining = remaining
          .filter((s) => s.characterId === p.activeCharId)
          .sort((a, b) => {
            const aTime = a.messages?.at(-1)?.timestamp ?? a.createdAt;
            const bTime = b.messages?.at(-1)?.timestamp ?? b.createdAt;
            return bTime - aTime;
          });
        p.setActiveSessionId(charRemaining.length > 0 ? charRemaining[0].id : null);
      }
      p.setSessions(remaining);
    } catch (err: any) {
      console.error("Failed to delete branch session:", err);
    }
  }, [p]);

  const createBacktrackBranch = useCallback(async (msg: Message) => {
    if (!p.activeCharacter || !p.activeSession) return;
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建分支。");
      return;
    }
    const branchTitle = await p.showCustomPrompt(
      "请输入新分支存档名称:",
      `${p.activeCharacter.name} - 故事分支分支于 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;
    try {
      const newSession = await p.databaseService.createBacktrackBranch(p.activeSession, branchTitle, msg.id);
      p.setSessions((prev) => [...prev, newSession]);
      p.setActiveSessionId(newSession.id);
      p.setMsgMenuId(null);
      p.setChatSubTab("dialogue");
      await p.showCustomAlert("分支故事线创建完美拉起！您已成功无痛回溯至选定对话时间轴。");
      p.triggerScroll();
    } catch (err: any) {
      console.error("Failed to save backtrack branch session:", err);
    }
  }, [p]);

  const createBacktrackFromTimeline = useCallback(async (summary: SummaryCard) => {
    if (!p.activeCharacter || !p.activeSession) return;
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建平行分支。");
      return;
    }
    const branchTitle = await p.showCustomPrompt(
      "请输入根据该幕历史创立的心宿分支标题:",
      `时间流分支: ${summary.timeTag}`
    );
    if (!branchTitle) return;
    try {
      const newSession = await p.databaseService.createBacktrackFromTimeline(
        p.activeSession, branchTitle, summary.id
      );
      p.setSessions((prev) => [...prev, newSession]);
      p.setActiveSessionId(newSession.id);
      p.setChatSubTab("dialogue");
      await p.showCustomAlert(`已基于时间线："${summary.timeTag}" 重构分叉世界！`);
      p.triggerScroll();
    } catch (err: any) {
      console.error("Failed to save backtrack timeline session:", err);
    }
  }, [p]);

  return {
    handleStartNewSession,
    selectCharacter,
    createNewBranch,
    deleteBranch,
    createBacktrackBranch,
    createBacktrackFromTimeline,
  };
}
