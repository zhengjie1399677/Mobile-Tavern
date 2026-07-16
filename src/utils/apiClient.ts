import { globalKernel } from "../kernel/Kernel";
import type { IKernel } from "../kernel/types";
import { LLMService } from "../kernel/services/LLMService";

export const FALLBACK_MODEL = "gpt-3.5-turbo";

export const API_ENDPOINT = {
  TestConnection: "/api/test-connection",
  ProxyModels: "/api/proxy/models",
  ProxyOpenAI: "/api/proxy/openai",
} as const;

export const TRIAL_OPENROUTER_KEY = "TRIAL_KEY_PLACEHOLDER";

let fallbackLlm: LLMService | null = null;
// TODO-2: 接收可选 kernel 参数，默认回退 globalKernel 单例。
// 如此测试环境可传入隔离的 Mock 实例，实现物理隔离测试。
function getLlmService(kernel?: IKernel) {
  const k = kernel || globalKernel;
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
    clientContext?: any,
    kernel?: IKernel
  ): Promise<{ reply: string; expression: string }> => {
    return getLlmService(kernel).sendCatbotRequest(content, history, clientContext);
  }
};
