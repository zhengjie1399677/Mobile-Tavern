import {
  cleanTavernHelperBridge,
  cleanIsolatedBridgeHost,
  createIsolatedMessageIframeSrcDoc,
  createIsolatedScriptIframeSrcDoc,
  createMessageIframeSrcDoc as createSillyTavernMessageIframeSrcDoc,
  createScriptIframeSrcDoc as createSillyTavernScriptIframeSrcDoc,
  getBridgeParams,
  hasCardScripts,
  initTavernHelperBridge,
  initTavernHelperMocks,
  initIsolatedBridgeHost,
  initializeMvuFromCharacter,
  notifyVariablesUpdated,
  parseMvuMessage,
} from "../../compatibility/sillytavern";
import { applyCharacterRegexScripts } from "../../compatibility/sillytavern/mvuParser";
import {
  analyzeSillyTavernPreset,
  exportSillyTavernComposition,
  importSillyTavernPreset,
} from "../../infrastructure/compat/sillytavern";
import { z } from "zod";
import { parsePromptComposition } from "../../domain/prompt-composition";
import type { CharacterCard, ChatSession } from "../../types";
import {
  SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
  type CompatibilityBackgroundScript,
  type CompatibilityBridgeParams,
  type CompatibilityRendererDefinition,
  type CompatibilityStateUpdater,
  type ICompatibilityRuntimeService,
} from "../compatibility/contracts";
import { formatMvuVariablesForPrompt } from "../services/prompt/PromptMacroFormatter";
import { registerRuntimeCapabilities } from "../bootstrap/capabilityRegistry";
import { KernelServices } from "../serviceContracts";
import { defineRuntimePlugin } from "./contracts";
import {
  COMPATIBILITY_CODEC_CAPABILITY,
  COMPATIBILITY_CONTEXT_SOURCE_CAPABILITY,
  COMPATIBILITY_PROMPT_SECTION_CAPABILITY,
  COMPATIBILITY_RENDERER_CAPABILITY,
  COMPATIBILITY_STATE_REDUCER_CAPABILITY,
  COMPATIBILITY_TRANSFORM_CAPABILITY,
} from "./capabilityCatalog";
import { contributeRuntimeCapability } from "./capabilityTokens";

const CONTRIBUTION_VERSION = "1.0.0";
const STATE_NAMESPACE = SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID;

interface SillyTavernCompatibilityWindow extends Window {
  _?: unknown;
  TavernHelperMvuLibs?: { defineStore?: unknown };
  TavernHelperIsSending?: boolean;
  TavernHelperStreamingMessageId?: string | null;
}

const renderer: CompatibilityRendererDefinition = {
  id: "compat.sillytavern.renderer",
  version: CONTRIBUTION_VERSION,
  initializeGlobals: initTavernHelperMocks,
  areRuntimeLibrariesReady(securityMode) {
    if (securityMode === "isolated") return true;
    if (typeof window === "undefined") return false;
    const compatibilityWindow = window as SillyTavernCompatibilityWindow;
    return Boolean(compatibilityWindow._ && compatibilityWindow.TavernHelperMvuLibs?.defineStore);
  },
  hasCardScripts,
  listBackgroundScripts: readBackgroundScripts,
  getIframePolicy(securityMode) {
    return securityMode === "trusted"
      ? {
          isolated: false,
          sandbox: "allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox",
        }
      : { isolated: true, sandbox: "allow-scripts" };
  },
  createScriptIframeSrcDoc(content, scriptId, loopProtection, securityMode) {
    if (securityMode === "trusted") {
      return createSillyTavernScriptIframeSrcDoc(content, scriptId, loopProtection);
    }
    return createIsolatedScriptIframeSrcDoc(
      content,
      scriptId,
      getBridgeParams()?.activeSession?.variables,
      loopProtection,
    );
  },
  createMessageIframeSrcDoc(content, messageId, loopProtection, securityMode) {
    if (securityMode === "trusted") {
      if (content.includes("window.__TH_MESSAGE_ID")) return content;
      return createSillyTavernMessageIframeSrcDoc(content, messageId, loopProtection);
    }
    return createIsolatedMessageIframeSrcDoc(
      content,
      messageId,
      getBridgeParams()?.activeSession?.variables,
    );
  },
  initializeBridge(params) {
    initTavernHelperBridge(adaptBridgeParams(params));
    initIsolatedBridgeHost();
  },
  updateBridge(update) {
    const params = getBridgeParams();
    if (!params) return;
    Object.assign(params, {
      ...update,
      activeSession: update.activeSession === undefined
        ? params.activeSession
        : projectSessionForLegacyBridge(update.activeSession),
    });
  },
  getBridgeParams,
  getGenerationState() {
    if (typeof window === "undefined") {
      return { isSending: false, streamingMessageId: null };
    }
    const compatibilityWindow = window as SillyTavernCompatibilityWindow;
    return {
      isSending: compatibilityWindow.TavernHelperIsSending === true,
      streamingMessageId: compatibilityWindow.TavernHelperStreamingMessageId ?? null,
    };
  },
  setGenerationState(update) {
    if (typeof window === "undefined") return;
    const compatibilityWindow = window as SillyTavernCompatibilityWindow;
    if (update.isSending !== undefined) {
      compatibilityWindow.TavernHelperIsSending = update.isSending;
    }
    if (update.streamingMessageId !== undefined) {
      compatibilityWindow.TavernHelperStreamingMessageId = update.streamingMessageId;
    }
  },
  cleanBridge() {
    cleanIsolatedBridgeHost();
    try {
      cleanTavernHelperBridge();
    } catch {
      // 尚未绑定运行 Kernel 时事件总线为空，无需阻断 Profile 卸载。
    }
    renderer.setGenerationState({ isSending: false, streamingMessageId: null });
  },
};

/** 受信 SillyTavern Compatibility Runtime；与用户安装的沙箱插件物理分离。 */
export const sillyTavernCompatibilityRuntimePlugin = defineRuntimePlugin({
  id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
  version: CONTRIBUTION_VERSION,
  requires: ["mobile-tavern.legacy-runtime"],
  configSchema: z.undefined(),
  capabilitySlots: [
    COMPATIBILITY_CODEC_CAPABILITY,
    COMPATIBILITY_PROMPT_SECTION_CAPABILITY,
    COMPATIBILITY_CONTEXT_SOURCE_CAPABILITY,
    COMPATIBILITY_TRANSFORM_CAPABILITY,
    COMPATIBILITY_STATE_REDUCER_CAPABILITY,
    COMPATIBILITY_RENDERER_CAPABILITY,
  ],
  capabilities: [
    contributeRuntimeCapability(
      COMPATIBILITY_CODEC_CAPABILITY,
      "compat.sillytavern.codec.prompt-preset",
    ),
    contributeRuntimeCapability(
      COMPATIBILITY_PROMPT_SECTION_CAPABILITY,
      "compat.sillytavern.prompt.mvu-state",
    ),
    contributeRuntimeCapability(
      COMPATIBILITY_CONTEXT_SOURCE_CAPABILITY,
      "compat.sillytavern.context.mvu-state",
    ),
    contributeRuntimeCapability(
      COMPATIBILITY_TRANSFORM_CAPABILITY,
      "compat.sillytavern.transform.regex",
    ),
    contributeRuntimeCapability(
      COMPATIBILITY_STATE_REDUCER_CAPABILITY,
      "compat.sillytavern.state.mvu",
    ),
    contributeRuntimeCapability(
      COMPATIBILITY_RENDERER_CAPABILITY,
      "compat.sillytavern.renderer",
    ),
  ],
  setup({ kernel, scope, profile }): void {
    const runtime = kernel.getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime);
    scope.add(registerRuntimeCapabilities(kernel, [{
      id: "compat.sillytavern",
      kind: "compatibility",
      providedBy: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
      permissions: [],
      lifecycle: "lazy",
    }]));
    if (isContributionEnabled(profile, "compat.codec", "compat.sillytavern.codec.prompt-preset")) {
      scope.add(runtime.registerCodec({
      id: "compat.sillytavern.codec.prompt-preset",
      version: CONTRIBUTION_VERSION,
      format: "sillytavern.prompt-preset",
      canDecode(input) {
        return analyzeSillyTavernPreset(input).level !== "invalid";
      },
      analyze: analyzeSillyTavernPreset,
      decode: importSillyTavernPreset,
      encode(input) {
        return exportSillyTavernComposition(parsePromptComposition(input));
      },
      }));
    }
    if (isContributionEnabled(profile, "compat.context-source", "compat.sillytavern.context.mvu-state")) {
      scope.add(runtime.registerContextSource({
      id: "compat.sillytavern.context.mvu-state",
      version: CONTRIBUTION_VERSION,
      read: readNamespacedState,
      }));
    }
    if (isContributionEnabled(profile, "compat.transform", "compat.sillytavern.transform.regex")) {
      scope.add(runtime.registerTransform({
      id: "compat.sillytavern.transform.regex",
      version: CONTRIBUTION_VERSION,
      transform(request) {
        if (!request.character) return request.text;
        return applyCharacterRegexScripts(
          request.text,
          request.character,
          request.isAiMessage,
          request.charName,
          request.userName,
          request.mode === "display" ? "render" : request.mode,
          request.signal,
        );
      },
      }));
    }
    if (isContributionEnabled(profile, "compat.state-reducer", "compat.sillytavern.state.mvu")) {
      scope.add(runtime.registerStateReducer({
      id: "compat.sillytavern.state.mvu",
      version: CONTRIBUTION_VERSION,
      initialize: initializeMvuFromCharacter,
      reduce: ({ text, currentState, signal }) => parseMvuMessage(text, currentState, signal),
      read: readNamespacedState,
      write: writeNamespacedState,
      notify(session, messageId) {
        notifyVariablesUpdated(projectSessionForLegacyBridge(session)!, messageId);
      },
      }));
    }
    if (isContributionEnabled(profile, "compat.prompt-section", "compat.sillytavern.prompt.mvu-state")) {
      scope.add(runtime.registerPromptSection({
      id: "compat.sillytavern.prompt.mvu-state",
      version: CONTRIBUTION_VERSION,
      build({ character, chat, settings, hasVariableListEntry }) {
        if (!settings.enableScriptExecution || !hasCardScripts(character) || hasVariableListEntry) {
          return [];
        }
        const content = formatMvuVariablesForPrompt(readNamespacedState(chat), character);
        return content ? [{
          id: "mvu_variables",
          phase: "Context",
          type: "Context",
          priority: "High",
          mutable: true,
          title: "Variables State",
          content,
        }] : [];
      },
      }));
    }
    if (isContributionEnabled(profile, "compat.renderer", renderer.id)) {
      scope.add(runtime.registerRenderer(renderer));
    }
  },
});

function isContributionEnabled(
  profile: { readonly contributionOrder: Readonly<Record<string, readonly string[]>> },
  slotId: string,
  contributionId: string,
): boolean {
  return profile.contributionOrder[slotId]?.includes(contributionId) === true;
}

function readNamespacedState(session: ChatSession): Record<string, unknown> {
  const namespaced = session.runtimePluginState?.[STATE_NAMESPACE];
  if (namespaced && typeof namespaced === "object" && !Array.isArray(namespaced)) {
    return namespaced as Record<string, unknown>;
  }
  const legacy = session.variables;
  return legacy && typeof legacy === "object" && !Array.isArray(legacy)
    ? legacy as Record<string, unknown>
    : {};
}

function writeNamespacedState(
  session: ChatSession,
  state: Record<string, unknown>,
): ChatSession {
  return {
    ...session,
    variables: undefined,
    runtimePluginState: {
      ...session.runtimePluginState,
      [STATE_NAMESPACE]: structuredClone(state),
    },
  };
}

function projectSessionForLegacyBridge(session: ChatSession | null): ChatSession | null {
  if (!session) return null;
  return {
    ...session,
    variables: structuredClone(readNamespacedState(session)),
  };
}

function normalizeSessionFromLegacyBridge(session: ChatSession): ChatSession {
  const state = session.variables;
  return state && typeof state === "object" && !Array.isArray(state)
    ? writeNamespacedState(session, state as Record<string, unknown>)
    : { ...session, variables: undefined };
}

function adaptBridgeParams(params: CompatibilityBridgeParams): CompatibilityBridgeParams {
  return {
    ...params,
    activeSession: projectSessionForLegacyBridge(params.activeSession),
    setSessions(update: CompatibilityStateUpdater<ChatSession[]>) {
      params.setSessions((previous) => {
        const projected = previous.map((session) => projectSessionForLegacyBridge(session)!);
        const next = typeof update === "function" ? update(projected) : update;
        return next.map(normalizeSessionFromLegacyBridge);
      });
    },
    saveSession(session) {
      return params.saveSession(normalizeSessionFromLegacyBridge(session));
    },
  };
}

function readBackgroundScripts(character: CharacterCard | null): CompatibilityBackgroundScript[] {
  const scripts = character?.extensions?.tavern_helper?.scripts;
  if (!Array.isArray(scripts)) return [];
  return scripts.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const script = item as Record<string, unknown>;
    if (typeof script.content !== "string" || !script.content) return [];
    return [{
      id: typeof script.id === "string" && script.id ? script.id : `script-${index}`,
      name: typeof script.name === "string" && script.name ? script.name : "unnamed",
      content: script.content,
      enabled: script.enabled !== false,
    }];
  });
}
