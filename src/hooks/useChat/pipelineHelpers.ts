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
  const { session, settings, isBisonConsecutive } = ctxParams;

  // L1 快速通道：当全部功能关闭、非野牛连续、且无需自动总结时，跳过整个 output pipeline。
  // 旁路条件保守：必须同时满足以下全部条件才命中：
  //   1. enableTableMemory / enableScriptExecution / enableBisonMode 三个开关全关
  //   2. 非野牛连续输出模式（isBisonConsecutive === false）
  //   3. 未总结消息数 < 触发阈值（无需调用 handleAutoSummaryCheck）
  //   4. output 管道仅注册了标准 4 个中间件（无自定义插件中间件）
  // 任一条件不满足则回退到完整管道执行，确保零行为差异。
  const pipeline = globalKernel.getPipeline("output");
  const STANDARD_OUTPUT_MIDDLEWARE_COUNT = 4;
  const allFeaturesDisabled =
    !settings.enableTableMemory &&
    !settings.enableScriptExecution &&
    !settings.enableBisonMode;
  const hasStandardPipeline = pipeline.list().length === STANDARD_OUTPUT_MIDDLEWARE_COUNT;

  let bypassed = false;
  if (allFeaturesDisabled && !isBisonConsecutive && hasStandardPipeline) {
    // 快速估算未总结轮数（不创建 slice，仅计算长度差）
    const triggerTurns = Number(settings?.memory?.summaryTriggerTurns || 0);
    const recentTurns = Number(settings?.memory?.recentTurns || 6);
    const triggerRounds = (!isNaN(triggerTurns) && triggerTurns > 0) ? triggerTurns : recentTurns;
    const maxAllowedUnsummarized = Math.max(4, triggerRounds) * 2;

    let lastSummaryIdx = -1;
    if (session.lastSummarizedMessageId) {
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].id === session.lastSummarizedMessageId) {
          lastSummaryIdx = i;
          break;
        }
      }
    }
    const unsummarizedCount = session.messages.length - (lastSummaryIdx + 1);

    if (unsummarizedCount < maxAllowedUnsummarized) {
      // 快速通道命中：所有中间件都会跳过，resultSession 等于原 session
      outputCtx.resultSession = session;
      bypassed = true;
    }
  }

  if (!bypassed) {
    await pipeline.execute(outputCtx);
  }

  const parsedSession = outputCtx.resultSession || ctxParams.session;
  await databaseService.saveSession(parsedSession);
  setSessions((prev) =>
    prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
  );
  if (triggerScroll) triggerScroll();
  return outputCtx;
}
