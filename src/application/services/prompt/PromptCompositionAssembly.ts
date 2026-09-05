import type {
  PromptBlock,
  PromptComposition,
  PromptCompositionRuntimeData,
} from "../../../domain/prompt-composition";
import {
  applyPromptSceneProfile,
  compilePromptComposition,
} from "../../../domain/prompt-composition";
import type { UserSettings } from "../../../types";
import { ModelCapabilityRegistry } from "../llmCompatibility";
import type { PromptAssemblyResult } from "./PromptAssemblyResult";
import { shapePromptRequest } from "./PromptRequestShaper";

export interface PromptCompositionAssemblyParams {
  composition: PromptComposition;
  runtime: PromptCompositionRuntimeData;
  activeSceneProfileId?: string;
  userInput: string;
  settings: UserSettings;
  estimateTokens: (text: string) => number;
  runtimePromptNodes?: readonly RuntimePromptNode[];
  reportDiagnostic?: (code: string, message: string) => void;
}

interface RuntimePromptNode {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * 自由编排的单一执行管线：场景覆盖、编译、请求整形和最终预算审计均在此完成。
 * 外部格式必须在进入本函数前转换为中立 PromptComposition。
 */
export function assemblePromptComposition(
  params: PromptCompositionAssemblyParams,
): PromptAssemblyResult {
  const { composition, runtime, settings, estimateTokens } = params;
  const tokenBudget = resolvePromptTokenBudget(composition, settings);
  const sceneResolution = applyPromptSceneProfile(composition, params.activeSceneProfileId);
  const runtimeComposition = appendRuntimePromptNodes(
    sceneResolution.composition,
    params.runtimePromptNodes ?? [],
  );
  let compiled = compilePromptComposition(runtimeComposition, runtime, {
    tokenBudget,
    estimateTokens,
  });
  let shaped = shapePromptRequest(compiled.messages, settings.promptConfig.requestShaping);
  const originalShapedTokens = sumMessageTokens(shaped.messages, estimateTokens);

  // role wrapper、system squash 与 assistant prefill 发生在编译后；把这些开销反向
  // 计入编译预算再执行一次，避免预算报告与真正发送的消息不一致。
  if (tokenBudget && compiled.budget && originalShapedTokens > tokenBudget) {
    const shapingOverhead = Math.max(0, originalShapedTokens - compiled.budget.used);
    if (shapingOverhead > 0) {
      compiled = compilePromptComposition(runtimeComposition, runtime, {
        tokenBudget: Math.max(1, tokenBudget - shapingOverhead),
        estimateTokens,
      });
      shaped = shapePromptRequest(compiled.messages, settings.promptConfig.requestShaping);
    }
  }

  const finalUsed = sumMessageTokens(shaped.messages, estimateTokens);
  if (tokenBudget && finalUsed > tokenBudget && !compiled.diagnostics.some(
    (diagnostic) => diagnostic.code === "FINAL_TOKEN_BUDGET_EXCEEDED",
  )) {
    compiled.diagnostics.push({
      level: "error",
      code: "FINAL_TOKEN_BUDGET_EXCEEDED",
      message: `请求整形后的不可裁剪内容超出 Token 预算：约 ${finalUsed} / ${tokenBudget} Token。`,
    });
  }
  compiled.diagnostics.unshift(...sceneResolution.diagnostics);
  compiled.diagnostics.forEach((diagnostic) => {
    params.reportDiagnostic?.(diagnostic.code, diagnostic.message);
  });

  const systemInstruction = shaped.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    version: 1,
    systemInstruction,
    dynamicInstruction: "",
    history: shaped.messages.flatMap((message) => message.role === "system"
      ? []
      : [{
          role: message.role === "assistant" && settings.api.type !== "openai-compat"
            ? "model" as const
            : message.role,
          name: message.name,
          content: message.content,
        }]),
    userInput: params.userInput,
    messages: shaped.messages,
    diagnostics: compiled.diagnostics,
    traces: compiled.traces,
    budget: tokenBudget
      ? {
          limit: tokenBudget,
          used: finalUsed,
          originalUsed: originalShapedTokens,
          droppedBlockIds: compiled.budget?.droppedBlockIds ?? [],
        }
      : undefined,
    stopSequences: shaped.stopSequences,
    requestShaping: shaped.report,
  };
}

function appendRuntimePromptNodes(
  composition: PromptComposition,
  nodes: readonly RuntimePromptNode[],
): PromptComposition {
  const inChatNodes = nodes.filter((node) =>
    node.metadata?.position === "in_chat" && node.content.trim().length > 0);
  if (inChatNodes.length === 0) return composition;
  const usedIds = new Set(composition.blocks.map((block) => block.id));
  const blocks: PromptBlock[] = inChatNodes.map((node, index) => {
    const baseId = `runtime_prompt_${index}_${node.id}`;
    let id = baseId;
    let suffix = 1;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const rawDepth = node.metadata?.depth;
    const depth = typeof rawDepth === "number" && Number.isFinite(rawDepth)
      ? Math.max(0, Math.floor(rawDepth))
      : 0;
    const rawOrder = node.metadata?.order;
    const order = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : 100;
    const rawRole = node.metadata?.role;
    const role = rawRole === "user" || rawRole === "assistant" ? rawRole : "system";
    return {
      id,
      name: node.title,
      enabled: true,
      role,
      source: { type: "template" },
      template: node.content,
      order,
      placement: { type: "in_chat", depth, order },
      tokenPolicy: { priority: 100, overflow: "keep" },
    };
  });
  return { ...composition, blocks: [...composition.blocks, ...blocks] };
}

function resolvePromptTokenBudget(composition: PromptComposition, settings: UserSettings): number | undefined {
  const budgetConfig = composition.tokenBudget;
  if (budgetConfig?.enabled === false) return undefined;
  if (budgetConfig?.mode === "custom") return budgetConfig.maxTokens;
  const modelCapabilities = ModelCapabilityRegistry.getCapabilities(
    settings.api?.modelName || "",
    settings.api?.baseUrl,
  );
  const contextLimit = settings.api?.contextLimit || modelCapabilities.contextWindow || 200000;
  return Math.max(1, contextLimit - Math.max(0, settings.preset?.maxTokens || 0));
}

function sumMessageTokens(
  messages: ReadonlyArray<{ content: string }>,
  estimateTokens: (text: string) => number,
): number {
  return messages.reduce((total, message) => {
    const estimated = estimateTokens(message.content);
    return total + (Number.isFinite(estimated) ? Math.max(0, Math.ceil(estimated)) : 0);
  }, 0);
}
