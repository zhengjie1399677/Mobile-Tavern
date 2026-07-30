/**
 * Settings Store 仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 settings Store 的 CRUD（含
 * 分轨存储与加密），不涉及连接管理、写队列或 schema。
 *
 * 设计要点：
 *  - 分轨存储：长文本字段（mainPrompt/jailbreakPrompt 等）写入 user_settings_large_prompts
 *    主记录 user_settings 仅保留短字段，避免单条记录过大
 *  - 加密：apiKey 字段经 settingsCrypto AES-GCM 加密后落盘
 *  - 解密失败兜底：清空 apiKey 字段，避免密文当明文导致双重加密
 *  - settled 守卫：getStoredSettings 嵌套 onsuccess 防止 resolve-after-reject
 */

import type { UserSettings, SavedPresetBundle } from "../../../types";
import { getDB } from "../idbConnection";
import {
  enqueueWrite,
  bindTransactionAbort,
  bindReadonlyTransactionAbort,
} from "../idbQueue";
import {
  decryptValue,
  encryptValue,
  getOrCreateCryptoKey,
} from "../settingsCrypto";

export async function getStoredSettings(): Promise<UserSettings | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    // settled 守卫：事务可能在任意阶段被 abort，onabort 触发 reject 后，
    // 后续 oncomplete 仍可能执行。用 settled 标志位短路所有后续 settle 调用。
    let settled = false;
    const safeResolve = (v: UserSettings | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const safeReject = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");

    // 在 readonly 事务内仅执行 GET 请求，将结果保存到闭包变量。
    // cryptoKey 获取与解密延迟到 transaction.oncomplete 后执行，
    // 避免 readonly 事务的 async onsuccess 内启动 readwrite 事务导致跨事务死锁
    // （readonly 事务等待 async onsuccess 结束才自动提交，而 readwrite 事务
    //  等待 readonly 事务释放）。
    let pendingSettings: UserSettings | null = null;
    let pendingLargePrompts: Record<string, any> | null = null;
    let settingsMissing = true;

    transaction.onabort = () =>
      safeReject(transaction.error || new Error("Transaction aborted"));
    transaction.onerror = () => {
      if (!settled) safeReject(transaction.error || new Error("Transaction error"));
    };

    const reqSettings = store.get("user_settings");
    reqSettings.onerror = () => safeReject(reqSettings.error);
    reqSettings.onsuccess = () => {
      const settings = reqSettings.result as UserSettings | null;
      if (!settings) {
        settingsMissing = true;
        return;
      }
      settingsMissing = false;
      pendingSettings = settings;
      // 在同一 readonly 事务内获取大文本分轨数据
      const reqLarge = store.get("user_settings_large_prompts");
      reqLarge.onerror = () => safeReject(reqLarge.error);
      reqLarge.onsuccess = () => {
        pendingLargePrompts = reqLarge.result || {};
      };
    };

    // 事务 commit 后（所有 GET 完成），在事务外执行 cryptoKey 获取与解密
    transaction.oncomplete = () => {
      if (settingsMissing) {
        safeResolve(null);
        return;
      }
      const settings = pendingSettings as UserSettings;
      const large = pendingLargePrompts || {};
      void assembleSettings(settings, large, db).then(safeResolve, safeReject);
    };
  });
}

/**
 * 在事务外拼装 settings 并执行 cryptoKey 获取与解密。
 * 提取为独立函数避免在 readonly 事务的 onsuccess 回调内启动 readwrite 事务。
 */
async function assembleSettings(
  settings: UserSettings,
  large: Record<string, any>,
  db: IDBDatabase,
): Promise<UserSettings> {
  // v6 升级/优化: 将大文本配置重新拼装回 settings 以保障向前兼容与零数据丢失
  if (settings.promptConfig) {
    if (large.mainPrompt !== undefined) settings.promptConfig.mainPrompt = large.mainPrompt;
    if (large.jailbreakPrompt !== undefined) settings.promptConfig.jailbreakPrompt = large.jailbreakPrompt;
    if (large.postHistoryPrompt !== undefined) settings.promptConfig.postHistoryPrompt = large.postHistoryPrompt;
    if (large.reasoningGuidancePrompt !== undefined) settings.promptConfig.reasoningGuidancePrompt = large.reasoningGuidancePrompt;
    if (large.tableMemoryPrompt !== undefined) settings.promptConfig.tableMemoryPrompt = large.tableMemoryPrompt;
    if (large.promptComposition !== undefined) settings.promptConfig.composition = large.promptComposition;
  } else {
    // 主记录 promptConfig 整体缺失（旧版数据/损坏）：从 largePrompts 还原全部字段，
    // 必须包含 composition，否则用户配置的组合策略静默丢失。
    settings.promptConfig = {
      mainPrompt: large.mainPrompt || "",
      jailbreakPrompt: large.jailbreakPrompt || "",
      postHistoryPrompt: large.postHistoryPrompt || "",
      reasoningGuidancePrompt: large.reasoningGuidancePrompt || "",
      tableMemoryPrompt: large.tableMemoryPrompt || "",
      composition: large.promptComposition,
      roleplayMode: true,
      useJailbreak: true,
      usePostHistory: true,
      instructTemplate: "default",
      systemPrefix: "",
      systemSuffix: "",
      userPrefix: "",
      userSuffix: "",
      assistantPrefix: "",
      assistantSuffix: "",
    };
  }

  if (large.bisonModePrompt !== undefined) settings.bisonModePrompt = large.bisonModePrompt;
  if (large.replySuggestionsPrompt !== undefined) settings.replySuggestionsPrompt = large.replySuggestionsPrompt;
  if (large.promptCompositionTemplates !== undefined) {
    settings.promptCompositionTemplates = large.promptCompositionTemplates;
  }

  try {
    const key = await getOrCreateCryptoKey(db);
    if (settings.api && settings.api.apiKey) {
      settings.api.apiKey = await decryptValue(settings.api.apiKey, key);
    }
    if (settings.savedApiProfiles && Array.isArray(settings.savedApiProfiles)) {
      for (const profile of settings.savedApiProfiles) {
        if (profile.apiKey) {
          profile.apiKey = await decryptValue(profile.apiKey, key);
        }
      }
    }
  } catch (err) {
    // 解密链路失败（通常是 getOrCreateCryptoKey 抛错）：必须清空所有 apiKey 字段，
    // 否则密文（enc_aes_gcm:...）会原样返回上层，用户看到 401/403 无法定位；
    // 更严重的是用户编辑其他设置触发 saveStoredSettings 时，encryptValue 会再次
    // 加密已加密的密文，造成双重加密，数据永久损坏。与 saveStoredSettings 的
    // DATA-04 策略保持一致：宁可让用户重新输入 key，也不保留密文/明文落库。
    console.error("[localDB] Failed to decrypt settings API keys, clearing to prevent double encryption:", err);
    if (settings.api) settings.api.apiKey = "";
    if (settings.savedApiProfiles && Array.isArray(settings.savedApiProfiles)) {
      for (const profile of settings.savedApiProfiles) {
        if (profile.apiKey) profile.apiKey = "";
      }
    }
  }

  return settings;
}

export async function saveStoredSettings(
  settings: UserSettings,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();

    // Perform shallow clone of root settings and shallow clone of API configurations
    // to prevent mutating the original settings objects in React memory state.
    const clonedSettings: UserSettings = {
      ...settings,
      api: settings.api ? { ...settings.api } : settings.api,
      savedApiProfiles: settings.savedApiProfiles
        ? settings.savedApiProfiles.map(profile => ({ ...profile }))
        : settings.savedApiProfiles,
      customThemes: settings.customThemes
        ? settings.customThemes.map(theme => ({
            ...theme,
            variables: { ...theme.variables },
          }))
        : settings.customThemes,
    };

    // DATA-04: 加密过程错误处理。失败时清空对应 apiKey 字段以防止明文落库，
    // 同时保留其他字段正常写入；密钥获取失败时清空全部 apiKey 字段。
    let cryptoKey: CryptoKey | null = null;
    try {
      cryptoKey = await getOrCreateCryptoKey(db);
    } catch (err) {
      console.error("[localDB] Failed to obtain crypto key, clearing apiKey fields to prevent plaintext storage:", err);
    }

    if (cryptoKey) {
      if (clonedSettings.api && clonedSettings.api.apiKey) {
        try {
          clonedSettings.api.apiKey = await encryptValue(clonedSettings.api.apiKey, cryptoKey);
        } catch (err) {
          // 跳过当前 apiKey 字段的加密，清空以避免明文落库
          console.error("[localDB] Failed to encrypt api.apiKey, clearing to prevent plaintext storage:", err);
          clonedSettings.api.apiKey = "";
        }
      }
      if (clonedSettings.savedApiProfiles && Array.isArray(clonedSettings.savedApiProfiles)) {
        for (const profile of clonedSettings.savedApiProfiles) {
          if (profile.apiKey) {
            try {
              profile.apiKey = await encryptValue(profile.apiKey, cryptoKey);
            } catch (err) {
              console.error("[localDB] Failed to encrypt profile.apiKey, clearing to prevent plaintext storage:", err);
              profile.apiKey = "";
            }
          }
        }
      }
    } else {
      // 无可用密钥：清空所有 apiKey 字段以杜绝明文落库
      if (clonedSettings.api) clonedSettings.api.apiKey = "";
      if (clonedSettings.savedApiProfiles && Array.isArray(clonedSettings.savedApiProfiles)) {
        for (const profile of clonedSettings.savedApiProfiles) {
          if (profile.apiKey) profile.apiKey = "";
        }
      }
    }

    // 分轨存储提取：将长文本大字段提取到独立的 IDB 键下
    const largePrompts = {
      mainPrompt: clonedSettings.promptConfig?.mainPrompt || "",
      jailbreakPrompt: clonedSettings.promptConfig?.jailbreakPrompt || "",
      postHistoryPrompt: clonedSettings.promptConfig?.postHistoryPrompt || "",
      reasoningGuidancePrompt: clonedSettings.promptConfig?.reasoningGuidancePrompt || "",
      tableMemoryPrompt: clonedSettings.promptConfig?.tableMemoryPrompt || "",
      promptComposition: clonedSettings.promptConfig?.composition,
      promptCompositionTemplates: clonedSettings.promptCompositionTemplates || [],
      bisonModePrompt: clonedSettings.bisonModePrompt || "",
      replySuggestionsPrompt: clonedSettings.replySuggestionsPrompt || "",
    };

    if (clonedSettings.promptConfig) {
      clonedSettings.promptConfig = {
        ...clonedSettings.promptConfig,
        mainPrompt: "",
        jailbreakPrompt: "",
        postHistoryPrompt: "",
        reasoningGuidancePrompt: "",
        tableMemoryPrompt: "",
        composition: undefined,
      };
    }
    clonedSettings.bisonModePrompt = "";
    clonedSettings.replySuggestionsPrompt = "";
    clonedSettings.promptCompositionTemplates = [];

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");

      const reqLarge = store.put(largePrompts, "user_settings_large_prompts");
      reqLarge.onerror = () => reject(reqLarge.error);
      // 不在 reqLarge.onsuccess 中触发 resolve：用 transaction.oncomplete 统一判定成功，
      // 确保两次 put 都已 commit。嵌套 onsuccess 仅表示请求入队，不保证事务整体落盘。
      const request = store.put(clonedSettings, "user_settings");
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, "settings:user_settings", signal);  // P1-11: 单一 settings 记录多次保存合并为一次落盘
}

export async function getStoredSavedPresets(): Promise<SavedPresetBundle[] | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("saved_presets_bundle");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveStoredSavedPresets(presets: SavedPresetBundle[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(presets, "saved_presets_bundle");
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

export async function getStoredDefaultCharactersInitializedFlag(): Promise<boolean> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("default_characters_initialized");

    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveStoredDefaultCharactersInitializedFlag(initialized: boolean, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(initialized, "default_characters_initialized");
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

export async function getStoredUsageMetrics(): Promise<unknown | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("usage_metrics");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveStoredUsageMetrics(metrics: unknown, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(metrics, "usage_metrics");
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}
