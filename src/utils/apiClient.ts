import { globalKernel } from "../kernel/Kernel";
import { LLMService } from "../kernel/services/LLMService";

export const FALLBACK_MODEL = "gpt-3.5-turbo";

export const API_ENDPOINT = {
  TestConnection: "/api/test-connection",
  ProxyModels: "/api/proxy/models",
  ProxyOpenAI: "/api/proxy/openai",
} as const;

export const TRIAL_OPENROUTER_KEY = "TRIAL_KEY_PLACEHOLDER";

let fallbackLlm: LLMService | null = null;
function getLlmService() {
  if (globalKernel && globalKernel.hasService("llm")) {
    return globalKernel.getService<any>("llm");
  }
  if (!fallbackLlm) {
    fallbackLlm = new LLMService();
  }
  return fallbackLlm;
}

// P0-3: cleanRequestPayload 已下沉到 src/kernel/utils/requestSchema.ts，
// 实现请求体字段白名单清洗。本文件不再保留重复定义，避免维护漂移。

export const isClientMode = (): boolean => {
  return getLlmService().isClientMode();
};

export const universalFetch = async (
  endpoint: string,
  proxyPayload: any,
  customSignal?: AbortSignal
): Promise<Response> => {
  return getLlmService().universalFetch(endpoint, proxyPayload, customSignal);
};

export const apiClient = {
  universalFetch,
  isClientMode,
  sendCatbotRequest: async (content: string, history: any[], clientContext?: any): Promise<{ reply: string; expression: string }> => {
    return getLlmService().sendCatbotRequest(content, history, clientContext);
  }
};
