import React, { useCallback } from "react";
import { ChatSession, CharacterCard, Message, SummaryCard, UserSettings } from "../../types";
import { IDatabaseService, ISessionManagementService } from "@/src/application/serviceContracts";
import { ITelemetryService } from "@/src/application/serviceContracts";
import { cleanSuggestionsFromText, parseSuggestions } from "./helpers";
import { listBuiltinPluginMetadata, loadBuiltinPluginById } from "../../infrastructure/plugins/builtinPlugins";
import { listInstalledPlugins, loadPluginFiles } from "../../infrastructure/plugins/pluginStorage";
import type { InstalledFullscreenPlugin } from "../../domain/plugins";

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
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  loadCharacterById?: (id: string) => Promise<CharacterCard | null>;
  setActiveCharId: (id: string) => void;
  setActiveSessionId: (id: string | null) => Promise<boolean>;
  setActiveTab: (tab: string) => void;
  setChatSubTab: React.Dispatch<React.SetStateAction<"dialogue" | "timeline">>;
  setShowSessionManager: React.Dispatch<React.SetStateAction<boolean>>;
  setMsgMenuId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshSessionStatistics: () => Promise<void>;
  hydrateSessionMessages: (sessionId: string) => Promise<void>;
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>;
  telemetryService: ITelemetryService;
  sessionManagementService: ISessionManagementService<ChatSession>;
  showCustomAlert: (msg: string) => Promise<void>;
  showCustomConfirm: (msg: string) => Promise<boolean>;
  showCustomPrompt: (msg: string, defaultValue?: string) => Promise<string | null>;
  launchPlugin: (plugin: InstalledFullscreenPlugin) => void;
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
      p.setSessionViews((prev) => [...prev, newSession]);
      void p.refreshSessionStatistics();
      p.setActiveSessionId(newSession.id);
    } catch (err: unknown) {
      console.error("Failed to save new session:", err);
    }
  }, [p]);

  const selectCharacter = useCallback(async (charId: string) => {
    // 插件型角色卡：启动全屏插件而非进入对话
    if (charId.startsWith("plugin:")) {
      const pluginId = charId.slice("plugin:".length);
      await launchPluginById(pluginId, p.launchPlugin);
      return;
    }
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再切换角色卡。");
      return;
    }
    const loadStartTime = performance.now();
    try {
      const latestKnownSession = p.sessions
        .filter((session) => session.characterId === charId)
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
      const [targetChar, lastSession] = await Promise.all([
        p.loadCharacterById
          ? p.loadCharacterById(charId)
          : Promise.resolve(p.characters.find((character) => character.id === charId) ?? null),
        latestKnownSession
          ? Promise.resolve(latestKnownSession)
          : p.databaseService.getLatestSessionByCharacter(charId),
      ]);
      if (!targetChar) throw new Error(`CHARACTER_NOT_FOUND:${charId}`);
      let targetSession: ChatSession;
      if (lastSession) {
        p.setSessionViews((previous) => previous.some((session) => session.id === lastSession.id)
          ? previous
          : [...previous, lastSession]);
        targetSession = lastSession;
      } else {
        const newSession = await p.databaseService.createNewSession(targetChar, targetChar?.first_mes);
        p.setSessionViews((prev) => [...prev, newSession]);
        void p.refreshSessionStatistics();
        targetSession = newSession;
      }
      try {
        await p.hydrateSessionMessages(targetSession.id);
      } catch (error: unknown) {
        console.warn("Failed to prepare chat messages before entering:", error);
      }
      if (!await p.setActiveSessionId(targetSession.id)) return;
      p.setActiveCharId(charId);
      p.setActiveTab("chat");
      p.setChatSubTab("dialogue");
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
    if (!p.activeCharacter) return;
    try {
      const newSession = await p.databaseService.createEmptyBranch(p.activeCharacter, branchTitle);
      p.setSessionViews((prev) => [...prev, newSession]);
      void p.refreshSessionStatistics();
      p.setActiveSessionId(newSession.id);
      p.setShowSessionManager(false);
    } catch (err: unknown) {
      console.error("Failed to save new branch session:", err);
    }
  }, [p]);

  const deleteBranch = useCallback(async (id: string) => {
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再删除分支。");
      return;
    }
    const confirm = await p.showCustomConfirm("要归档这个聊天分支吗？归档后可在会话管理器中恢复或永久删除。");
    if (!confirm) return;
    try {
      await p.sessionManagementService.archiveSession(id);
      const remaining = p.sessions.filter((s) => s.id !== id);
      if (p.activeSessionId === id) {
        const latest = p.activeCharId
          ? await p.databaseService.getLatestSessionByCharacter(p.activeCharId)
          : null;
        if (latest && !remaining.some((session) => session.id === latest.id)) remaining.push(latest);
        p.setActiveSessionId(latest?.id ?? null);
      }
      p.setSessionViews(remaining);
    } catch (err: unknown) {
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
      `${p.activeCharacter.name} - 故事分支 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;
    try {
      const newSession = await p.databaseService.createBacktrackBranch(p.activeSession, branchTitle, msg.id);
      p.setSessionViews((prev) => [...prev, newSession]);
      void p.refreshSessionStatistics();
      p.setActiveSessionId(newSession.id);
      p.setMsgMenuId(null);
      p.setChatSubTab("dialogue");
      await p.showCustomAlert("分支故事线创建完美拉起！您已成功无痛回溯至选定对话时间轴。");
    } catch (err: unknown) {
      console.error("Failed to save backtrack branch session:", err);
      await p.showCustomAlert(
        `创建分支失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [p]);

  const createBacktrackFromTimeline = useCallback(async (summary: SummaryCard) => {
    if (!p.activeCharacter || !p.activeSession) return;
    if (p.isSending || p.isSendingRef.current) {
      await p.showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建平行分支。");
      return;
    }
    const branchTitle = await p.showCustomPrompt(
      "请输入根据该幕历史创立的新分支标题:",
      `时间流分支: ${summary.timeTag}`
    );
    if (!branchTitle) return;
    try {
      const newSession = await p.databaseService.createBacktrackFromTimeline(
        p.activeSession, branchTitle, summary.id
      );
      p.setSessionViews((prev) => [...prev, newSession]);
      void p.refreshSessionStatistics();
      p.setActiveSessionId(newSession.id);
      p.setChatSubTab("dialogue");
      await p.showCustomAlert(`已基于时间线："${summary.timeTag}" 重构分叉世界！`);
    } catch (err: unknown) {
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

/**
 * 根据 pluginId 解析并启动全屏插件。
 * 先查内置插件（已含 files），再查用户已安装插件（按需加载 files），最后调用 launchPlugin。
 */
async function launchPluginById(
  pluginId: string,
  launchPlugin: (plugin: InstalledFullscreenPlugin) => void,
): Promise<void> {
  const builtins = await listBuiltinPluginMetadata();
  const builtin = builtins.find((item) => item.id === pluginId);
  if (builtin) {
    launchPlugin(await loadBuiltinPluginById(pluginId));
    return;
  }
  const installed = await listInstalledPlugins();
  const meta = installed.find((item) => item.id === pluginId);
  if (meta) {
    const files = await loadPluginFiles(pluginId);
    launchPlugin({ ...meta, files });
    return;
  }
  console.warn(`[SessionManager] Plugin not found: ${pluginId}`);
}
