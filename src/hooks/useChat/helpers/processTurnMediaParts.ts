import type { AgentTurnExecutionContext } from "../../../domain/agents/contracts";
import type {
  ChatSession,
  ChatSessionMetadataPatch,
  CharacterCard,
  Message,
  SummaryCard,
  UserSettings,
} from "../../../types";
import type { IDatabaseService } from "../../../application/serviceContracts";
import {
  AUDIO_ASR_PROCESSOR_ID,
  VIDEO_KEYFRAME_PROCESSOR_ID,
} from "../../../application/runtimePlugins";
import {
  getMessageContentText,
  normalizeMessageContentParts,
  type MessageContentPart,
} from "../../../domain/messages/messageContent";
import { AUDIO_TRANSCRIPT_PREFIX } from "../../../application/useCases/multimodalSendGuards";

interface TurnMediaLogger {
  warn: (message: string, meta?: unknown) => void;
}

export interface ProcessTurnMediaParams {
  session: ChatSession;
  agentTurn: AgentTurnExecutionContext;
  settings: UserSettings;
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  signal: AbortSignal;
  log: TurnMediaLogger;
}

/**
 * 为最后一条用户消息补齐媒体降级产物：普通音频走 ASR 转写、视频补关键帧。
 *
 * 返回改写后的会话（未发生变化时原样返回）。ASR 失败只记日志不阻断发送：
 * 转写只是降级手段，缺了它投影层会给出可执行的提示。
 */
export async function processTurnMediaParts({
  session,
  agentTurn,
  settings,
  databaseService,
  setSessionViews,
  signal,
  log,
}: ProcessTurnMediaParams): Promise<ChatSession> {
  const latestUserIndex = findLastUserMessageIndex(session.messages);
  const latestUserMessage = latestUserIndex >= 0 ? session.messages[latestUserIndex] : undefined;
  if (!latestUserMessage?.parts) return session;

  const processedParts: MessageContentPart[] = [];
  let mediaChanged = false;

  for (const part of latestUserMessage.parts) {
    if (part.type === "audio") {
      const hasTranscript = latestUserMessage.parts.some((candidate) =>
        candidate.type === "text" && candidate.text.startsWith(AUDIO_TRANSCRIPT_PREFIX),
      );
      processedParts.push(part);
      if (
        part.purpose !== "model-input"
        && !hasTranscript
        && settings.asrConfig?.enabled
        && settings.asrConfig.provider === "openai"
      ) {
        try {
          const result = await agentTurn.processMedia(AUDIO_ASR_PROCESSOR_ID, {
            assetId: part.assetId,
            kind: "audio",
            options: settings.asrConfig,
          });
          processedParts.push(...result.projectionParts);
          mediaChanged = true;
        } catch (asrErr) {
          log.warn("Audio ASR fallback skipped or failed", { error: asrErr });
        }
      }
      continue;
    }
    if (part.type === "video" && (!part.frameAssetIds || part.frameAssetIds.length === 0)) {
      const result = await agentTurn.processMedia(VIDEO_KEYFRAME_PROCESSOR_ID, {
        assetId: part.assetId,
        kind: "video",
      });
      processedParts.push(...result.projectionParts);
      mediaChanged = true;
      continue;
    }
    processedParts.push(part);
  }

  if (!mediaChanged) return session;

  const normalizedParts = normalizeMessageContentParts(processedParts);
  const processedMessage: Message = {
    ...latestUserMessage,
    contentVersion: 2,
    parts: normalizedParts,
    content: getMessageContentText(normalizedParts),
  };
  await databaseService.updateSessionMessage(session.id, processedMessage, {}, signal);
  const nextSession: ChatSession = {
    ...session,
    messages: session.messages.map((message, index) =>
      index === latestUserIndex ? processedMessage : message,
    ),
  };
  setSessionViews((previous) => previous.map((candidate) =>
    candidate.id === nextSession.id ? nextSession : candidate,
  ));
  return nextSession;
}

function findLastUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].sender === "user") return index;
  }
  return -1;
}
