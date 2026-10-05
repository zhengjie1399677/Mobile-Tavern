import type { EffectDisposer, IKernelService } from "../../kernel/types";
import type {
  CharacterCard,
  ChatSession,
  CompatibilityScriptSecurityMode,
  CustomPromptBlock,
  LorebookEntry,
  Message,
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
  readonly depth?: number;
  readonly isEdit?: boolean;
  readonly placement?: number;
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
  readonly userInput?: string;
  readonly triggeredLorebookEntries?: readonly LorebookEntry[];
}

export interface CompatibilityPromptSectionDefinition {
  readonly id: string;
  readonly version: string;
  build(request: CompatibilityPromptSectionRequest): readonly PromptNode[];
}

export interface WorldInfoTimedEffect {
  start: number;
  end: number;
  protected?: boolean;
}

export interface WorldInfoTimedState {
  sticky: Record<string, WorldInfoTimedEffect>;
  cooldown: Record<string, WorldInfoTimedEffect>;
  delayCounters?: Record<string, number>;
}

export interface CompatibilityWorldInfoResolverRequest {
  readonly messages: readonly Message[];
  readonly userInput: string;
  readonly entries: readonly LorebookEntry[];
  readonly maxRecursionDepth?: number;
  readonly recursive?: boolean;
  readonly timedState?: WorldInfoTimedState;
  readonly onUpdateTimedState?: (nextState: WorldInfoTimedState) => void;
  readonly conditionContext?: {
    readonly variables?: Record<string, unknown>;
    readonly session?: Record<string, unknown>;
  };
}

/** 由兼容插件解释来源格式的 World Info 语义，通用 Prompt 层只消费结果。 */
export interface CompatibilityWorldInfoResolverDefinition {
  readonly id: string;
  readonly version: string;
  resolve(request: CompatibilityWorldInfoResolverRequest): readonly LorebookEntry[];
}

/**
 * 兼容插件的上下文来源扩展点。
 *
 * ⚠️ 死缝（2026-10-05 核实）：`readContextSources` 全仓**没有任何生产调用者**，只有接口、实现与测试。
 * MVU 状态实际是通过 `compat.sillytavern.prompt.mvu-state` 这个 **prompt-section** 贡献进入提示词的。
 *
 * 因此：**禁止把它接成第二条上下文路径**。通用推送式上下文的唯一落点是
 * [通用上下文来源缝设计](../../../docs/agents/context_source_seam_design.md)；本类型保留仅因
 * 删除它需要同时改 Profile 贡献声明与架构守卫口径，属于有清理窗口时再做的整理工作。
 */
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
  /**
   * 可选：把来源格式的私有 Prompt 候选列表收口为应用内部传统 Prompt 块。
   *
   * 顺序容器、角色别名与候选库语义只能由解释该来源格式的 Codec 判定；通用用例只消费结果，
   * 不反向识别来源生态字段（见 `COMPAT-DATA` 与 sillytavern_compat.md 第 5 节）。
   * 未实现该能力的 Codec 必须让调用方安全降级为空列表。
   */
  readPresetPrompts?(input: unknown): readonly CustomPromptBlock[];
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
  readonly worldInfoResolvers: readonly string[];
  readonly renderers: readonly string[];
}

export interface ICompatibilityRuntimeService extends IKernelService {
  registerCodec(definition: CompatibilityCodecDefinition): EffectDisposer;
  registerPromptSection(definition: CompatibilityPromptSectionDefinition): EffectDisposer;
  registerContextSource(definition: CompatibilityContextSourceDefinition): EffectDisposer;
  registerTransform(definition: CompatibilityTransformDefinition): EffectDisposer;
  registerStateReducer(definition: CompatibilityStateReducerDefinition): EffectDisposer;
  registerWorldInfoResolver(definition: CompatibilityWorldInfoResolverDefinition): EffectDisposer;
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
  getWorldInfoResolver(): CompatibilityWorldInfoResolverDefinition | null;
  readContextSources(session: ChatSession): Readonly<Record<string, unknown>>;
  getCodec(format: string): CompatibilityCodecDefinition | null;
  getRenderer(): CompatibilityRendererDefinition | null;
  getDiagnostics(): CompatibilityRuntimeDiagnostics;
  isEnabled(): boolean;
}
