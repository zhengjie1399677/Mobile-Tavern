import React, { useCallback } from "react";
import { UserSettings, LorebookEntry, CharacterCard, CustomWorldbook, ChatSession, Message, SummaryCard } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import {
  IDatabaseService,
  KernelServices,
} from "@/src/application/serviceContracts";
import type { DataMigrationServiceTyped } from "../../application/services/DataMigrationService";
import { encryptBackupData, decryptBackupData } from "../../utils/cardParser";
import { DEFAULT_SETTINGS } from "./defaults";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
import { persistImportedChatSession } from "../../application/useCases/chatImportUseCases";
import {
  buildUnifiedBackupPayload,
  UNIFIED_BACKUP_MAGIC,
  parseAgentJournalEvents,
  parseAgentCompositionSnapshot,
  parseRuntimePluginState,
  parseAttachmentBackupRecords,
} from "../../application/useCases/dataMigrationUseCases";
/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本 Hook 实际使用的方法）。
 * 完整定义见 src-tauri/plugins/android-bridge/guest-js/index.ts。
 */
interface AndroidThemeBridge {
  saveFile(fileName: string, content: string): string;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge。
 * 字段可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

function saveBackupFile(fileName: string, content: string): string | undefined {
  const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
  if (bridge && typeof bridge.saveFile === "function") {
    const path = bridge.saveFile(fileName, content);
    if (!path || path.startsWith("error:")) {
      throw new Error(path || "原生文件保存失败");
    }
    return path;
  }

  const dataBlob = new Blob([content], { type: "text/plain" });
  const downloadUrl = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  return undefined;
}

interface UseBackupRestoreDeps {
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  setCustomWorldbooks: React.Dispatch<React.SetStateAction<Record<string, CustomWorldbook>>>;
  backupPass: string;
  encryptBackup: boolean;
  setBackupStatus: React.Dispatch<React.SetStateAction<string>>;
  showCustomAlert: (msg: string, title?: string) => Promise<void> | void;
  showCustomConfirm: (message: string) => Promise<boolean>;
}

interface UseBackupRestoreReturn {
  handleExportLocalDataBackup: (characters: CharacterCard[]) => Promise<void>;
  handleImportLocalDataBackup: (
    e: React.ChangeEvent<HTMLInputElement>,
    setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>,
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>
  ) => Promise<void>;
  handleImportSillyChatHistory: (
    e: React.ChangeEvent<HTMLInputElement>,
    characters: CharacterCard[],
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>
  ) => Promise<void>;
  handleSilentDailyBackup: (characters: CharacterCard[]) => Promise<boolean>;
}

/**
 * 备份导入/导出子 Hook。
 *
 * 负责：
 * - handleExportLocalDataBackup：将设置/角色/会话/世界书打包为统一备份文件（可选加密）
 * - handleImportLocalDataBackup：校验并还原统一备份，覆盖本地 IndexedDB
 * - handleImportSillyChatHistory：导入 SillyTavern JSONL/JSON 聊天记录并匹配本地角色卡
 */
export const useBackupRestore = ({
  settings,
  setSettings,
  setGlobalLorebook,
  setCustomWorldbooks,
  backupPass,
  encryptBackup,
  setBackupStatus,
  showCustomAlert,
  showCustomConfirm,
}: UseBackupRestoreDeps): UseBackupRestoreReturn => {
  const kernel = useKernel();
  const databaseService = kernel.getService<IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>>(KernelServices.Database);
  const dataMigrationService = kernel.getService<DataMigrationServiceTyped>(KernelServices.DataMigration);

  const handleExportLocalDataBackup = useCallback(async (characters: any[]) => {
    void characters;
    if (encryptBackup && !backupPass.trim()) {
      await showCustomAlert("开启了加密，请预设一个强度适宜的数据保护密码。");
      return;
    }
    setBackupStatus(
      encryptBackup ? "正在加密并创建备份文件..." : "正在创建明文备份...",
    );
    try {
      const payloadObj = await dataMigrationService.createBackupPayload(settings, encryptBackup);
      const jsonStr = JSON.stringify(payloadObj);
      let outputData = jsonStr;

      if (encryptBackup) {
        outputData = await encryptBackupData(jsonStr, backupPass.trim());
      }

      const fileName = `mobile_tavern_backup_${new Date().toISOString().slice(0, 10)}${encryptBackup ? ".backup" : ".json"}`;
      const path = saveBackupFile(fileName, outputData);
      setBackupStatus("备份文件创建并下载完成！");
      await showCustomAlert(
        path
          ? `📂 数据备份导出成功！\n文件已保存至手机 /Download 公共文件夹下：\n${path}${encryptBackup ? "" : "\n\n⚠️ 明文备份已自动抹除全部 API Key 配置。"}`
          : `备份数据已导出成功！\n文件名：\n${fileName}\n\n文件已触发浏览器或客户端下载，请前往“下载 (Downloads)”目录查找。${encryptBackup ? "" : "\n\n⚠️ 明文备份已自动抹除全部 API Key 配置。"}`,
        "导出成功"
      );
    } catch (err: unknown) {
      setBackupStatus(`备份崩溃: ${getErrorMessage(err)}`);
    }
  }, [encryptBackup, backupPass, showCustomAlert, setBackupStatus, settings, dataMigrationService]);

  const handleImportLocalDataBackup = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>,
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupStatus("读取文件中...");
    try {
      const textData = await file.text();
      let parsed;
      if (textData.startsWith("{")) {
        parsed = JSON.parse(textData);
      } else {
        if (!backupPass.trim()) {
          await showCustomAlert("备份可能是加密文件，请先输入对应密码。");
          e.target.value = "";
          return;
        }
        setBackupStatus("验证解码中...");
        const decryptedJson = await decryptBackupData(
          textData,
          backupPass.trim(),
        );
        parsed = JSON.parse(decryptedJson);
      }

      // 1. Magic Header Envelope check (Backward compatible)
      if (parsed.magic !== undefined && parsed.magic !== UNIFIED_BACKUP_MAGIC) {
        throw new Error("备份文件签名不匹配，非此程序导出的有效备份数据。");
      }

      // 2. Structural Arrays validation
      if (!Array.isArray(parsed.characters)) {
        throw new Error("备份文件损坏：characters 列表必须是合规数组。");
      }
      if (!Array.isArray(parsed.sessions)) {
        throw new Error("备份文件损坏：sessions 列表必须是合规数组。");
      }

      // 3. Item-level schema validation and sanitization for Characters
      const validatedCharacters: any[] = [];
      for (const c of parsed.characters) {
        if (c && typeof c === "object" && typeof c.id === "string" && typeof c.name === "string") {
          validatedCharacters.push({
            ...c,
            id: c.id,
            name: c.name,
            avatar: typeof c.avatar === "string" ? c.avatar : "",
            description: typeof c.description === "string" ? c.description : "",
            personality: typeof c.personality === "string" ? c.personality : "",
            scenario: typeof c.scenario === "string" ? c.scenario : "",
            first_mes: typeof c.first_mes === "string" ? c.first_mes : "",
            mes_example: typeof c.mes_example === "string" ? c.mes_example : "",
            system_prompt: typeof c.system_prompt === "string" ? c.system_prompt : "",
            post_history_instructions: typeof c.post_history_instructions === "string" ? c.post_history_instructions : "",
            alternate_greetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings : [],
            lorebookEntries: Array.isArray(c.lorebookEntries) ? c.lorebookEntries : [],
            isWorldbookGlobal: c.isWorldbookGlobal !== undefined ? !!c.isWorldbookGlobal : undefined,
            visualSettings: c.visualSettings && typeof c.visualSettings === "object" ? c.visualSettings : undefined,
            extensions: c.extensions && typeof c.extensions === "object" ? c.extensions : undefined,
            variables: c.variables && typeof c.variables === "object" ? c.variables : undefined,
          });
        } else {
          console.warn("Filtered out corrupted character entry during import:", c);
        }
      }

      // 4. Item-level schema validation and sanitization for Sessions
      const validatedSessions: any[] = [];
      for (const s of parsed.sessions) {
        if (s && typeof s === "object" && typeof s.id === "string" && typeof s.characterId === "string" && Array.isArray(s.messages)) {
          validatedSessions.push({
            ...s,
            id: s.id,
            characterId: s.characterId,
            title: typeof s.title === "string" ? s.title : "无标题对话",
            createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
            messages: s.messages.filter((m: any) => m && typeof m === "object" && typeof m.id === "string" && typeof m.sender === "string" && typeof m.content === "string"),
            summaries: Array.isArray(s.summaries) ? s.summaries : [],
            lastSummarizedMessageId: typeof s.lastSummarizedMessageId === "string" ? s.lastSummarizedMessageId : undefined,
            variables: s.variables && typeof s.variables === "object" ? s.variables : undefined,
            runtimePluginState: parseRuntimePluginState(s.runtimePluginState),
            compositionSnapshot: parseAgentCompositionSnapshot(s.compositionSnapshot),
          });
        } else {
          console.warn("Filtered out corrupted session entry during import:", s);
        }
      }
      const validatedFragments = Array.isArray(parsed.memoryFragments)
        ? parsed.memoryFragments.filter((fragment: any) =>
            fragment &&
            typeof fragment.id === "string" &&
            typeof fragment.sessionId === "string" &&
            typeof fragment.content === "string" &&
            Array.isArray(fragment.sourceMessageIds)
          ).map((fragment: any) => ({
            ...fragment,
            participants: Array.isArray(fragment.participants) ? fragment.participants : [],
            tags: Array.isArray(fragment.tags) ? fragment.tags : [],
            sourceRole: ["user", "assistant", "system"].includes(fragment.sourceRole)
              ? fragment.sourceRole
              : "assistant",
            sourceTurnStart: Number.isInteger(fragment.sourceTurnStart) ? fragment.sourceTurnStart : 0,
            sourceTurnEnd: Number.isInteger(fragment.sourceTurnEnd) ? fragment.sourceTurnEnd : 0,
            status: ["active", "superseded", "invalid"].includes(fragment.status)
              ? fragment.status
              : "active",
            importance: typeof fragment.importance === "number" ? fragment.importance : 0.7,
            confidence: typeof fragment.confidence === "number" ? fragment.confidence : 1,
            createdAt: typeof fragment.createdAt === "number" ? fragment.createdAt : Date.now(),
            updatedAt: typeof fragment.updatedAt === "number" ? fragment.updatedAt : Date.now(),
          }))
        : [];
      const validatedFacts = Array.isArray(parsed.memoryFacts)
        ? parsed.memoryFacts.filter((fact: any) =>
            fact &&
            typeof fact.id === "string" &&
            typeof fact.sessionId === "string" &&
            typeof fact.subject === "string" &&
            typeof fact.predicate === "string" &&
            typeof fact.object === "string" &&
            typeof fact.sourceMessageId === "string"
          ).map((fact: any) => ({
            ...fact,
            tags: Array.isArray(fact.tags) ? fact.tags : [fact.subject, fact.object],
            status: ["active", "superseded", "invalid"].includes(fact.status)
              ? fact.status
              : "active",
            validFromTurn: Number.isInteger(fact.validFromTurn) ? fact.validFromTurn : 0,
            confidence: typeof fact.confidence === "number" ? fact.confidence : 1,
            createdAt: typeof fact.createdAt === "number" ? fact.createdAt : Date.now(),
            updatedAt: typeof fact.updatedAt === "number" ? fact.updatedAt : Date.now(),
          }))
        : [];
      const validatedDictEntries = Array.isArray(parsed.memoryDictEntries)
        ? parsed.memoryDictEntries.filter((entry: any) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.sessionId === "string" &&
            typeof entry.entity === "string"
          )
        : [];
      const validatedGlobalLorebook = Array.isArray(parsed.globalLorebook)
        ? parsed.globalLorebook
        : [];
      const validatedCustomWorldbooks = parsed.customWorldbooks &&
        typeof parsed.customWorldbooks === "object" &&
        !Array.isArray(parsed.customWorldbooks)
        ? parsed.customWorldbooks
        : {};
      const validatedSavedPresets = Array.isArray(parsed.savedPresets)
        ? parsed.savedPresets
        : [];
      const validatedAttachments = parseAttachmentBackupRecords(parsed.attachments);
      const validatedAgentJournal = parseAgentJournalEvents(parsed.agentJournal);

      const mergedSettings: UserSettings = parsed.settings
        ? {
            ...DEFAULT_SETTINGS,
            ...parsed.settings,
            api: {
              ...DEFAULT_SETTINGS.api,
              ...(parsed.settings.api || {}),
            },
            memory: {
              ...DEFAULT_SETTINGS.memory,
              ...(parsed.settings.memory || {}),
            },
            promptConfig: {
              ...DEFAULT_SETTINGS.promptConfig,
              ...(parsed.settings.promptConfig || {}),
              sectionHeaders: {
                ...DEFAULT_SETTINGS.promptConfig.sectionHeaders,
                ...(parsed.settings.promptConfig?.sectionHeaders || {}),
              },
            },
          }
        : structuredClone(DEFAULT_SETTINGS);

      const parsedVersion = Number(parsed.version || 0);
      const legacyWarning = parsedVersion < 4
        ? "\n\n注意：这是旧版备份，不包含独立世界书、记忆词典、自定义预设库和消息附件；这些项目将按空数据恢复。当前数据会先自动导出安全快照。"
        : parsedVersion < 5
          ? "\n\n注意：这是 v4 备份，不包含消息附件；当前数据会先自动导出安全快照。"
          : parsedVersion < 6
            ? "\n\n注意：这是 v5 备份，不包含 Agent Turn、Provider 决定和工具调用记录；当前数据会先自动导出安全快照。"
            : "\n\n恢复前会自动导出当前数据的脱敏安全快照。";

      const ok = await showCustomConfirm(
        `数据解密与格式校验成功！恢复将以备份内容完整替换本地角色、会话、记忆和世界书，是否确认？${legacyWarning}`,
      );
      if (ok) {
        setBackupStatus("正在创建恢复前安全快照...");
        const safetySnapshot = await dataMigrationService.createBackupPayload(settings, false);
        const safetyName = `pre_restore_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        saveBackupFile(safetyName, JSON.stringify(safetySnapshot));

        const replacementPayload = buildUnifiedBackupPayload({
          characters: validatedCharacters,
          sessions: validatedSessions,
          memoryDictEntries: validatedDictEntries,
          memoryFragments: validatedFragments,
          memoryFacts: validatedFacts,
          settings: mergedSettings,
          savedPresets: validatedSavedPresets,
          globalLorebook: validatedGlobalLorebook,
          customWorldbooks: validatedCustomWorldbooks,
          backupDate: typeof parsed.backupDate === "string" ? parsed.backupDate : new Date().toISOString(),
          isEncrypted: false,
          attachments: validatedAttachments,
          agentJournal: validatedAgentJournal,
        });

        setBackupStatus("正在原子覆盖本地数据...");
        await dataMigrationService.replaceFromBackup(replacementPayload);

        setCharacters(validatedCharacters);
        setSessionViews(validatedSessions);
        setSettings(mergedSettings);
        setGlobalLorebook(validatedGlobalLorebook);
        setCustomWorldbooks(validatedCustomWorldbooks);

        await showCustomAlert(
          `本地备份已原子覆盖还原。恢复前安全快照：${safetyName}`,
        );
        setBackupStatus("数据导入覆盖完成！");
        window.location.reload();
      }
    } catch (err: unknown) {
      await showCustomAlert(
        `无法解密或导入备份: ${getErrorMessage(err)}. 请确保密码拼写绝对一致。`,
      );
      setBackupStatus(`失败: ${getErrorMessage(err)}`);
    } finally {
      e.target.value = "";
    }
  }, [backupPass, showCustomAlert, showCustomConfirm, setBackupStatus, setSettings, setGlobalLorebook, setCustomWorldbooks, settings, dataMigrationService]);

  const handleImportSillyChatHistory = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    characters: CharacterCard[],
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupStatus("正在读取聊天记录...");
    try {
      const textData = await file.text();
      let lines = textData.split("\n").map(l => l.trim()).filter(Boolean);
      let rawMessages: any[] = [];
      let characterNameFromFile = "";

      // 1. Try to parse as JSONL
      let isJsonl = false;
      try {
        if (file.name.endsWith(".jsonl") || (!textData.trim().startsWith("[") && !textData.trim().startsWith("{"))) {
          isJsonl = true;
        }
      } catch (err) {
        console.warn("[useBackupRestore] Failed to detect jsonl format:", err);
      }

      if (isJsonl) {
        let firstLineParsed: any = null;
        for (let i = 0; i < lines.length; i++) {
          try {
            const parsedLine = JSON.parse(lines[i]);
            if (i === 0) {
              firstLineParsed = parsedLine;
              if (parsedLine.character_name) {
                characterNameFromFile = parsedLine.character_name;
                continue;
              }
            }
            rawMessages.push(parsedLine);
          } catch (lineErr) {
            console.warn(`Failed to parse JSONL line ${i + 1}:`, lineErr);
          }
        }
      } else {
        // 2. Try to parse as JSON
        try {
          const parsedJson = JSON.parse(textData);
          if (Array.isArray(parsedJson)) {
            rawMessages = parsedJson;
          } else if (typeof parsedJson === "object" && parsedJson !== null) {
            if (parsedJson.history && Array.isArray(parsedJson.history)) {
              rawMessages = parsedJson.history;
            } else if (Array.isArray(parsedJson.messages)) {
              rawMessages = parsedJson.messages;
            } else {
              const keys = Object.keys(parsedJson).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
              if (keys.length > 0) {
                rawMessages = keys.map(k => parsedJson[k]);
              } else {
                rawMessages = [parsedJson];
              }
            }
            if (parsedJson.character_name) {
              characterNameFromFile = parsedJson.character_name;
            }
          }
        } catch (jsonErr) {
          throw new Error("文件无法解析为有效的 JSON/JSONL 格式。");
        }
      }

      if (rawMessages.length === 0) {
        throw new Error("聊天记录中没有找到任何有效的消息段。");
      }

      // Try to find character name from messages if not found in metadata
      if (!characterNameFromFile) {
        const charMsg = rawMessages.find(m => m && !m.is_user && m.character_name);
        if (charMsg) {
          characterNameFromFile = charMsg.character_name;
        } else {
          const dashIdx = file.name.indexOf(" - ");
          if (dashIdx !== -1) {
            characterNameFromFile = file.name.substring(0, dashIdx).trim();
          } else {
            const dotIdx = file.name.lastIndexOf(".");
            characterNameFromFile = dotIdx !== -1 ? file.name.substring(0, dotIdx).trim() : file.name;
          }
        }
      }

      if (!characterNameFromFile) {
        throw new Error("无法从文件或文件名中识别 AI 角色名字。");
      }

      // Match character card in database
      const matchedChar = characters.find(
        (c) => c.name.trim().toLowerCase() === characterNameFromFile.trim().toLowerCase()
      );

      if (!matchedChar) {
        throw new Error(
          `本地数据库中未找到名为「${characterNameFromFile}」的角色卡。\n请先导入该角色的角色卡，再导入其聊天记录。`
        );
      }

      // Convert SillyTavern messages to MobileTavern Message objects
      const formattedMessages: any[] = rawMessages.map((item, idx) => {
        let sender: "user" | "assistant" | "system" = "assistant";
        if (item.is_user === true || item.sender === "user") {
          sender = "user";
        } else if (item.is_system === true || item.sender === "system") {
          sender = "system";
        }

        const content = item.mes || item.message || item.content || "";
        const timestamp = item.send_date || item.timestamp || (Date.now() - (rawMessages.length - idx) * 1000);

        return {
          id: item.id || `msg_ST_${Math.random().toString(36).substring(2, 9)}_${idx}`,
          sender,
          content,
          timestamp,
          swipes: Array.isArray(item.swipes) ? item.swipes : undefined,
          swipe_id: typeof item.swipe_id === "number" ? item.swipe_id : undefined,
          extra: item.extra && typeof item.extra === "object" ? item.extra : undefined,
        };
      });

      const finalMessages = formattedMessages.filter(m => m.content);

      if (finalMessages.length === 0) {
        throw new Error("解析后未发现有效的对话内容。");
      }

      let chatTitle = "导入的剧情线";
      const fileBaseName = file.name.replace(/\.[^/.]+$/, "");
      const datePart = fileBaseName.match(/\d{4}-\d{2}-\d{2}/);
      if (datePart) {
        chatTitle = `酒馆导入 (${datePart[0]})`;
      }

      const lastMsgId = finalMessages[finalMessages.length - 1].id;

      const newSession = {
        id: `session_ST_${Math.random().toString(36).substring(2, 9)}`,
        characterId: matchedChar.id,
        title: chatTitle,
        createdAt: Date.now(),
        messages: finalMessages,
        summaries: [] as never[],
        lastSummarizedMessageId: lastMsgId,
        variables: {},
        tableMemory: [] as never[],
      };

      const ok = await showCustomConfirm(
        `成功识别匹配到本地角色「${matchedChar.name}」，包含历史对话 ${finalMessages.length} 回合。是否导入？`
      );

      if (ok) {
        await persistImportedChatSession(databaseService, newSession);
        setSessionViews((prev) => [...prev, newSession]);
        setBackupStatus("聊天记录导入完成！");
        await showCustomAlert(
          `🎉 聊天记录导入成功！\n分支标题：${chatTitle}\n已绑定到角色：${matchedChar.name}\n共 ${finalMessages.length} 回合对话，您可以进入聊天页向上翻阅查看。`
        );
      }
    } catch (err: unknown) {
      await showCustomAlert(`导入聊天记录失败: ${getErrorMessage(err)}`);
      setBackupStatus(`导入失败: ${getErrorMessage(err)}`);
    } finally {
      e.target.value = "";
    }
  }, [showCustomAlert, showCustomConfirm, setBackupStatus, databaseService]);

  const handleSilentDailyBackup = useCallback(async (characters: any[]) => {
    void characters;
    const lastBackup = settings.lastBackupTime || 0;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 如果未满 24 小时，静默跳过
    if (Date.now() - lastBackup <= ONE_DAY) {
      return false;
    }

    try {
      console.log("[AutoBackup] Performing silent daily background backup...");
      // 真机写入逻辑
      const silentBridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
      if (silentBridge && typeof silentBridge.saveFile === "function") {
        const payloadObj = await dataMigrationService.createBackupPayload(settings, false);
        const jsonStr = JSON.stringify(payloadObj);
        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const fileName = `autobackup_${todayStr}.json`;
        const path = silentBridge.saveFile(fileName, jsonStr);
        if (path && !path.startsWith("error:")) {
          console.log("[AutoBackup] Silent daily backup saved successfully to: ", path);
          setSettings((prev) => ({
            ...prev,
            lastBackupTime: Date.now(),
          }));
          return true;
        } else {
          console.error("[AutoBackup] Silent daily backup failed: ", path);
        }
      } else {
        // 电脑浏览器开发模式：仅更新时间戳，避免弹窗下载打扰开发者
        console.log("[AutoBackup] Web environment detected. Skipping file save, updated lastBackupTime timestamp.");
        setSettings((prev) => ({
          ...prev,
          lastBackupTime: Date.now(),
        }));
        return true;
      }
    } catch (err) {
      console.error("[AutoBackup] Error during silent daily background backup:", err);
    }
    return false;
  }, [settings, setSettings, dataMigrationService]);

  return {
    handleExportLocalDataBackup,
    handleImportLocalDataBackup,
    handleImportSillyChatHistory,
    handleSilentDailyBackup,
  };
};
