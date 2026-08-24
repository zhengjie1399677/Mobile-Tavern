import type { AgentProviderDefinition } from "../../domain/agents/contracts";
import type {
  AsrConfig,
  IAgentRuntimeService,
  IAsrService,
  IAttachmentService,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import { extractVideoKeyframes } from "../../infrastructure/media/browserVideoFrameExtractor";
import type { RuntimePluginDefinition } from "./contracts";

export const AGENT_SPINE_RUNTIME_PLUGIN_ID = "mobile-tavern.agent-spine";
export const MOBILE_TAVERN_CHAT_DRIVER_ID = "mobile-tavern.chat.driver";
export const OPENAI_COMPATIBLE_PROVIDER_ID = "provider.openai-compatible";
export const ANTHROPIC_COMPATIBLE_PROVIDER_ID = "provider.anthropic-compatible";
export const AUDIO_ASR_PROCESSOR_ID = "media.audio.asr";
export const VIDEO_KEYFRAME_PROCESSOR_ID = "media.video.keyframes";

const openAiCompatibleProvider: AgentProviderDefinition = {
  id: OPENAI_COMPATIBLE_PROVIDER_ID,
  version: "1.0.0",
  capabilities: {
    inputModalities: ["text", "image"],
    supportedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    maxAttachmentBytes: 20 * 1024 * 1024,
    maxAttachments: 4,
    supportsStreaming: true,
    supportsTools: true,
  },
  buildRequestBody: (request) => ({ ...request, stream: true }),
};

const anthropicCompatibleProvider: AgentProviderDefinition = {
  id: ANTHROPIC_COMPATIBLE_PROVIDER_ID,
  version: "1.0.0",
  capabilities: {
    // 当前网络层仍走 OpenAI-compatible 代理方言，因此先保守声明纯文本。
    inputModalities: ["text"],
    supportsStreaming: true,
    supportsTools: false,
  },
  buildRequestBody: (request) => {
    const next: Record<string, unknown> = { ...request, stream: true };
    delete next.stream_options;
    return next;
  },
};

/** 阶段 3 的受信 Agent Spine 插件；注册项全部归属 Profile 子 Scope。 */
export const agentSpineRuntimePlugin: RuntimePluginDefinition = {
  id: AGENT_SPINE_RUNTIME_PLUGIN_ID,
  version: "1.0.0",
  requires: ["mobile-tavern.legacy-runtime"],
  validateConfig(config: unknown): void {
    if (config !== undefined) throw new Error("AGENT_SPINE_PLUGIN_CONFIG_UNSUPPORTED");
  },
  setup({ kernel, scope, profile }): void {
    const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    scope.add(runtime.bindComposition({
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      pluginVersions: Object.fromEntries(profile.plugins.map((plugin) => [plugin.id, plugin.version])),
      providerBindings: { ...profile.providerBindings },
      contributionOrder: Object.fromEntries(Object.entries(profile.contributionOrder)
        .map(([slotId, ids]) => [slotId, [...ids]])),
      capabilityDecisions: {},
    }));
    scope.add(runtime.registerDriver({
      id: MOBILE_TAVERN_CHAT_DRIVER_ID,
      version: "1.0.0",
      run: ({ executeLegacy }) => executeLegacy(),
    }));
    scope.add(runtime.registerProvider(openAiCompatibleProvider));
    scope.add(runtime.registerProvider(anthropicCompatibleProvider));
    if (isContributionEnabled(profile, "media.processor", AUDIO_ASR_PROCESSOR_ID)) {
      scope.add(runtime.registerMediaProcessor({
      id: AUDIO_ASR_PROCESSOR_ID,
      version: "1.0.0",
      inputKinds: ["audio"],
      async process(request, { signal }) {
        const config = parseAsrConfig(request.options);
        const attachments = kernel.getService<IAttachmentService>(KernelServices.Attachments);
        const metadata = await attachments.getMetadata(request.assetId);
        if (!metadata || metadata.kind !== "audio") throw new Error("AUDIO_ASR_SOURCE_INVALID");
        const transcript = (await kernel
          .getService<IAsrService>(KernelServices.Asr)
          .transcribeFile(await attachments.getBlob(request.assetId), metadata.originalName, config, signal))
          .trim();
        if (!transcript) throw new Error("AUDIO_ASR_EMPTY_TRANSCRIPT");
        return {
          sourceAssetId: request.assetId,
          projectionParts: [{ type: "text", text: `[音频转写]\n${transcript}` }],
          derivedAssetIds: [],
          strategy: "audio-asr",
        };
      },
      }));
    }
    if (isContributionEnabled(profile, "media.processor", VIDEO_KEYFRAME_PROCESSOR_ID)) {
      scope.add(runtime.registerMediaProcessor({
      id: VIDEO_KEYFRAME_PROCESSOR_ID,
      version: "1.0.0",
      inputKinds: ["video"],
      async process(request, { signal }) {
        const attachments = kernel.getService<IAttachmentService>(KernelServices.Attachments);
        const metadata = await attachments.getMetadata(request.assetId);
        if (!metadata || metadata.kind !== "video") throw new Error("VIDEO_PROCESSOR_SOURCE_INVALID");
        const frames = await extractVideoKeyframes(await attachments.getBlob(request.assetId), 4, signal);
        const frameAssetIds: string[] = [];
        for (let index = 0; index < frames.length; index += 1) {
          if (signal.aborted) throw signal.reason;
          const frame = new File(
            [frames[index]],
            `${metadata.originalName.replace(/\.[^.]+$/, "") || "video"}-frame-${index + 1}.jpg`,
            { type: "image/jpeg" },
          );
          frameAssetIds.push((await attachments.stageFile(frame)).id);
        }
        return {
          sourceAssetId: request.assetId,
          projectionParts: [{
            type: "video",
            assetId: request.assetId,
            frameAssetIds,
          }],
          derivedAssetIds: frameAssetIds,
          strategy: "video-keyframes",
        };
      },
      }));
    }
  },
};

function isContributionEnabled(
  profile: { readonly contributionOrder: Readonly<Record<string, readonly string[]>> },
  slotId: string,
  contributionId: string,
): boolean {
  return profile.contributionOrder[slotId]?.includes(contributionId) === true;
}

export function resolveBuiltinProviderId(apiType: string): string {
  return apiType === "anthropic"
    ? ANTHROPIC_COMPATIBLE_PROVIDER_ID
    : OPENAI_COMPATIBLE_PROVIDER_ID;
}

function parseAsrConfig(value: unknown): AsrConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AUDIO_ASR_CONFIG_INVALID");
  }
  const config = value as Record<string, unknown>;
  if (
    config.provider !== "openai"
    || typeof config.enabled !== "boolean"
    || typeof config.language !== "string"
  ) {
    throw new Error("AUDIO_ASR_CONFIG_INVALID");
  }
  return {
    enabled: config.enabled,
    provider: "openai",
    language: config.language,
    openaiApiKey: typeof config.openaiApiKey === "string" ? config.openaiApiKey : undefined,
    openaiBaseUrl: typeof config.openaiBaseUrl === "string" ? config.openaiBaseUrl : undefined,
    openaiModel: typeof config.openaiModel === "string" ? config.openaiModel : undefined,
  };
}
