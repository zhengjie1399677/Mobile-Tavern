import type { PromptAssemblyResult } from "../services/prompt/PromptAssemblyResult";
import type { IDatabaseService, IPromptService } from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  LorebookEntry,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
import { buildAuthoritativePromptSession } from "./promptHistoryUseCases";
import type { ContextContribution } from "../../domain/contextSources/contracts";

type PromptDatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message,
  ChatSessionMetadataPatch
>;

export interface AssemblePromptEnvelopeParams {
  databaseService: PromptDatabaseService;
  promptService: IPromptService;
  character: CharacterCard;
  session: ChatSession;
  userInput: string;
  settings: UserSettings;
  globalLorebook: LorebookEntry[];
  recalledMemories?: unknown[];
  contextContributions?: readonly ContextContribution[];
  beforeMessageId?: string;
  signal?: AbortSignal;
  traceId?: string;
  /** 发送 = normal，重新生成 = regenerate；用于 SillyTavern injection_trigger。 */
  generationType?: string;
}

export interface AuthoritativePromptEnvelope {
  promptSession: ChatSession;
  promptEnvelope: PromptAssemblyResult;
}

/** 发送与重生成共用的权威历史读取和 Prompt 组装入口。 */
export async function assembleAuthoritativePromptEnvelope(
  params: AssemblePromptEnvelopeParams,
): Promise<AuthoritativePromptEnvelope> {
  const promptSession = await buildAuthoritativePromptSession(
    params.databaseService,
    params.session,
    params.settings,
    params.beforeMessageId,
  );
  const promptEnvelope = params.promptService.assemblePrompt({
    character: params.character,
    chat: promptSession,
    userInput: params.userInput,
    settings: params.settings,
    globalLorebook: params.globalLorebook,
    recalledMemories: params.recalledMemories,
    ...(params.contextContributions ? { contextContributions: params.contextContributions } : {}),
    signal: params.signal,
    traceId: params.traceId,
    ...(params.generationType ? { generationType: params.generationType } : {}),
  });
  return { promptSession, promptEnvelope };
}
