import type { IKernel } from "@/src/application/serviceContracts";
import { getRuntimeKernel } from "../kernel/runtimeKernel";
import { LLMService } from "../application/services/LLMService";

export const FALLBACK_MODEL = "gpt-3.5-turbo";

export const API_ENDPOINT = {
  TestConnection: "/api/test-connection",
  ProxyModels: "/api/proxy/models",
  ProxyOpenAI: "/api/proxy/openai",
} as const;

export { TRIAL_KEY_SENTINEL as TRIAL_OPENROUTER_KEY } from "./keyManager";

let fallbackLlm: LLMService | null = null;
function getLlmService(kernel?: IKernel) {
  const k = kernel ?? getRuntimeKernel();
  if (k && k.hasService("llm")) {
    return k.getService<any>("llm");
  }
  if (!fallbackLlm) {
    fallbackLlm = new LLMService();
  }
  return fallbackLlm;
}

export const isClientMode = (kernel?: IKernel): boolean => {
  return getLlmService(kernel).isClientMode();
};

export const universalFetch = async (
  endpoint: string,
  proxyPayload: any,
  options?: { customSignal?: AbortSignal; kernel?: IKernel }
): Promise<Response> => {
  const { customSignal, kernel } = options || {};
  return getLlmService(kernel).universalFetch(endpoint, proxyPayload, customSignal);
};

export const apiClient = {
  universalFetch,
  isClientMode,
  sendCatbotRequest: async (
    content: string,
    history: any[],
    clientContext?: unknown,
    kernel?: IKernel
  ): Promise<{ reply: string; expression: string }> => {
    return getLlmService(kernel).sendCatbotRequest(content, history, clientContext);
  }
};
