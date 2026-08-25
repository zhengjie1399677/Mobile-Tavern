import type {
  AgentDriverDefinition,
  AgentMediaProcessorDefinition,
  AgentProviderDefinition,
  AgentToolDefinition,
} from "../../domain/agents/contracts";
import type {
  CompatibilityCodecDefinition,
  CompatibilityContextSourceDefinition,
  CompatibilityPromptSectionDefinition,
  CompatibilityRendererDefinition,
  CompatibilityStateReducerDefinition,
  CompatibilityTransformDefinition,
} from "../compatibility/contracts";
import { createRuntimeCapabilityToken } from "./capabilityTokens";

export const AGENT_DRIVER_CAPABILITY = createRuntimeCapabilityToken<AgentDriverDefinition>({
  id: "agent.driver",
  cardinality: "single",
  required: true,
});

export const LLM_ROUTE_CAPABILITY = createRuntimeCapabilityToken<AgentProviderDefinition>({
  id: "llm.route",
  cardinality: "single",
  required: true,
});

export const TOOL_CAPABILITY = createRuntimeCapabilityToken<AgentToolDefinition>({
  id: "tool",
  cardinality: "multiple",
});

export const MEDIA_PROCESSOR_CAPABILITY = createRuntimeCapabilityToken<AgentMediaProcessorDefinition>({
  id: "media.processor",
  cardinality: "multiple",
});

export const COMPATIBILITY_CODEC_CAPABILITY = createRuntimeCapabilityToken<CompatibilityCodecDefinition>({
  id: "compat.codec",
  cardinality: "multiple",
});

export const COMPATIBILITY_PROMPT_SECTION_CAPABILITY = createRuntimeCapabilityToken<CompatibilityPromptSectionDefinition>({
  id: "compat.prompt-section",
  cardinality: "multiple",
});

export const COMPATIBILITY_CONTEXT_SOURCE_CAPABILITY = createRuntimeCapabilityToken<CompatibilityContextSourceDefinition>({
  id: "compat.context-source",
  cardinality: "multiple",
});

export const COMPATIBILITY_TRANSFORM_CAPABILITY = createRuntimeCapabilityToken<CompatibilityTransformDefinition>({
  id: "compat.transform",
  cardinality: "multiple",
});

export const COMPATIBILITY_STATE_REDUCER_CAPABILITY = createRuntimeCapabilityToken<CompatibilityStateReducerDefinition>({
  id: "compat.state-reducer",
  cardinality: "multiple",
});

export const COMPATIBILITY_RENDERER_CAPABILITY = createRuntimeCapabilityToken<CompatibilityRendererDefinition>({
  id: "compat.renderer",
  cardinality: "multiple",
});
