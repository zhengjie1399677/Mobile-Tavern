import React, { useCallback } from "react";
import { UserSettings, LorebookEntry, CharacterCard, CustomWorldbook, ChatSession, Message, SummaryCard } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import {
  IDatabaseService,
  KernelServices,
} from "@/src/application/serviceContracts";
import type { DataMigrationServiceTyped } from "../../application/services/DataMigrationService";
import { encryptBackupData } from "../../utils/cardParser";
import { DEFAULT_SETTINGS } from "./defaults";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
import { persistImportedChatSession } from "../../application/useCases/chatImportUseCases";
import {
  BackupPayloadError,
  normalizeBackupPayload,
  summarizeBackupPayload,
  type BackupPayloadSummary,
  type BackupVersionGap,
} from "../../application/useCases/backupPayloadRestore";
import {
  pullSnapshotFromHost,
  pushSnapshotToHost,
  type SnapshotSyncFailure,
  type SnapshotSyncTarget,
} from "../../application/useCases/hostSnapshotSync";
import {
  mergeBackupPayloads,
  type BackupMergePlan,
  type BackupMergeStats,
} from "../../application/useCases/backupMerge";
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

/**
 * 旧版备份缺失能力的中文提示。
 *
 * 版本判定本身在备份边界用例中完成，这里只负责把它翻译成用户文案，
 * 保持与既有交互一字不差。
 */
function describeVersionNotice(gap: BackupVersionGap): string {
  switch (gap.code) {
    case "legacy_v3":
      return "\n\n注意：这是旧版备份，不包含独立世界书、记忆词典、自定义预设库和消息附件；这些项目将按空数据恢复。当前数据会先自动导出安全快照。";
    case "legacy_v4":
      return "\n\n注意：这是 v4 备份，不包含消息附件；当前数据会先自动导出安全快照。";
    case "legacy_v5":
      return "\n\n注意：这是 v5 备份，不包含 Agent Turn、Provider 决定和工具调用记录；当前数据会先自动导出安全快照。";
    case "legacy_v6":
      return "\n\n注意：这是 v6 备份，不包含跨设备删除记录；用它做合并可能让已删除的内容重新出现，建议只用于覆盖式恢复。当前数据会先自动导出安全快照。";
    default:
      return "\n\n恢复前会自动导出当前数据的脱敏安全快照。";
  }
}

/** 读取用户配置的远程宿主目标；未配置时返回 null（界面据此引导前往设置）。 */
function resolveHostSyncTarget(settings: UserSettings): SnapshotSyncTarget | null {
  const binding = settings.hostBinding;
  if (!binding) return null;
  const baseUrl = (binding.remoteUrl || "").trim();
  if (!baseUrl) return null;
  return { baseUrl, accessKey: (binding.remoteAccessKey || "").trim() };
}

type HostSyncMode = "merge" | "replace";

/**
 * 同步语义来自设置，缺省为合并。
 *
 * 「未设置」不能解释成「沿用旧行为（覆盖）」：覆盖会抹掉另一端独有的数据，
 * 那会让升级后的第一次同步产生静默数据丢失。缺省必须是更安全的合并。
 */
function resolveHostSyncMode(settings: UserSettings): HostSyncMode {
  return settings.hostBinding?.syncMode === "replace" ? "replace" : "merge";
}

/** 高级选项：关闭后同步直接执行，不再弹确认框（安全快照仍然留存）。 */
function isMergePreviewEnabled(settings: UserSettings): boolean {
  return settings.hostBinding?.syncPreviewEnabled !== false;
}

/** 合并计划里「新增 + 更新 + 删除」的合计，用于判断本次同步是否真的会改动数据。 */
function mergeStatsDelta(stats: BackupMergeStats): number {
  return Object.values(stats).reduce(
    (sum, collection) => sum + collection.added + collection.updated + collection.removed,
    0,
  );
}

/** 把合并计数渲染成若干行，供确认文案与结果提示共用。 */
function mergeCountLines(stats: BackupMergeStats): string[] {
  const sum = (pick: (item: BackupMergeStats[keyof BackupMergeStats]) => number) =>
    pick(stats.memoryFragments) + pick(stats.memoryFacts) + pick(stats.memoryDictEntries);
  const fmt = (label: string, item: BackupMergeStats[keyof BackupMergeStats]) =>
    `${label}：新增 ${item.added} · 更新 ${item.updated} · 删除 ${item.removed}`;
  return [
    fmt("会话", stats.sessions),
    fmt("消息", stats.messages),
    fmt("角色", stats.characters),
    fmt("记忆", {
      added: sum((item) => item.added),
      updated: sum((item) => item.updated),
      removed: sum((item) => item.removed),
      unchanged: sum((item) => item.unchanged),
    }),
  ];
}

/**
 * 合并预览文案。
 *
 * `direction` 决定冲突裁决里 local / remote 该怎么称呼：拉取时 local 是本机，
 * 推送时 local 是宿主。搞反会把「保留了宿主的版本」说成「保留了本机的版本」。
 */
function formatMergePlan(plan: BackupMergePlan, direction: "pull" | "push"): string {
  const lines = mergeCountLines(plan.stats);
  if (plan.conflicts.length > 0) {
    const localName = direction === "pull" ? "本机" : "宿主";
    const remoteName = direction === "pull" ? "宿主" : "本机";
    const preview = plan.conflicts
      .slice(0, 3)
      .map((conflict) => {
        const winner = conflict.resolution === "local" ? localName : remoteName;
        return `「${conflict.title}」保留${winner}版本`;
      })
      .join("、");
    lines.push(
      `两侧都改动过的会话 ${plan.conflicts.length} 个，按更新时间较晚的一方保留：${preview}${
        plan.conflicts.length > 3 ? " 等" : ""
      }`,
    );
  }
  return lines.join("\n");
}

/** 宿主回传的统计没有冲突明细，只渲染计数行。 */
function formatMergeCounts(stats: BackupMergeStats): string {
  return mergeCountLines(stats).join("\n");
}

/** 同步确认文案里的数据量摘要。 */
function formatPayloadSummary(summary: BackupPayloadSummary): string {
  const memory = summary.memoryFragments + summary.memoryFacts + summary.memoryDictEntries;
  return `角色 ${summary.characters} · 会话 ${summary.sessions} · 消息 ${summary.messages} · 记忆 ${memory} · 世界书 ${summary.globalLorebook + summary.customWorldbooks} · 附件 ${summary.attachments}`;
}

/** 把同步失败原因翻译成可执行的中文提示。 */
function describeHostSyncFailure(failure?: SnapshotSyncFailure): string {
  switch (failure) {
    case "invalid_url":
      return "宿主地址格式不正确，请到「宿主与互联」核对。";
    case "unauthorized":
      return "宿主凭据不正确（401/403），请核对访问凭据。";
    case "unreachable":
      return "无法连接宿主：网络不可达或超时。";
    case "payload_too_large":
      return "数据超过宿主接收上限（50 MB），请先精简消息附件。";
    case "empty_response":
      return "宿主返回了空快照。";
    case "rejected":
      return "宿主拒绝了该请求。";
    case "malformed_json":
      return "宿主快照不是有效 JSON。";
    case "magic_mismatch":
      return "宿主快照签名不匹配，目标可能不是本程序的宿主。";
    case "invalid_characters":
      return "宿主快照损坏：角色列表非法。";
    case "invalid_sessions":
      return "宿主快照损坏：会话列表非法。";
    case "encrypted_password_required":
      return "宿主快照已加密，跨设备同步暂不支持加密快照。";
    case "decrypt_failed":
      return "宿主快照解密失败。";
    case "invalid_tombstones":
      return "宿主快照损坏：跨设备删除记录非法。";
    default:
      return "未知原因。";
  }
}

const HOST_SYNC_UNCONFIGURED = "尚未配置远程宿主。请先在「设置 → 宿主与互联」里填写宿主地址与访问凭据。";

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
  handlePullFromHost: (
    setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>,
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>
  ) => Promise<void>;
  handlePushToHost: () => Promise<void>;
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

      // 解析、签名校验、逐项清洗与默认值回落统一交给备份边界用例，
      // 与「从宿主拉取快照」共用同一入口，避免两处规则漂移。
      const normalized = await normalizeBackupPayload({
        text: textData,
        passphrase: backupPass.trim(),
        defaultSettings: DEFAULT_SETTINGS,
      });

      const legacyWarning = describeVersionNotice(normalized.versionGap);

      const ok = await showCustomConfirm(
        `数据解密与格式校验成功！恢复将以备份内容完整替换本地角色、会话、记忆和世界书，是否确认？${legacyWarning}`,
      );
      if (ok) {
        setBackupStatus("正在创建恢复前安全快照...");
        const safetySnapshot = await dataMigrationService.createBackupPayload(settings, false);
        const safetyName = `pre_restore_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        saveBackupFile(safetyName, JSON.stringify(safetySnapshot));

        setBackupStatus("正在原子覆盖本地数据...");
        await dataMigrationService.replaceFromBackup(normalized.payload);

        setCharacters(normalized.payload.characters);
        setSessionViews(normalized.payload.sessions);
        setSettings(normalized.payload.settings);
        setGlobalLorebook(normalized.payload.globalLorebook);
        setCustomWorldbooks(normalized.payload.customWorldbooks);

        await showCustomAlert(
          `本地备份已原子覆盖还原。恢复前安全快照：${safetyName}`,
        );
        setBackupStatus("数据导入覆盖完成！");
        window.location.reload();
      }
    } catch (err: unknown) {
      if (err instanceof BackupPayloadError && err.code === "encrypted_password_required") {
        await showCustomAlert(err.message);
        return;
      }
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
      const lines = textData.split("\n").map(l => l.trim()).filter(Boolean);
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

  /**
   * 从宿主拉取数据到本机。语义由设置里的 `syncMode` 决定。
   *
   * - 合并（默认）：`localPayload` 参与计算，拉回来的是「本机 ∪ 宿主」，两端独有内容都保留；
   *   落库走 `mergeFromBackup`（不清空 Store，只按差集删除墓碑判定应消失的实体）。
   * - 覆盖：拉回来的宿主快照整体替换本机数据，落库走 `replaceFromBackup`。
   *
   * 两种语义共用的硬约束：`settings` 保留本机值 —— 否则手机的 API Key / 主题 / 语言
   * 会被 PC 的覆盖。这条由合并算法（只取 local 一侧设置）与覆盖路径的显式赋值共同保证。
   *
   * 「关闭合并预览」是高级选项：跳过确认直接执行，但仍然会留存安全快照。覆盖模式不受
   * 该选项影响 —— 破坏性操作不能因为一个开关就失去二次确认。
   */
  const handlePullFromHost = useCallback(async (
    setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>,
    setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  ) => {
    const target = resolveHostSyncTarget(settings);
    if (!target) {
      await showCustomAlert(HOST_SYNC_UNCONFIGURED);
      return;
    }

    const mode = resolveHostSyncMode(settings);
    const previewEnabled = isMergePreviewEnabled(settings);

    setBackupStatus(
      mode === "merge" ? "正在读取两端数据并计算合并结果..." : "正在读取宿主快照...",
    );
    try {
      // 合并模式下本机信封要参与计算，必须先于拉取取到；覆盖模式下同样用于确认文案。
      const localPayload = await dataMigrationService.createBackupPayload(settings, false);
      const localSummary = summarizeBackupPayload(localPayload);

      const pulled = await pullSnapshotFromHost({
        target,
        localSettings: settings,
        defaultSettings: DEFAULT_SETTINGS,
        ...(mode === "merge" ? { localPayload } : {}),
      });
      if (!pulled.ok || !pulled.payload) {
        setBackupStatus("宿主快照读取失败");
        await showCustomAlert(
          `无法读取宿主快照：${describeHostSyncFailure(pulled.failure)}${pulled.detail ? `\n\n${pulled.detail}` : ""}`,
        );
        return;
      }

      const remoteSummary = pulled.remoteSummary ?? summarizeBackupPayload(pulled.payload);
      const plan = pulled.mergePlan;

      // 合并结果与本机现状一致时不必写库：省掉一次全量重写，也不必让用户为「没发生的变化」
      // 重新加载界面。
      if (mode === "merge" && plan && mergeStatsDelta(plan.stats) === 0) {
        setBackupStatus("两端数据已一致，无需同步");
        await showCustomAlert("合并结果与本机现状完全一致，未改动任何数据。");
        return;
      }

      const confirmMessage = mode === "merge"
        ? [
            "即将把宿主数据与本机数据合并（求并集，两端独有内容都保留）。",
            "",
            `本机：${formatPayloadSummary(localSummary)}`,
            `宿主：${formatPayloadSummary(remoteSummary)}`,
            ...(plan ? [`合并后：${formatPayloadSummary(plan.mergedSummary)}`] : []),
            "",
            ...(plan ? [`本次变更：\n${formatMergePlan(plan, "pull")}`, ""] : []),
            "本机设置（含 API Key）会保留；执行前会留存安全快照。",
            "是否继续？",
          ].join("\n")
        : `即将用宿主数据覆盖本机（覆盖式，后写者生效，不做合并）。\n\n宿主：${formatPayloadSummary(remoteSummary)}\n本机：${formatPayloadSummary(localSummary)}\n\n本机的角色、会话、记忆与世界书将被宿主内容完整替换；本机设置（含 API Key）会保留。\n是否继续？`;

      if (mode === "replace" || previewEnabled) {
        const ok = await showCustomConfirm(confirmMessage);
        if (!ok) {
          setBackupStatus("已取消宿主拉取");
          return;
        }
      }

      setBackupStatus("正在创建恢复前安全快照...");
      const safetySnapshot = await dataMigrationService.createBackupPayload(settings, false);
      const safetyName = `pre_host_pull_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      saveBackupFile(safetyName, JSON.stringify(safetySnapshot));

      setBackupStatus(mode === "merge" ? "正在写入合并结果..." : "正在原子覆盖本地数据...");
      if (mode === "merge") {
        await dataMigrationService.mergeFromBackup(pulled.payload);
      } else {
        await dataMigrationService.replaceFromBackup(pulled.payload);
      }

      setCharacters(pulled.payload.characters);
      setSessionViews(pulled.payload.sessions);
      setSettings(pulled.payload.settings);
      setGlobalLorebook(pulled.payload.globalLorebook);
      setCustomWorldbooks(pulled.payload.customWorldbooks);

      setBackupStatus("宿主同步完成");
      await showCustomAlert(
        mode === "merge"
          ? `✅ 已按合并结果更新本机数据，两端独有内容都保留。\n本机设置（含 API Key）已保留。\n执行前安全快照：${safetyName}`
          : `✅ 已用宿主快照原子覆盖本机数据。\n本机设置（含 API Key）已保留。\n恢复前安全快照：${safetyName}`,
      );
      window.location.reload();
    } catch (err: unknown) {
      setBackupStatus(`宿主拉取失败: ${getErrorMessage(err)}`);
      await showCustomAlert(`从宿主拉取失败: ${getErrorMessage(err)}`);
    }
  }, [settings, setSettings, setGlobalLorebook, setCustomWorldbooks, showCustomAlert, showCustomConfirm, setBackupStatus, dataMigrationService]);

  /**
   * 把本机数据推送到宿主。语义由设置里的 `syncMode` 决定。
   *
   * - 合并（默认）：`?mode=merge`，宿主读自己的快照当 local、本机载荷当 remote 求并集，
   *   因此宿主独有内容不会被抹掉。合并必须在宿主侧完成 —— 宿主的快照导出是脱敏的，
   *   只有宿主自己读得到真实凭据来当 local。
   * - 覆盖：宿主整体替换，`?preserveSettings=true` 让宿主保留自己的设置。
   *
   * 推送前先只读探测宿主：既拿到宿主真实数据量，也避免在宿主不可达时白推。探测回来的
   * 宿主快照在合并模式下还能如实复刻本机的合并计算，作为「宿主那边会发生什么」的预览；
   * 那份预览信封只用于取统计，绝不发给宿主（它的 settings 是本机设置，送过去等于拿本机
   * 凭据覆盖宿主）。
   */
  const handlePushToHost = useCallback(async () => {
    const target = resolveHostSyncTarget(settings);
    if (!target) {
      await showCustomAlert(HOST_SYNC_UNCONFIGURED);
      return;
    }

    const mode = resolveHostSyncMode(settings);
    const previewEnabled = isMergePreviewEnabled(settings);

    setBackupStatus("正在读取本机与宿主数据...");
    try {
      const localPayload = await dataMigrationService.createBackupPayload(settings, false);
      const localSummary = summarizeBackupPayload(localPayload);

      const probe = await pullSnapshotFromHost({
        target,
        localSettings: settings,
        defaultSettings: DEFAULT_SETTINGS,
      });
      if (!probe.ok || (mode === "merge" && !probe.payload)) {
        setBackupStatus("宿主不可用，已取消推送");
        await showCustomAlert(
          `无法连接宿主，未推送任何数据：${describeHostSyncFailure(probe.failure)}${probe.detail ? `\n\n${probe.detail}` : ""}`,
        );
        return;
      }

      const remoteSummary = probe.remoteSummary
        ?? (probe.payload ? summarizeBackupPayload(probe.payload) : localSummary);

      // 宿主会用它自己的快照当 local、本机载荷当 remote，这里复刻同一计算作为预览。
      const plan = mode === "merge" && probe.payload
        ? mergeBackupPayloads({ local: probe.payload, remote: localPayload })
        : undefined;

      if (plan && mergeStatsDelta(plan.stats) === 0) {
        setBackupStatus("已与宿主一致，无需推送");
        await showCustomAlert("合并结果与宿主现状完全一致，未推送任何数据。");
        return;
      }

      const confirmMessage = mode === "merge"
        ? [
            "即将把本机数据合并到宿主（求并集，宿主独有内容都保留）。",
            "",
            `本机：${formatPayloadSummary(localSummary)}`,
            `宿主：${formatPayloadSummary(remoteSummary)}`,
            ...(plan ? [`合并后（宿主侧）：${formatPayloadSummary(plan.mergedSummary)}`] : []),
            "",
            ...(plan ? [`预计变更：\n${formatMergePlan(plan, "push")}`, ""] : []),
            "宿主自己的设置（含 API Key）会保留，本机不会写入宿主凭据；执行前会留存安全快照。",
            "是否继续？",
          ].join("\n")
        : `即将把本机数据覆盖到宿主（覆盖式，后写者生效，不做合并）。\n\n本机：${formatPayloadSummary(localSummary)}\n宿主：${formatPayloadSummary(remoteSummary)}\n\n宿主的角色、会话、记忆与世界书将被本机内容完整替换；宿主自己的设置（含 API Key）会保留，本机不会写入宿主凭据。\n是否继续？`;

      if (mode === "replace" || previewEnabled) {
        const ok = await showCustomConfirm(confirmMessage);
        if (!ok) {
          setBackupStatus("已取消宿主推送");
          return;
        }
      }

      setBackupStatus("正在创建推送前安全快照...");
      const safetySnapshot = await dataMigrationService.createBackupPayload(settings, false);
      const safetyName = `pre_host_push_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      saveBackupFile(safetyName, JSON.stringify(safetySnapshot));

      setBackupStatus("正在推送到宿主...");
      const pushed = await pushSnapshotToHost({
        target,
        localPayload,
        defaultSettings: DEFAULT_SETTINGS,
        mode,
      });
      if (!pushed.ok) {
        setBackupStatus("宿主推送失败");
        await showCustomAlert(
          `推送到宿主失败：${describeHostSyncFailure(pushed.failure)}${pushed.detail ? `\n\n${pushed.detail}` : ""}\n\n本机数据未被修改。`,
        );
        return;
      }

      setBackupStatus("宿主同步完成");
      const hostChangeLines = pushed.mergeStats
        ? `\n\n宿主侧实际变更：\n${formatMergeCounts(pushed.mergeStats)}`
        : "";
      await showCustomAlert(
        mode === "merge"
          ? `✅ 已把本机数据合并到宿主，宿主独有内容保留。${hostChangeLines}\n\n宿主设置已保留，未写入本机 API Key。\n执行前安全快照：${safetyName}`
          : `✅ 已用本机数据覆盖宿主快照。\n宿主设置已保留，未写入本机 API Key。\n推送前安全快照：${safetyName}`,
      );
    } catch (err: unknown) {
      setBackupStatus(`宿主推送失败: ${getErrorMessage(err)}`);
      await showCustomAlert(`推送到宿主失败: ${getErrorMessage(err)}`);
    }
  }, [settings, showCustomAlert, showCustomConfirm, setBackupStatus, dataMigrationService]);

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
    handlePullFromHost,
    handlePushToHost,
    handleSilentDailyBackup,
  };
};
