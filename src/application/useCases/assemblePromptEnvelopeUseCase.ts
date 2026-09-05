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

type PromptDatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message,
  ChatSessionMetadataPatch
>;

export interface AssemblePromptEnvelopeParams {
  databaseService: PromptDatabaseService;
  promptService: Pick<IPromptService<CharacterCard, ChatSession, UserSettings, LorebookEntry>, "assemblePrompt">;
  character: CharacterCard;
  session: ChatSession;
  userInput: string;
  settings: UserSettings;
  globalLorebook: LorebookEntry[];
  recalledMemories?: unknown[];
  beforeMessageId?: string;
  signal?: AbortSignal;
  traceId?: string;
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
  let runtimePluginStatePatch: PromptAssemblyResult["runtimePluginStatePatch"];
  const promptEnvelope = params.promptService.assemblePrompt({
    onUpdateRuntimePluginState: patch => {
      runtimePluginStatePatch ??= {};
      for (const [id, changes] of Object.entries(patch)) {
        runtimePluginStatePatch[id] = { ...runtimePluginStatePatch[id], ...changes };
      }
    },
    character: params.character,
    chat: promptSession,
    userInput: params.userInput,
    settings: params.settings,
    globalLorebook: params.globalLorebook,
    recalledMemories: params.recalledMemories,
    signal: params.signal,
    traceId: params.traceId,
  });
  return { promptSession, promptEnvelope: { ...promptEnvelope, runtimePluginStatePatch } };
}

/** 提交生成结果时才合并插件增量，保留生成期间更新的其他插件字段。 */
export function applyPromptRuntimeState(
  session: ChatSession,
  patch: PromptAssemblyResult["runtimePluginStatePatch"],
): ChatSession {
  if (!patch) return session;
  const runtimePluginState = { ...session.runtimePluginState };
  for (const [id, changes] of Object.entries(patch)) {
    const previous = runtimePluginState[id];
    runtimePluginState[id] = {
      ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}),
      ...changes,
    };
  }
  return { ...session, runtimePluginState };
}
