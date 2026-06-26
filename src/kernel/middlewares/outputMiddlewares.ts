import { Middleware, OutputPipelineContext, KernelServices } from "../types";
import { globalKernel } from "../Kernel";
import { calculateBisonModeProbability } from "../../hooks/useChat/helpers";
import { Message } from "../../types";

// L2 快速通道：表格记忆指令预扫描正则。
// 匹配 updateRow/insertRow/deleteRow 后紧跟左括号的模式，
// 用于在响应文本不含任何表格指令时跳过昂贵的 processTableMemory 调用。
const TABLE_MEMORY_TRIGGER_PATTERN = /(?:updateRow|insertRow|deleteRow)\s*\(/i;

// L2 快速通道：MVU 脚本指令预扫描正则。
// 匹配标准 MVU 命令（_.set/add/insert/delete/move）或 XML 标签（UpdateVariable/initvar），
// 用于在响应文本不含任何脚本指令时跳过昂贵的 iframe bridge 通信。
const MVU_SCRIPT_TRIGGER_PATTERN = /(?:_\.(?:set|add|insert|delete|move)\s*\(|<(?:UpdateVariable|initvar)\b)/i;

export const tableMemoryMiddleware: Middleware<OutputPipelineContext> = async (context, next) => {
  const { session, responseText, settings, activeCharacter } = context;
  let currentSession = context.resultSession || session;

  // L2 快速通道：功能开启但响应文本不含表格指令时，跳过 processTableMemory 调用。
  // regex.test 在无匹配时为 O(n) 单次扫描（n=文本长度），远低于 processTableMemory 的完整解析开销。
  if (settings.enableTableMemory && activeCharacter && TABLE_MEMORY_TRIGGER_PATTERN.test(responseText)) {
    const kernel = context.kernel || globalKernel;
    const tableMemoryService = kernel.getService<any>(KernelServices.TableMemory);

    let currentMemory = currentSession.tableMemory || [];
    if (currentMemory.length === 0) {
      currentMemory = [
        {
          id: "sheet_status_and_relation",
          name: "状态与关系",
          columns: ["角色", "好感度", "亲密度", "当前状态描述"],
          rows: [
            [activeCharacter.name || "char", "50", "相识", "初次结识，关系尚显生疏"]
          ],
          enable: true,
          description: "用于记录角色和你（{{user}}）之间的当前好感状态和亲密关系定位"
        }
      ];
      currentSession = {
        ...currentSession,
        tableMemory: currentMemory
      };
    }

    try {
      const { updatedMemory, cleanContent, hasChanges } = tableMemoryService.processTableMemory(
        currentMemory,
        responseText,
        activeCharacter
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
      console.warn("[TableMemory] Middleware processing error:", err);
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
    try {
      const kernel = context.kernel || globalKernel;
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
    try {
      const kernel = context.kernel || globalKernel;
      const autoSummaryService = kernel.getService<any>(KernelServices.AutoSummary);
      const updatedSession = await autoSummaryService.handleAutoSummaryCheck(
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
      console.warn("[AutoSummary] Middleware execution error:", err);
    }
  }

  context.resultSession = currentSession;
  await next();
};
