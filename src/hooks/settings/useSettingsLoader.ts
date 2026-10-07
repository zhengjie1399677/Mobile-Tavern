import type * as React from "react";
import { useEffect } from "react";
import { UserSettings, LorebookEntry, CustomWorldbook } from "../../types";
import type { PresetBundleV2 } from "../../domain/presets/contracts";
import {
  readExternalPresetDefaults,
  resolvePresetBootstrap,
  type ExternalPresetDefaults,
  type PresetBootstrapFactoryDefaults,
} from "../../application/useCases/presetBootstrap";
import { withoutPresetOwnedSettings } from "../../application/useCases/presetSettingsBoundary";
import { resolveActivePresetBundle } from "../../application/useCases/presetBundleLifecycle";
import { useKernel } from "../../contexts/KernelContext";
import {
  ISettingsService,
  IPresetService,
  IWorldbookService,
  KernelServices,
  type IExternalSourceRuntimeService,
} from "@/src/application/serviceContracts";
import {
  DEFAULT_REPLY_SUGGESTIONS_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
  DEFAULT_BISON_MODE_PROMPT,
  DEFAULT_SUMMARY_SYSTEM_PROMPT,
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
  MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
} from "./defaults";
import { cleanLorebookEntry } from "./mergeUtils";
import {
  isReasoningStrength,
  normalizeReasoningStrength,
} from "../../application/services/llmCompatibility";
import { setExternalCapabilitiesEnabled } from "../../application/externalSources/externalCapabilityGate";

interface UseSettingsLoaderDeps {
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  setCustomWorldbooks: React.Dispatch<React.SetStateAction<Record<string, CustomWorldbook>>>;
  setIsReady: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * 预设引导需要的出厂常量。
 *
 * 显式注入而不是由用例反向 import `hooks/settings/defaults`，以保持 application 不依赖
 * 界面层默认值（`ARCH-FLOW`）。
 */
const PRESET_BOOTSTRAP_FACTORY: PresetBootstrapFactoryDefaults = {
  promptConfig: DEFAULT_PROMPT_CONFIG,
  settingsPromptConfig: DEFAULT_SETTINGS.promptConfig,
  tableMemoryPrompt: DEFAULT_TABLE_MEMORY_PROMPT,
};

/** 拉取并收口外部静态预设文件；失败时保持出厂常量，不阻塞启动。 */
async function fetchExternalPresetDefaults(): Promise<ExternalPresetDefaults | null> {
  try {
    const res = await fetch("/default_presets.json");
    if (!res.ok) return null;
    return readExternalPresetDefaults(await res.json());
  } catch (fetchErr) {
    console.warn("[useSettings] Failed to fetch external default presets:", fetchErr);
    return null;
  }
}

/**
 * 设置加载与预设注入迁移子 Hook。
 *
 * 预设职责（外部静态文件、内置预设重建、旧键与出厂内容迁移、活跃 Prompt 形状）已收口到
 * `application/useCases/presetBootstrap`；本 Hook 只负责读取服务、调用用例、写回结果，
 * 以及合并人设、API、记忆、主题等非预设字段。仅在挂载时执行一次。
 */
export const useSettingsLoader = ({
  setSettings,
  setGlobalLorebook,
  setCustomWorldbooks,
  setIsReady,
}: UseSettingsLoaderDeps) => {
  const kernel = useKernel();
  const settingsService = kernel.getService<ISettingsService<UserSettings>>("settings");
  const presetService = kernel.getService<IPresetService<PresetBundleV2>>("preset");
  const worldbookService = kernel.getService<IWorldbookService<LorebookEntry, CustomWorldbook>>("worldbook");

  // Load Settings and Lorebook from local DB
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storedSet = await settingsService.getStoredSettings();
        const storedSavedPresets = await presetService.getStoredSavedPresets();
        const storedLores = await worldbookService.getGlobalLorebook();
        const storedWorldbooks = await worldbookService.getCustomWorldbooks();

        // 💡 核心安全策略：只有数据库完全无设置记录（首次运行）时，才从外部静态 JSON 文件拉取出厂初始化配置。
        // 已有设置记录时（即使预设自身没有根级 mainPrompt），严禁强制拉取外部默认配置覆盖用户预设。
        const externalDefaults =
          !storedSet || !storedSet.promptConfig
            ? await fetchExternalPresetDefaults()
            : null;

        const bootstrap = resolvePresetBootstrap({
          storedSettings: storedSet ?? null,
          storedPresets: storedSavedPresets,
          externalDefaults,
          compiledBuiltin: MOBILE_TAVERN_BASIC_PRESET_BUNDLE,
          factory: PRESET_BOOTSTRAP_FACTORY,
        });

        if (storedSet) {
          let needSave = bootstrap.settingsDirty;

          const personas = storedSet.userPersonas && storedSet.userPersonas.length > 0
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
          if (!personas.some((p) => p.id === activeId)) {
            activeId = personas[0].id;
          }

          // 强制同步活跃人设的名称、头像、背景到全局属性，确保完全一致
          const activeIdx = personas.findIndex((p) => p.id === activeId);
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

          const defaultMemory = externalDefaults?.memory
            ? { ...DEFAULT_SETTINGS.memory, ...externalDefaults.memory }
            : DEFAULT_SETTINGS.memory;

          // CHANGE-SAFE：旧数据只有布尔 disableReasoning，迁移为统一强度档位（true → off）后写回。
          const storedReasoningStrength = normalizeReasoningStrength({
            reasoningStrength: storedSet.api?.reasoningStrength,
            disableReasoning: storedSet.api?.disableReasoning,
          });
          if (storedSet.api && storedSet.api.reasoningStrength === undefined) {
            needSave = true;
          }

          const resolvedPreset = { ...DEFAULT_SETTINGS.preset, ...(storedSet.preset || {}) };
          const activeBundleCandidate = resolveActivePresetBundle(bootstrap.savedPresets, resolvedPreset);
          if (
            activeBundleCandidate &&
            (resolvedPreset.id === "custom" || !bootstrap.savedPresets.some((b) => b.sampler.id === resolvedPreset.id))
          ) {
            resolvedPreset.id = activeBundleCandidate.sampler.id;
            resolvedPreset.name = activeBundleCandidate.sampler.name;
            needSave = true;
          }

          // CHANGE-SAFE：预设正则字段在旧版本设置里根本不存在（老预设导入早于该字段）。
          // 只在字段缺失时从活跃预设包回填，用户主动清空的空数组不会被复活。
          const storedPresetRegexScripts = storedSet.presetRegexScripts;
          const resolvedPresetRegexScripts = Array.isArray(storedPresetRegexScripts)
            ? storedPresetRegexScripts
            : activeBundleCandidate?.regexScripts?.length
              ? [...activeBundleCandidate.regexScripts]
              : DEFAULT_SETTINGS.presetRegexScripts || [];
          if (!Array.isArray(storedPresetRegexScripts) && activeBundleCandidate?.regexScripts?.length) {
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
              reasoningStrength: storedReasoningStrength,
              forceBasicParams: storedSet.api?.forceBasicParams ?? DEFAULT_SETTINGS.api.forceBasicParams,
            },
            preset: resolvedPreset,
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
            // 活跃 Prompt 配置由预设引导用例给出：外部文件收口、旧出厂提示词升级、
            // 出厂区块迁移与内置预设回填都在那里完成（`COMPAT-DATA`：只作用于内置预设）。
            promptConfig: bootstrap.promptConfig,
            userName: finalUserName,
            userInfo: finalUserInfo,
            userAvatar: finalUserAvatar,
            userPersonas: personas,
            activePersonaId: activeId,
            globalChatBg: storedSet.globalChatBg || DEFAULT_SETTINGS.globalChatBg,
            enableHtmlRendering: storedSet.enableHtmlRendering ?? DEFAULT_SETTINGS.enableHtmlRendering,
            enableScriptExecution: storedSet.enableScriptExecution ?? DEFAULT_SETTINGS.enableScriptExecution,
            // 外部能力（MCP）默认关闭：默认值缺失或旧数据一律降级为关闭，用户在工作台显式打开。
            enableExternalCapabilities: storedSet.enableExternalCapabilities
              ?? DEFAULT_SETTINGS.enableExternalCapabilities
              ?? false,
            // CHANGE-SAFE：旧版本只有 enableScriptExecution。已开启脚本的旧用户迁移到
            // trusted 以避免现有 MVU 卡静默失效；新用户与未开启脚本的旧数据默认 isolated。
            scriptSecurityMode: storedSet.scriptSecurityMode
              ?? (storedSet.enableScriptExecution === true ? "trusted" : "isolated"),
            enableLoopProtection: storedSet.enableLoopProtection ?? DEFAULT_SETTINGS.enableLoopProtection,
            savedPresets: bootstrap.savedPresets,
            presetFactoryRevision: bootstrap.presetFactoryRevision,
            expressionTriggers: storedSet.expressionTriggers || DEFAULT_SETTINGS.expressionTriggers,
            hasInjectedFormatPreset: true,
            variables: storedSet.variables || {},
            extensionSettings: storedSet.extensionSettings || {},
            hasInitializedDefaultCharacters: storedSet.hasInitializedDefaultCharacters ?? false,
            chatBackgroundBlur: storedSet.chatBackgroundBlur ?? DEFAULT_SETTINGS.chatBackgroundBlur,
            chatBackgroundDim: storedSet.chatBackgroundDim ?? DEFAULT_SETTINGS.chatBackgroundDim,
            enableChatBgAnimation: storedSet.enableChatBgAnimation ?? DEFAULT_SETTINGS.enableChatBgAnimation,
            savedApiProfiles: (storedSet.savedApiProfiles || DEFAULT_SETTINGS.savedApiProfiles || []).map(
              (profile) => {
                if (isReasoningStrength(profile.reasoningStrength)) return profile;
                needSave = true;
                return {
                  ...profile,
                  reasoningStrength: normalizeReasoningStrength({
                    disableReasoning: profile.disableReasoning,
                  }),
                };
              }
            ),
            currentApiProfileId: storedSet.currentApiProfileId || DEFAULT_SETTINGS.currentApiProfileId,
            globalRegexScripts: storedSet.globalRegexScripts || DEFAULT_SETTINGS.globalRegexScripts || [],
            presetRegexScripts: resolvedPresetRegexScripts,
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
            chatFontSize: storedSet.chatFontSize ?? DEFAULT_SETTINGS.chatFontSize,
            chatLineHeight: storedSet.chatLineHeight ?? DEFAULT_SETTINGS.chatLineHeight,
            uiDensity: storedSet.uiDensity === "accessible" ? "accessible" : "compact",
            customThemes: Array.isArray(storedSet.customThemes) ? storedSet.customThemes : DEFAULT_SETTINGS.customThemes,
            hiddenMainTabs: Array.isArray(storedSet.hiddenMainTabs) ? storedSet.hiddenMainTabs : DEFAULT_SETTINGS.hiddenMainTabs,
            // 工作台布局：形状宽松校验，非法值回落出厂顺序（解析层还会忽略未知卡片 id）。
            workbenchCardLayout: (() => {
              const layout = storedSet.workbenchCardLayout;
              if (!layout || typeof layout !== "object") {
                return DEFAULT_SETTINGS.workbenchCardLayout;
              }
              return {
                order: Array.isArray(layout.order)
                  ? layout.order.filter((id): id is string => typeof id === "string")
                  : undefined,
                hidden: Array.isArray(layout.hidden)
                  ? layout.hidden.filter((id): id is string => typeof id === "string")
                  : undefined,
              };
            })(),
            themeMediaEnabled: storedSet.themeMediaEnabled ?? DEFAULT_SETTINGS.themeMediaEnabled,
            imageGenApi: {
              ...DEFAULT_SETTINGS.imageGenApi,
              ...(storedSet.imageGenApi || {}),
            },
            enableFloatingCharacter: storedSet.enableFloatingCharacter ?? DEFAULT_SETTINGS.enableFloatingCharacter,
            hostBinding: {
              // 逐字段合并：旧版本没有 hostBinding，缺字段一律回落到默认值。
              ...(DEFAULT_SETTINGS.hostBinding ?? {}),
              ...(storedSet.hostBinding ?? {}),
            },
          } as UserSettings;

          setSettings(mergedSet);

          // 外部能力总开关：设置加载完成后把门禁位同步给运行时；
          // 开启时补一次 reload（服务启动时因默认关而跳过连接），关闭时保持断开。
          setExternalCapabilitiesEnabled(mergedSet.enableExternalCapabilities === true);
          if (
            mergedSet.enableExternalCapabilities === true
            && kernel.hasService(KernelServices.ExternalSources)
          ) {
            void kernel
              .getService<IExternalSourceRuntimeService>(KernelServices.ExternalSources)
              .reload();
          }

          if (bootstrap.presetsDirty) {
            await presetService.saveStoredSavedPresets(bootstrap.savedPresets);
          }
          if (needSave) {
            await settingsService.saveStoredSettings(withoutPresetOwnedSettings(mergedSet));
          }
        } else {
          // 全新安装/首次运行（storedSet 为空），默认把初始化的预设组合包写入数据库并持久化设置
          const initialSet: UserSettings = {
            ...DEFAULT_SETTINGS,
            promptConfig: bootstrap.promptConfig,
            savedPresets: bootstrap.savedPresets,
            presetFactoryRevision: bootstrap.presetFactoryRevision,
          };
          if (externalDefaults?.memory) {
            initialSet.memory = {
              ...initialSet.memory,
              ...externalDefaults.memory,
            };
          }
          setSettings(initialSet);

          try {
            await presetService.saveStoredSavedPresets(bootstrap.savedPresets);
            await settingsService.saveStoredSettings(withoutPresetOwnedSettings(initialSet));
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
