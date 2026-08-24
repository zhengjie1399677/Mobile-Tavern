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
import {
  IDatabaseService,
  IKernel,
  KernelServices,
  type ICompatibilityRuntimeService,
} from "@/src/application/serviceContracts";
import {
  bisonModeMiddleware,
  mvuScriptMiddleware,
  tableMemoryMiddleware,
  type OutputPipelineContext,
} from "../../application/pipeline";
import { buildOutputContext } from "./helpers/streamHelpers";
import { cleanSuggestionsFromText } from "./helpers/textParsing";
import { Logger } from "../../utils/logger";
import type { MemoryServiceTyped } from "../../application/services/memory";
import { attachSessionStateSnapshot } from "../../domain/chat/sessionStateSnapshot";

const logger = Logger.create("pipelineHelpers");

export const CONNECTION_INTERRUPTED_SUFFIX = "\n\n*(连接中断，仅保留部分生成内容)*";

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
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  databaseService: IDatabaseService;
  kernel: IKernel;
  triggerScroll?: () => void;
  /** 仅写入最终展示消息的后缀，不参与 Prompt 输出管线或记忆抽取。 */
  responseSuffix?: string;
  /** 重发等事务可注入原子持久化策略；普通发送沿用默认单条追加。 */
  persistSession?: (session: ChatSession) => Promise<void>;
  /** traceId：用于关联一次用户操作的管道执行日志与遥测事件，贯穿中间件链路。 */
  traceId?: string;
}): Promise<OutputPipelineContext> {
  const {
    setSessionViews,
    databaseService,
    kernel,
    triggerScroll,
    persistSession,
    responseSuffix = "",
    traceId,
    ...ctxParams
  } = params;

  const log = traceId ? logger.withTrace(traceId) : logger;

  log.debug("RAW AI RESPONSE", {
    content: ctxParams.responseText,
    reasoning: ctxParams.reasoningText || undefined,
  });

  const outputCtx = buildOutputContext(ctxParams);
  outputCtx.kernel = kernel;
  if (traceId) outputCtx.traceId = traceId;
  const {
    session,
    settings,
    activeCharacter,
    controller,
    isBisonConsecutive,
    responseText,
  } = ctxParams;
  const pendingAssistantId = [...session.messages]
    .reverse()
    .find((message) => message.sender === "assistant")?.id;
  const inputMessageIds = new Set(session.messages.map((message) => message.id));

  // L1 快速通道：仅当全部功能（含自动总结）明确关闭且非野牛连续时跳过管道。
  // 旁路条件保守：必须同时满足以下全部条件才命中：
  //   1. enableTableMemory / enableScriptExecution / enableBisonMode 三个开关全关
  //   2. 非野牛连续输出模式（isBisonConsecutive === false）
  //   3. 自动总结明确关闭；UI 只持有分页窗口，不能据此估算未总结消息数
  //   4. output 管道仅注册了标准 3 个中间件（无自定义插件中间件）
  // 任一条件不满足则回退到完整管道执行，确保零行为差异。
  const pipeline = kernel.getPipeline<OutputPipelineContext>("output");
  const allFeaturesDisabled =
    !settings.enableTableMemory &&
    !settings.enableScriptExecution &&
    !settings.enableBisonMode &&
    settings.memory?.enableAutoSummary === false;
  const hasStandardPipeline = pipeline.matches([
    tableMemoryMiddleware,
    mvuScriptMiddleware,
    bisonModeMiddleware,
  ]);

  let bypassed = false;
  if (allFeaturesDisabled && !isBisonConsecutive && hasStandardPipeline) {
    outputCtx.resultSession = session;
    bypassed = true;
  }

  if (!bypassed) {
    await pipeline.execute(outputCtx);
  }

  let parsedSession = outputCtx.resultSession || ctxParams.session;

  // 提取并剥离 <memory> 与 <suggestions> 等所有元数据标签
  const cleanResult = cleanSuggestionsFromText(responseText);
  let cleanAiText = cleanResult.content;
  let memoryContent: string | undefined;
  
  const memoryMatch = /<(memory|memory_extraction)>([\s\S]*?)<\/\1>/i.exec(responseText);
  if (memoryMatch) {
    memoryContent = memoryMatch[2].trim();
  }

  // 始终更新 session 中的最新 AI 消息内容，防止元数据标签污染数据库
  let persistedAssistantIndex = -1;
  if (parsedSession.messages.length > 0) {
    const messages = [...parsedSession.messages];
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].sender !== "assistant") continue;
      const assistantMessage = {
        ...messages[index],
        content: cleanAiText + responseSuffix,
      };
      messages[index] = assistantMessage;
      persistedAssistantIndex = index;
      parsedSession.messages = messages;
      break;
    }
  }

  const messagesToCommit = parsedSession.messages.filter((message) =>
    !inputMessageIds.has(message.id) || message.id === pendingAssistantId
  ).map((message) => message.sender === "assistant"
    ? attachSessionStateSnapshot(message, parsedSession)
    : message
  );
  if (messagesToCommit.length > 0) {
    const committedById = new Map(messagesToCommit.map((message) => [message.id, message]));
    parsedSession.messages = parsedSession.messages.map((message) =>
      committedById.get(message.id) ?? message
    );
  }

  if (persistSession) {
    await persistSession(parsedSession);
  } else {
    await databaseService.commitSessionTurn(
      parsedSession.id,
      {
        variables: parsedSession.variables,
        runtimePluginState: parsedSession.runtimePluginState,
        tableMemory: parsedSession.tableMemory,
        pinnedMessageIds: parsedSession.pinnedMessageIds,
        mutedMessageIds: parsedSession.mutedMessageIds,
        activePromptSceneProfileId: parsedSession.activePromptSceneProfileId,
      },
      messagesToCommit,
      undefined,
      traceId,
    );
  }

  // 摘要必须在本轮消息事务提交后读取数据库，否则阈值边界会停在用户消息并拆开一轮对话。
  // 摘要失败不回滚已经成功提交的聊天消息，下一轮仍可按同一持久化边界重试。
  if (!outputCtx.shouldTriggerBison) {
    try {
      const memoryService = kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
      const summary = typeof memoryService?.getSummary === "function"
        ? memoryService.getSummary()
        : null;
      if (summary && typeof summary.checkAndSummarize === "function") {
        const summarized = await summary.checkAndSummarize(
          parsedSession,
          settings,
          activeCharacter,
          false,
          controller.signal,
        );
        if (summarized !== parsedSession) {
          parsedSession = summarized;
          outputCtx.resultSession = summarized;
        }
      }
    } catch (error) {
      log.warn("Post-commit auto summary failed", { error });
    }
  }

  // 异步后台触发记忆抽取（Fire-and-Forget，不阻塞主对话流）
  try {
    const memoryService = kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
    if (memoryService && parsedSession.messages.length > 0) {
      const messages = parsedSession.messages;
      const aiMsg = persistedAssistantIndex >= 0 ? messages[persistedAssistantIndex] : undefined;

      // 记忆片段/事实需要绝对 turnIndex（与 replaceSessionBranch 的清扫边界一致），
      // 不能用懒加载内存数组下标，否则长会话里会误删/漏删旧分支记忆。
      const resolveTurnIndex = async (msgId: string, fallback: number): Promise<number> => {
        try {
          const storage = typeof memoryService.getStorage === "function"
            ? memoryService.getStorage()
            : null;
          const record = storage ? await storage.getMessageById(msgId) : null;
          if (record && Number.isInteger(record.turnIndex)) {
            return record.turnIndex;
          }
        } catch (e) {
          log.warn("Failed to resolve message turnIndex for extraction", { error: e, msgId });
        }
        return fallback;
      };

      // 1. 抽取最新 AI 消息（L0 + L1 + L2）
      if (aiMsg && aiMsg.sender === "assistant") {
        const turnIndex = await resolveTurnIndex(aiMsg.id, messages.length - 1);
        memoryService.getExtractor().scheduleExtraction({
          msgId: aiMsg.id,
          sessionId: parsedSession.id,
          role: "assistant",
          message: cleanAiText,
          turnIndex,
          memoryContent: memoryContent, // 传入提取到的 <memory> 内容
        });
      }

      // 2. 抽取最新用户消息（如果不是野牛模式连续输出）
      if (!isBisonConsecutive && messages.length >= 2) {
        const userMsg = [...messages].reverse().find((message) => message.sender === "user");
        if (userMsg && userMsg.sender === "user") {
          const userMessageIndex = messages.findIndex((message) => message.id === userMsg.id);
          const turnIndex = await resolveTurnIndex(userMsg.id, userMessageIndex);
          memoryService.getExtractor().scheduleExtraction({
            msgId: userMsg.id,
            sessionId: parsedSession.id,
            role: "user",
            message: userMsg.content,
            turnIndex,
          });
        }
      }
    }
  } catch (err) {
    log.warn("Failed to schedule background extraction", { error: err });
  }

  setSessionViews((prev) =>
    prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
  );
  try {
    if (
      typeof kernel.hasService === "function"
      && kernel.hasService(KernelServices.CompatibilityRuntime)
    ) {
      kernel
        .getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
        .notifyStateChanged(parsedSession);
    }
  } catch (e) {
    log.warn("Failed to notifyVariablesUpdated", { error: e });
  }
  if (triggerScroll) triggerScroll();
  return outputCtx;
}
