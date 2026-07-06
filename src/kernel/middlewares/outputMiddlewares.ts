import { Middleware, OutputPipelineContext, KernelServices } from "../types";
import { calculateBisonModeProbability } from "../../hooks/useChat/helpers";
import { Message } from "../../types";

// L2 快速通道：表格记忆指令预扫描正则。
// 匹配 updateRow/insertRow/deleteRow 后紧跟左括号的模式，
// 用于在响应文本不含任何表格指令时跳过昂贵的 processTableMemory 调用。
const TABLE_MEMORY_TRIGGER_PATTERN = /(?:updateRow|insertRow|deleteRow)\s*\(/i;

// L2 快速通道：MVU 脚本指令预扫描正则。
// 匹配标准 MVU 命令（_.set/add/insert/delete/move）或 XML 标签（UpdateVariable/initvar），
// 用于在响应文本不含任何脚本指令时跳过昂贵的 iframe bridge 通信。
const MVU_SCRIPT_TRIGGER_PATTERN = /(?:_\.(?:set|add|insert|delete|move)\s*\(|<(?:UpdateVariable|initvar|JSONPatch)\b|\[\s*\{\s*["']op["']\s*:)/i;

export const tableMemoryMiddleware: Middleware<OutputPipelineContext> = async (context, next) => {
  const { session, responseText, settings, activeCharacter } = context;
  let currentSession = context.resultSession || session;

  // L2 快速通道：功能开启但响应文本不含表格指令时，跳过 processTableMemory 调用。
  // regex.test 在无匹配时为 O(n) 单次扫描（n=文本长度），远低于 processTableMemory 的完整解析开销。
  if (settings.enableTableMemory && activeCharacter && TABLE_MEMORY_TRIGGER_PATTERN.test(responseText)) {
    const kernel = context.kernel;
    if (!kernel) {
      console.warn("[tableMemoryMiddleware] kernel not injected in OutputPipelineContext, skipping.");
      context.resultSession = currentSession;
      await next();
      return;
    }
    // 阶段 C 迁移：通过 MemoryService.getStateTable() 访问状态表子模块
    const memoryService = kernel.getService<any>(KernelServices.Memory);
    const stateTable = memoryService.getStateTable();

    let currentMemory = currentSession.tableMemory || [];
    if (currentMemory.length === 0) {
      // 阶段 C 迁移：使用 stateTable.initDefaultSheets() 替代中间件内硬编码默认表
      currentMemory = stateTable.initDefaultSheets(activeCharacter.name || "char");
      currentSession = {
        ...currentSession,
        tableMemory: currentMemory
      };
    }

    try {
      // 新 API 仅接受 2 个参数（activeCharacter 在旧实现中未实际使用，已移除）
      const { updatedMemory, cleanContent, hasChanges } = stateTable.processTableMemory(
        currentMemory,
        responseText
      );

      if (hasChanges || cleanContent !== responseText) {
        let updatedMessages = currentSession.messages;
        if (updatedMessages.length > 0) {
          const lastMsg = { ...updatedMessages[updatedMessages.length - 1] };
          if (lastMsg.sender === "assistant") {
            lastMsg.content = cleanContent;
            updatedMessages = [
              ...updatedMessages.slice(0, -1),
              lastMsg
            ];
          }
        }
        currentSession = {
          ...currentSession,
          tableMemory: updatedMemory,
          messages: updatedMessages
        };
      }
    } catch (err) {
      console.warn("[MemoryStateTable] Middleware processing error:", err);
    }
  }

  context.resultSession = currentSession;
  await next();
};

export const mvuScriptMiddleware: Middleware<OutputPipelineContext> = async (context, next) => {
  const { responseText, settings } = context;
  let currentSession = context.resultSession || context.session;

  // L2 快速通道：功能开启但响应文本不含 MVU 指令时，跳过 executeMvuScript 调用。
  // executeMvuScript 内部会通过 iframe bridge 通信，开销远高于 regex 预扫描。
  if (settings.enableScriptExecution && responseText && MVU_SCRIPT_TRIGGER_PATTERN.test(responseText)) {
    const kernel = context.kernel;
    if (!kernel) {
      console.warn("[mvuScriptMiddleware] kernel not injected in OutputPipelineContext, skipping.");
      context.resultSession = currentSession;
      await next();
      return;
    }
    try {
      const scriptService = kernel.getService<any>(KernelServices.Script);
      currentSession = await scriptService.executeMvuScript(currentSession, responseText);
    } catch (err) {
      console.warn("[MvuScript] Middleware execution error:", err);
    }
  }

  context.resultSession = currentSession;
  await next();
};

export const bisonModeMiddleware: Middleware<OutputPipelineContext> = async (context, next) => {
  const { session, responseText, settings, activeCharacter, isStillActive, isBisonConsecutive, bisonRemainingCount } = context;
  let currentSession = context.resultSession || session;
  let shouldTriggerBison = false;
  let nextCount = bisonRemainingCount;

  if (settings.enableBisonMode && isStillActive) {
    if (!isBisonConsecutive) {
      const prob = calculateBisonModeProbability(activeCharacter, responseText, settings.expressionTriggers || {});
      const triggered = Math.random() * 100 < prob;
      if (triggered) {
        nextCount = Math.random() < 0.5 ? 1 : 2;
        shouldTriggerBison = true;
      }
    } else if (bisonRemainingCount > 0) {
      shouldTriggerBison = true;
    }
  }

  if (shouldTriggerBison && isStillActive) {
    nextCount = Math.max(0, nextCount - 1);

    const silentMsg: Message = {
      id: "msg_bison_silent_" + Math.random().toString(36).substring(2, 9),
      sender: "system" as const,
      content: settings.bisonModePrompt || "[野牛模式连续输出指令：请继续丰富当前场景，输出该角色的下一步神态、动作与言行。]",
      timestamp: Date.now(),
      extra: { isBisonSilent: true }
    };

    currentSession = {
      ...currentSession,
      messages: [...currentSession.messages, silentMsg]
    };
  }

  context.resultSession = currentSession;
  context.shouldTriggerBison = shouldTriggerBison;
  context.nextBisonRemainingCount = nextCount;
  await next();
};

export const autoSummaryMiddleware: Middleware<OutputPipelineContext> = async (context, next) => {
  const { settings, activeCharacter, controller, shouldTriggerBison } = context;
  let currentSession = context.resultSession || context.session;

  if (!shouldTriggerBison) {
    const kernel = context.kernel;
    if (!kernel) {
      console.warn("[autoSummaryMiddleware] kernel not injected in OutputPipelineContext, skipping.");
      context.resultSession = currentSession;
      await next();
      return;
    }
    try {
      // 通过 MemoryService.getSummary() 触发摘要检查
      const memoryService = kernel.getService<any>(KernelServices.Memory);
      const summary = memoryService.getSummary();
      const updatedSession = await summary.checkAndSummarize(
        currentSession,
        settings,
        activeCharacter,
        false,
        controller?.signal
      );
      if (updatedSession !== currentSession) {
        currentSession = updatedSession;
      }
    } catch (err) {
      console.warn("[MemorySummary] Middleware execution error:", err);
    }
  }

  context.resultSession = currentSession;
  await next();
};
