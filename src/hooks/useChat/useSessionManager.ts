import React, { useCallback } from "react";
import { ChatSession, CharacterCard, Message, SummaryCard, UserSettings } from "../../types";
import { IDatabaseService } from "../../kernel/types";
import { ITelemetryService } from "../../kernel/types";
import { cleanSuggestionsFromText, parseSuggestions } from "./helpers";
import { listBuiltinPlugins } from "../../infrastructure/plugins/builtinPlugins";
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
      p.setSessions((prev) => [...prev, newSession]);
      p.setActiveSessionId(newSession.id);
      p.triggerScroll();
    } catch (err: any) {
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
      "请输入根据该幕历史创立的新分支标题:",
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

  // 自动清理空会话：当活跃会话切换时，非活跃且用户发言轮数为0的会话将被自动从数据库和状态中清理
  React.useEffect(() => {
    const activeId = p.activeSessionId;
    if (!activeId) return;

    // 手动创建的空会话保护期：创建后 5 分钟内不清理，避免用户刚创建分支还没发消息就被回收。
    const GRACE_PERIOD_MS = 5 * 60 * 1000;
    const now = Date.now();

    const emptySessions = p.sessions.filter((s) => {
      if (s.id === activeId) return false;

      // 保护期判定：创建时间在 5 分钟内的会话跳过清理
      if (s.createdAt && now - s.createdAt < GRACE_PERIOD_MS) return false;

      // 核心修正：当会话未懒加载（s.messages 为 undefined 时），切勿降级计算。
      // 此时必须通过数据库缓存的 turnCount 字段进行快速识别过滤。
      if (s.messages === undefined) {
        // 如果数据库中存的缓存 turnCount 明确为 0，才判定为空，加入清理队列；
        // 如果是老数据（s.turnCount 缺失为 undefined），为防止数据误删，必须保守跳过，决不能清理
        return s.turnCount === 0;
      }

      // messages 已经加载的情况：直接通过内存中的 user 消息数量计算
      const userMsgCount = s.messages.filter((m) => m.sender === "user").length;
      return userMsgCount === 0;
    });

    if (emptySessions.length === 0) return;

    const cleanup = async () => {
      try {
        for (const s of emptySessions) {
          await p.deleteSession(s.id);
        }
        const emptyIds = new Set(emptySessions.map((s) => s.id));
        p.setSessions((prev) => prev.filter((s) => !emptyIds.has(s.id)));
        console.log(`[SessionManager] Automatically cleaned up ${emptySessions.length} empty sessions.`);
      } catch (err) {
        console.warn("[SessionManager] Failed to auto cleanup empty sessions:", err);
      }
    };

    const timer = setTimeout(cleanup, 500);
    return () => clearTimeout(timer);
  }, [p.activeSessionId, p.sessions, p.deleteSession, p.setSessions]);

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
  const builtins = await listBuiltinPlugins();
  const builtin = builtins.find((item) => item.id === pluginId);
  if (builtin) {
    launchPlugin(builtin);
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
