import type * as React from "react";
import { useEffect } from "react";
import { UserSettings, LorebookEntry, CustomWorldbook } from "../../types";
import {
  getStoredSettings,
  saveStoredSettings,
  getGlobalLorebook,
  getStoredSavedPresets,
  saveStoredSavedPresets,
  getCustomWorldbooks,
} from "../../utils/localDB";
  DEFAULT_REPLY_SUGGESTIONS_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
  DEFAULT_BISON_MODE_PROMPT,
  DEFAULT_SUMMARY_SYSTEM_PROMPT,
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
  FORMAT_PRESERVATION_BUNDLE,
  MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
  setFormatPreservationBundle,
  setMobileTavernBasicPresetBundle,
} from "./defaults";
import { cleanLorebookEntry } from "./mergeUtils";

interface UseSettingsLoaderDeps {
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  setCustomWorldbooks: React.Dispatch<React.SetStateAction<Record<string, CustomWorldbook>>>;
  setIsReady: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * 设置加载与预设注入迁移子 Hook。
 *
 * 负责从 IndexedDB 读取已存储的设置、预设包与世界书，并与外部静态
 * default_presets.json 进行合并迁移。仅在挂载时执行一次。
 */
export const useSettingsLoader = ({
  setSettings,
  setGlobalLorebook,
  setCustomWorldbooks,
  setIsReady,
}: UseSettingsLoaderDeps) => {
  // Load Settings and Lorebook from local DB
  useEffect(() => {
    const loadSettings = async () => {
      try {
        let storedSet = await getStoredSettings();
        const storedSavedPresets = await getStoredSavedPresets();
        const storedLores = await getGlobalLorebook();
        const storedWorldbooks = await getCustomWorldbooks();

        // 💡 核心安全策略：如果检测到数据库中没有主提示词数据（首次运行或被清空），则从外部静态 JSON 文件异步拉取初始化
        let externalPreset: any = null;
        if (!storedSet || !storedSet.promptConfig?.mainPrompt) {
          try {
            const res = await fetch("/default_presets.json");
            if (res.ok) {
              externalPreset = await res.json();
            }
          } catch (fetchErr) {
            console.warn("[useSettings] Failed to fetch external default presets:", fetchErr);
          }
        }

        if (storedSet) {
          if (externalPreset?.basicPresetBundle) {
            setMobileTavernBasicPresetBundle({
              ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
              promptConfig: {
                ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig,
                ...externalPreset.basicPresetBundle.promptConfig,
              }
            });
          }
          if (externalPreset?.formatPreservationBundle) {
            setFormatPreservationBundle({
              ...FORMAT_PRESERVATION_BUNDLE,
              promptConfig: {
                ...FORMAT_PRESERVATION_BUNDLE.promptConfig,
                ...externalPreset.formatPreservationBundle.promptConfig,
              }
            });
          }
          // Backward compatibility: retrieve from storedSet if saved_presets_bundle key doesn't exist yet
          let mergedSavedPresets = storedSavedPresets || [];
          let needSave = false;
          let needSavePresets = false;

          if (!storedSavedPresets && storedSet.savedPresets && storedSet.savedPresets.length > 0) {
            mergedSavedPresets = storedSet.savedPresets;
            needSavePresets = true;
            needSave = true;
          }

          // Force upgrade current active prompts if they contain any old default prompt patterns
          const isOldDefaultPrompt =
            storedSet.promptConfig?.mainPrompt?.includes("[NARRATIVE ENGINE:") ||
            storedSet.promptConfig?.mainPrompt?.includes("[系统核心任务：") ||
            storedSet.promptConfig?.mainPrompt?.includes("叙事共鸣沙盒");

          if (isOldDefaultPrompt) {
            storedSet.promptConfig.mainPrompt = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.mainPrompt;
            storedSet.promptConfig.jailbreakPrompt = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.jailbreakPrompt;
            storedSet.promptConfig.storyString = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.storyString;
            storedSet.promptConfig.customPrompts = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.customPrompts;
            delete storedSet.promptConfig.postHistoryPrompt;
            delete storedSet.promptConfig.usePostHistory;
            delete storedSet.promptConfig.enableReasoningGuidance;
            delete storedSet.promptConfig.reasoningGuidancePrompt;
            needSave = true;
          }

          mergedSavedPresets = mergedSavedPresets.map((b: any) => ({
            ...b,
            presetRegexScripts: b.presetRegexScripts || []
          }));

          let didInject = false;
          let nextMergedPresets = (mergedSavedPresets || []).filter(
            (p: any) => p.id !== "bundle_format_preservation"
          );
          if (nextMergedPresets.length !== (mergedSavedPresets || []).length) {
            didInject = true;
          }

          const basicPresetIndex = nextMergedPresets.findIndex(
            (p: any) => p.id === "bundle_mobile_tavern_basic"
          );
          if (basicPresetIndex === -1) {
            nextMergedPresets = [...nextMergedPresets, MOBILE_TAVERN_BASIC_PRESET_BUNDLE];
            didInject = true;
          } else {
            const basicBundle = { ...nextMergedPresets[basicPresetIndex] };
            let updated = false;
            if (basicBundle.preset?.name !== "基本预设") {
              basicBundle.preset = {
                ...(basicBundle.preset || {}),
                name: "基本预设",
              };
              updated = true;
            }

            if (
              basicBundle.promptConfig?.mainPrompt?.includes("叙事共鸣沙盒") ||
              !basicBundle.promptConfig?.customPrompts?.some((p: any) => p.id === "prompt_reasoning_discipline")
            ) {
              basicBundle.preset = {
                ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset,
                id: basicBundle.preset?.id || MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset.id,
                name: "基本预设",
              };
              basicBundle.promptConfig = {
                ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig,
              };
              updated = true;
            }

            if (updated) {
              nextMergedPresets[basicPresetIndex] = basicBundle;
              didInject = true;
            }
          }
          mergedSavedPresets = nextMergedPresets;

          if (didInject) {
            needSavePresets = true;
            needSave = true;
          }

          let personas = storedSet.userPersonas && storedSet.userPersonas.length > 0
            ? storedSet.userPersonas
            : [
                {
                  id: "default-persona",
                  name: storedSet.userName || DEFAULT_SETTINGS.userName,
                  avatar: storedSet.userAvatar || DEFAULT_SETTINGS.userAvatar || "",
                  description: storedSet.userInfo || DEFAULT_SETTINGS.userInfo || "",
                }
              ];

          let activeId = storedSet.activePersonaId || personas[0].id;

          // 如果活跃人物 ID 在列表中找不到，强制重置为第一个人设的 ID
          if (!personas.some((p: any) => p.id === activeId)) {
            activeId = personas[0].id;
          }

          // 强制同步活跃人设的名称、头像、背景到全局属性，确保完全一致
          const activeIdx = personas.findIndex((p: any) => p.id === activeId);
          let finalUserName = storedSet.userName || DEFAULT_SETTINGS.userName;
          let finalUserAvatar = storedSet.userAvatar || DEFAULT_SETTINGS.userAvatar || "";
          let finalUserInfo = storedSet.userInfo || DEFAULT_SETTINGS.userInfo || "";

          if (activeIdx !== -1) {
            const activePers = personas[activeIdx];

            // 以活跃人设的数据为主，如有差异同步覆盖回全局属性，避免抹除人设自定义属性
            if (storedSet.userName !== activePers.name) {
              finalUserName = activePers.name || "";
              needSave = true;
            }
            if (storedSet.userAvatar !== activePers.avatar) {
              finalUserAvatar = activePers.avatar || "";
              needSave = true;
            }
            if (storedSet.userInfo !== activePers.description) {
              finalUserInfo = activePers.description || "";
              needSave = true;
            }
          }

          const defaultPromptConfig = externalPreset
            ? { ...DEFAULT_PROMPT_CONFIG, ...externalPreset.promptConfig }
            : MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig;

          const defaultMemory = externalPreset
            ? { ...DEFAULT_SETTINGS.memory, ...externalPreset.memory }
            : DEFAULT_SETTINGS.memory;

          const defaultPrompts = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig.customPrompts || [];
          const userPrompts = storedSet.promptConfig?.customPrompts || [];
          let roleUpdated = false;
          let customPromptsUpdated = false;
          const mergedCustomPrompts = [...userPrompts].map((p: any) => {
            if (p.role !== "system") {
              roleUpdated = true;
              return { ...p, role: "system" as const };
            }
            return p;
          });

          for (const dp of defaultPrompts) {
            if (!mergedCustomPrompts.some((up: any) => up.id === dp.id)) {
              mergedCustomPrompts.push(dp);
              customPromptsUpdated = true;
            }
          }
          if (customPromptsUpdated || roleUpdated) {
            needSave = true;
          }

          const mergedSet: UserSettings = {
            api: {
              ...DEFAULT_SETTINGS.api,
              ...(storedSet.api || {}),
              chatPath: storedSet.api?.chatPath || DEFAULT_SETTINGS.api.chatPath,
              modelsPath: storedSet.api?.modelsPath || DEFAULT_SETTINGS.api.modelsPath,
              bypassProxy: storedSet.api?.bypassProxy ?? DEFAULT_SETTINGS.api.bypassProxy,
              sendNames: storedSet.api?.sendNames ?? DEFAULT_SETTINGS.api.sendNames,
              disableReasoning: storedSet.api?.disableReasoning ?? DEFAULT_SETTINGS.api.disableReasoning,
            },
            preset: { ...DEFAULT_SETTINGS.preset, ...(storedSet.preset || {}) },
            memory: {
              ...defaultMemory,
              ...(storedSet.memory || {}),
              summarySystemPrompt: (() => {
                const stored = storedSet.memory?.summarySystemPrompt;
                if (!stored || !stored.includes("【历史剧情归纳系统】")) {
                  needSave = true;
                  return DEFAULT_SUMMARY_SYSTEM_PROMPT;
                }
                return stored;
              })(),
              timeTagTemplate: storedSet.memory?.timeTagTemplate || DEFAULT_SETTINGS.memory.timeTagTemplate,
            },
            promptConfig: {
              ...defaultPromptConfig,
              ...(storedSet.promptConfig || {}),
              mainPrompt: storedSet.promptConfig?.mainPrompt || defaultPromptConfig.mainPrompt,
              postHistoryPrompt: storedSet.promptConfig?.postHistoryPrompt || defaultPromptConfig.postHistoryPrompt,
              reasoningGuidancePrompt: storedSet.promptConfig?.reasoningGuidancePrompt || defaultPromptConfig.reasoningGuidancePrompt,
              tableMemoryPrompt: (() => {
                const stored = storedSet.promptConfig?.tableMemoryPrompt;
                if (!stored || !stored.includes("【状态与结构化记忆引擎】")) {
                  needSave = true;
                  return DEFAULT_TABLE_MEMORY_PROMPT;
                }
                return stored;
              })(),
              customPrompts: mergedCustomPrompts,
              sectionHeaders: {
                ...defaultPromptConfig.sectionHeaders,
                ...(storedSet.promptConfig?.sectionHeaders || {}),
              },
            },
            userName: finalUserName,
            userInfo: finalUserInfo,
            userAvatar: finalUserAvatar,
            userPersonas: personas,
            activePersonaId: activeId,
            globalChatBg: storedSet.globalChatBg || DEFAULT_SETTINGS.globalChatBg,
            enableHtmlRendering: storedSet.enableHtmlRendering ?? DEFAULT_SETTINGS.enableHtmlRendering,
            enableScriptExecution: storedSet.enableScriptExecution ?? DEFAULT_SETTINGS.enableScriptExecution,
            savedPresets: mergedSavedPresets,
            expressionTriggers: storedSet.expressionTriggers || DEFAULT_SETTINGS.expressionTriggers,
            hasInjectedFormatPreset: true,
            variables: storedSet.variables || {},
            extensionSettings: storedSet.extensionSettings || {},
            hasInitializedDefaultCharacters: storedSet.hasInitializedDefaultCharacters ?? false,
            chatBackgroundBlur: storedSet.chatBackgroundBlur ?? DEFAULT_SETTINGS.chatBackgroundBlur,
            chatBackgroundDim: storedSet.chatBackgroundDim ?? DEFAULT_SETTINGS.chatBackgroundDim,
            enableChatBgAnimation: storedSet.enableChatBgAnimation ?? DEFAULT_SETTINGS.enableChatBgAnimation,
            savedApiProfiles: storedSet.savedApiProfiles || DEFAULT_SETTINGS.savedApiProfiles,
            currentApiProfileId: storedSet.currentApiProfileId || DEFAULT_SETTINGS.currentApiProfileId,
            globalRegexScripts: storedSet.globalRegexScripts || DEFAULT_SETTINGS.globalRegexScripts || [],
            presetRegexScripts: storedSet.presetRegexScripts || DEFAULT_SETTINGS.presetRegexScripts || [],
            enableEmotionAmbientGlow: storedSet.enableEmotionAmbientGlow ?? DEFAULT_SETTINGS.enableEmotionAmbientGlow,
            enableReplySuggestions: storedSet.enableReplySuggestions ?? DEFAULT_SETTINGS.enableReplySuggestions,
            replySuggestionsClickMode: storedSet.replySuggestionsClickMode ?? DEFAULT_SETTINGS.replySuggestionsClickMode,
            enableBisonMode: storedSet.enableBisonMode ?? DEFAULT_SETTINGS.enableBisonMode,
            replySuggestionsPrompt: (() => {
              const stored = storedSet.replySuggestionsPrompt;
              if (!stored || !stored.includes("【叙事分支生成器】")) {
                needSave = true;
                return DEFAULT_REPLY_SUGGESTIONS_PROMPT;
              }
              return stored;
            })(),
            bisonModePrompt: (() => {
              const stored = storedSet.bisonModePrompt;
              if (!stored || stored.includes("野牛模式连续输出指令：")) {
                needSave = true;
                return DEFAULT_BISON_MODE_PROMPT;
              }
              return stored;
            })(),
            enableMultiMessageQueue: storedSet.enableMultiMessageQueue ?? DEFAULT_SETTINGS.enableMultiMessageQueue,
            enableAsteriskFormatting: storedSet.enableAsteriskFormatting ?? DEFAULT_SETTINGS.enableAsteriskFormatting,
          } as any;

          if (externalPreset) {
            needSave = true;
          }

          setSettings(mergedSet);

          if (needSavePresets) {
            await saveStoredSavedPresets(mergedSavedPresets);
          }
          if (needSave) {
            const cleanSet = { ...mergedSet };
            delete cleanSet.savedPresets;
            await saveStoredSettings(cleanSet);
          }
        } else {
          // 全新安装/首次运行（storedSet 为空），默认把初始化的预设组合包写入数据库并持久化设置
          let initialSet = { ...DEFAULT_SETTINGS };
          if (externalPreset) {
            initialSet.promptConfig = {
              ...initialSet.promptConfig,
              ...externalPreset.promptConfig,
            };
            if (externalPreset.memory) {
              initialSet.memory = {
                ...initialSet.memory,
                ...externalPreset.memory,
              };
            }
            if (externalPreset.basicPresetBundle) {
              setMobileTavernBasicPresetBundle({
                ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
                promptConfig: {
                  ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig,
                  ...externalPreset.basicPresetBundle.promptConfig,
                }
              });
              initialSet.preset = MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset;
              initialSet.promptConfig = {
                ...initialSet.promptConfig,
                ...MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig,
              };
              initialSet.savedPresets = [MOBILE_TAVERN_BASIC_PRESET_BUNDLE];
            }
            if (externalPreset.formatPreservationBundle) {
              setFormatPreservationBundle({
                ...FORMAT_PRESERVATION_BUNDLE,
                promptConfig: {
                  ...FORMAT_PRESERVATION_BUNDLE.promptConfig,
                  ...externalPreset.formatPreservationBundle.promptConfig,
                }
              });
            }
          }
          setSettings(initialSet);

          try {
            await saveStoredSavedPresets(initialSet.savedPresets || []);
            const cleanSet = { ...initialSet };
            delete cleanSet.savedPresets;
            await saveStoredSettings(cleanSet);
          } catch (e) {
            console.error("Failed to initialize saved presets for new user:", e);
          }
        }
        if (storedLores) {
          setGlobalLorebook(storedLores.map(cleanLorebookEntry));
        }
        if (storedWorldbooks) {
          setCustomWorldbooks(storedWorldbooks);
        }
        setIsReady(true);
      } catch (err) {
        console.error("Failed to load settings from DB:", err);
      }
    };
    loadSettings();
  }, []);
};
