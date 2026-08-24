import {
  cleanTavernHelperBridge,
  createMessageIframeSrcDoc as createSillyTavernMessageIframeSrcDoc,
  createScriptIframeSrcDoc as createSillyTavernScriptIframeSrcDoc,
  getBridgeParams,
  hasCardScripts,
  initTavernHelperBridge,
  initTavernHelperMocks,
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
import { parsePromptComposition } from "../../domain/prompt-composition";
import type { CharacterCard, ChatSession } from "../../types";
import {
  SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
  type CompatibilityBackgroundScript,
  type CompatibilityRendererDefinition,
  type ICompatibilityRuntimeService,
} from "../compatibility/contracts";
import { formatMvuVariablesForPrompt } from "../services/prompt/PromptMacroFormatter";
import { registerRuntimeCapabilities } from "../bootstrap/capabilityRegistry";
import { KernelServices } from "../serviceContracts";
import type { RuntimePluginDefinition } from "./contracts";

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
  areRuntimeLibrariesReady() {
    if (typeof window === "undefined") return false;
    const compatibilityWindow = window as SillyTavernCompatibilityWindow;
    return Boolean(compatibilityWindow._ && compatibilityWindow.TavernHelperMvuLibs?.defineStore);
  },
  hasCardScripts,
  listBackgroundScripts: readBackgroundScripts,
  createScriptIframeSrcDoc: createSillyTavernScriptIframeSrcDoc,
  createMessageIframeSrcDoc(content, messageId, loopProtection) {
    if (content.includes("window.__TH_MESSAGE_ID")) return content;
    return createSillyTavernMessageIframeSrcDoc(content, messageId, loopProtection);
  },
  initializeBridge: initTavernHelperBridge,
  updateBridge(update) {
    const params = getBridgeParams();
    if (!params) return;
    Object.assign(params, update);
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
    try {
      cleanTavernHelperBridge();
    } catch {
      // 尚未绑定运行 Kernel 时事件总线为空，无需阻断 Profile 卸载。
    }
    renderer.setGenerationState({ isSending: false, streamingMessageId: null });
  },
};

/** 受信 SillyTavern Compatibility Runtime；与用户安装的沙箱插件物理分离。 */
export const sillyTavernCompatibilityRuntimePlugin: RuntimePluginDefinition = {
  id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
  version: CONTRIBUTION_VERSION,
  requires: ["mobile-tavern.legacy-runtime"],
  validateConfig(config: unknown): void {
    if (config !== undefined) throw new Error("SILLY_TAVERN_COMPATIBILITY_CONFIG_UNSUPPORTED");
  },
  setup({ kernel, scope }): void {
    const runtime = kernel.getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime);
    scope.add(registerRuntimeCapabilities(kernel, [{
      id: "compat.sillytavern",
      kind: "compatibility",
      providedBy: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
      permissions: [],
      lifecycle: "lazy",
    }]));
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
    scope.add(runtime.registerContextSource({
      id: "compat.sillytavern.context.mvu-state",
      version: CONTRIBUTION_VERSION,
      read: readNamespacedState,
    }));
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
    scope.add(runtime.registerStateReducer({
      id: "compat.sillytavern.state.mvu",
      version: CONTRIBUTION_VERSION,
      initialize: initializeMvuFromCharacter,
      reduce: ({ text, currentState, signal }) => parseMvuMessage(text, currentState, signal),
      notify: notifyVariablesUpdated,
    }));
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
    scope.add(runtime.registerRenderer(renderer));
  },
};

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
