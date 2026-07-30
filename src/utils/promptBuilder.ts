import { PromptService } from "../application/services/PromptService";
import { getRuntimeKernel } from "../kernel/runtimeKernel";

let fallbackPrompt: PromptService | null = null;
function getPromptService() {
  const kernel = getRuntimeKernel();
  if (kernel?.hasService("prompt")) {
    return kernel.getService<any>("prompt");
  }
  if (!fallbackPrompt) {
    fallbackPrompt = new PromptService();
  }
  return fallbackPrompt;
}

export function cleanNameForApi(name: string | undefined, fallback: string): string | undefined {
  return getPromptService().cleanNameForApi(name, fallback);
}

export function estimateTokens(text: string): number {
  return getPromptService().estimateTokens(text);
}

export function sanitizeName(name: string): string {
  return getPromptService().sanitizeName(name);
}

export function getTriggeredLorebookEntries(
  messages: any[],
  userInput: string,
  entries: any[],
  maxRecursionDepth?: number
): any[] {
  return getPromptService().getTriggeredLorebookEntries(messages, userInput, entries, maxRecursionDepth);
}

export function replaceMacros(
  text: string,
  params: any
): string {
  return getPromptService().replaceMacros(text, params);
}

export function assemblePromptContext(params: any) {
  return getPromptService().assemblePrompt(params);
}
