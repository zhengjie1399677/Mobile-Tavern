import type { EffectDisposer, IKernelService } from "../../kernel/types";
import type {
  CharacterCard,
  ChatSession,
  CompatibilityScriptSecurityMode,
  UserSettings,
} from "../../types";
import type { PromptNode } from "../services/prompt/types";

export const SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID = "mobile-tavern.sillytavern-compat";

export type CompatibilityTransformMode = "display" | "prompt" | "store";

export interface CompatibilityTransformRequest {
  readonly text: string;
  readonly character: CharacterCard | null;
  readonly mode: CompatibilityTransformMode;
  readonly isAiMessage?: boolean;
  readonly charName?: string;
  readonly userName?: string;
  readonly signal?: AbortSignal;
  readonly globalRegexScripts?: readonly unknown[];
  readonly presetRegexScripts?: readonly unknown[];
  readonly messageIndex?: number;
  readonly enableLoopProtection?: boolean;
  readonly isStreamingLastMessage?: boolean;
}

export interface CompatibilityTransformDefinition {
  readonly id: string;
  readonly version: string;
  transform(request: CompatibilityTransformRequest): string;
}

export interface CompatibilityStateReducerDefinition {
  readonly id: string;
  readonly version: string;
  initialize(character: CharacterCard | null): Record<string, unknown>;
  reduce(request: {
    readonly text: string;
    readonly currentState: Record<string, unknown>;
    readonly signal?: AbortSignal;
  }): Record<string, unknown>;
  read(session: ChatSession): Record<string, unknown>;
  write(session: ChatSession, state: Record<string, unknown>): ChatSession;
  notify(session: ChatSession, messageId?: number): void;
}

export interface CompatibilityPromptSectionRequest {
  readonly character: CharacterCard;
  readonly chat: ChatSession;
  readonly settings: UserSettings;
  readonly hasVariableListEntry: boolean;
}

export interface CompatibilityPromptSectionDefinition {
  readonly id: string;
  readonly version: string;
  build(request: CompatibilityPromptSectionRequest): readonly PromptNode[];
}

export interface CompatibilityContextSourceDefinition {
  readonly id: string;
  readonly version: string;
  read(session: ChatSession): unknown;
}

export interface CompatibilityCodecDefinition {
  readonly id: string;
  readonly version: string;
  readonly format: string;
  canDecode(input: unknown): boolean;
  analyze?(input: unknown): unknown;
  decode(input: unknown): unknown;
  encode(input: unknown): unknown;
}

export interface CompatibilityBackgroundScript {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly enabled: boolean;
}

export type CompatibilityStateUpdater<TValue> =
  TValue | ((previous: TValue) => TValue);

export interface CompatibilityBridgeParams {
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
  setSessions(update: CompatibilityStateUpdater<ChatSession[]>): void;
  saveSession(session: ChatSession): Promise<void>;
  setCharacters(update: CompatibilityStateUpdater<CharacterCard[]>): void;
  saveCharacter(character: CharacterCard): Promise<void>;
  settings: UserSettings;
  updateSettings(update: CompatibilityStateUpdater<UserSettings>): void;
  handleSendMessage(text: string): Promise<void>;
}

export interface CompatibilityGenerationState {
  readonly isSending: boolean;
  readonly streamingMessageId: string | null;
}

export interface CompatibilityIframePolicy {
  readonly isolated: boolean;
  readonly sandbox: string;
}

export type CompatibilityGenerationStateUpdate = Partial<CompatibilityGenerationState>;

export interface CompatibilityRendererDefinition {
  readonly id: string;
  readonly version: string;
  initializeGlobals(): void;
  areRuntimeLibrariesReady(securityMode: CompatibilityScriptSecurityMode): boolean;
  hasCardScripts(character: CharacterCard | null): boolean;
  listBackgroundScripts(character: CharacterCard | null): CompatibilityBackgroundScript[];
  getIframePolicy(securityMode: CompatibilityScriptSecurityMode): CompatibilityIframePolicy;
  createScriptIframeSrcDoc(
    content: string,
    scriptId: string,
    loopProtection: boolean,
    securityMode: CompatibilityScriptSecurityMode,
  ): string;
  createMessageIframeSrcDoc(
    content: string,
    messageId: number | undefined,
    loopProtection: boolean,
    securityMode: CompatibilityScriptSecurityMode,
  ): string;
  initializeBridge(params: CompatibilityBridgeParams): void;
  updateBridge(params: Partial<Pick<CompatibilityBridgeParams, "activeCharacter" | "activeSession" | "settings">>): void;
  getBridgeParams(): CompatibilityBridgeParams | null;
  getGenerationState(): CompatibilityGenerationState;
  setGenerationState(update: CompatibilityGenerationStateUpdate): void;
  cleanBridge(): void;
}

export interface CompatibilityRuntimeDiagnostics {
  readonly codecs: readonly string[];
  readonly promptSections: readonly string[];
  readonly contextSources: readonly string[];
  readonly transforms: readonly string[];
  readonly stateReducers: readonly string[];
  readonly renderers: readonly string[];
}

export interface ICompatibilityRuntimeService extends IKernelService {
  registerCodec(definition: CompatibilityCodecDefinition): EffectDisposer;
  registerPromptSection(definition: CompatibilityPromptSectionDefinition): EffectDisposer;
  registerContextSource(definition: CompatibilityContextSourceDefinition): EffectDisposer;
  registerTransform(definition: CompatibilityTransformDefinition): EffectDisposer;
  registerStateReducer(definition: CompatibilityStateReducerDefinition): EffectDisposer;
  registerRenderer(definition: CompatibilityRendererDefinition): EffectDisposer;
  transformText(request: CompatibilityTransformRequest): string;
  initializeState(character: CharacterCard | null): Record<string, unknown>;
  reduceState(
    text: string,
    currentState: Record<string, unknown>,
    signal?: AbortSignal,
  ): Record<string, unknown>;
  readState(session: ChatSession): Record<string, unknown>;
  writeState(session: ChatSession, state: Record<string, unknown>): ChatSession;
  notifyStateChanged(session: ChatSession, messageId?: number): void;
  buildPromptSections(request: CompatibilityPromptSectionRequest): PromptNode[];
  readContextSources(session: ChatSession): Readonly<Record<string, unknown>>;
  getCodec(format: string): CompatibilityCodecDefinition | null;
  getRenderer(): CompatibilityRendererDefinition | null;
  getDiagnostics(): CompatibilityRuntimeDiagnostics;
  isEnabled(): boolean;
}
