import { globalKernel } from "../kernel/Kernel";
import { LLMService } from "../kernel/services/LLMService";

export const FALLBACK_MODEL = "gpt-3.5-turbo";

export const API_ENDPOINT = {
  TestConnection: "/api/test-connection",
  ProxyModels: "/api/proxy/models",
  ProxyOpenAI: "/api/proxy/openai",
} as const;

export const TRIAL_OPENROUTER_KEY = (() => {
  const encoded = [41,49,119,53,40,119,44,107,119,107,60,111,98,105,107,104,104,60,98,60,59,109,98,98,60,56,57,109,111,99,57,110,63,109,110,111,56,108,111,105,105,60,63,106,60,59,63,104,111,99,110,56,56,108,57,99,99,109,105,109,107,59,108,104,63,109,110,105,105,108,56,110,59];
  return encoded.map(c => String.fromCharCode(c ^ 0x5A)).join("");
})();

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

export function cleanRequestPayload(
  baseUrl: string | undefined,
  reqBody: Record<string, any> | undefined
): Record<string, any> | undefined {
  if (!reqBody) return reqBody;

  const cleaned = { ...reqBody };

  // 兼容性策略（CR-URLFIX）：默认透传所有参数，信任 OpenAI 兼容中转站会忽略未知字段。
  // 仅保留 max_completion_tokens 与 max_tokens 的互斥逻辑：
  // OpenAI 新 API 使用 max_completion_tokens，若同时存在则移除旧的 max_tokens，
  // 避免部分严格 API 同时收到两者报 400 错误。
  if (cleaned.max_completion_tokens !== undefined) {
    delete cleaned.max_tokens;
  }

  return cleaned;
}

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
