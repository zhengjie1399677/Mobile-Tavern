/**
 * pipelineHelpers.ts
 *
 * 负责调用 Kernel Output Pipeline 并持久化 Session 的帮助函数。
 * 此文件有意不经过 helpers/index.ts 重新导出，以防在测试环境中被间接拉入
 * 依赖 Vite-only「?raw」语法的 tavernHelperBridge.ts，导致 Node.js 测试崩溃。
 * 消费方请直接导入本文件：import { runOutputPipelineAndSave } from "./pipelineHelpers";
 */
import React from "react";
import { ChatSession, UserSettings, CharacterCard } from "../../types";
import { OutputPipelineContext, IDatabaseService } from "../../kernel/types";
import { globalKernel } from "../../kernel";
import { buildOutputContext } from "./helpers/streamHelpers";

/**
 * 执行 Output Pipeline 并保存 Session，成功后更新 React sessions 状态。
 * 若提供 triggerScroll 则在保存后触发滚动。
 */
export async function runOutputPipelineAndSave(params: {
  session: ChatSession;
  responseText: string;
  reasoningText: string;
  settings: UserSettings;
  activeCharacter: CharacterCard;
  controller: AbortController;
  isStillActive: boolean;
  isBisonConsecutive: boolean;
  bisonRemainingCount: number;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  databaseService: IDatabaseService;
  triggerScroll?: () => void;
}): Promise<OutputPipelineContext> {
  const { setSessions, databaseService, triggerScroll, ...ctxParams } = params;
  const outputCtx = buildOutputContext(ctxParams);
  await globalKernel.getPipeline("output").execute(outputCtx);
  const parsedSession = outputCtx.resultSession || ctxParams.session;
  await databaseService.saveSession(parsedSession);
  setSessions((prev) =>
    prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
  );
  if (triggerScroll) triggerScroll();
  return outputCtx;
}
