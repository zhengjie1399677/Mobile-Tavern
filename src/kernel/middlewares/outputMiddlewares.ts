import { Middleware, OutputPipelineContext, KernelServices } from "../types";
import { calculateBisonModeProbability } from "../../hooks/useChat/helpers";
import { Message } from "../../types";

// L2 快速通道：表格记忆指令预扫描正则。
// 匹配 updateRow/insertRow/deleteRow 后紧跟左括号的模式，
// 用于在响应文本不含任何表格指令时跳过昂贵的 processTableMemory 调用。
const TABLE_MEMORY_TRIGGER_PATTERN = /(?:updateRow|insertRow|deleteRow)\s*\(/i;

/**
 * 从角色卡扩展字段中编译外部 MVU 触发正则（遵循准则二：纯数据驱动与零硬编码）。
 * 角色卡可在 extensions.mvu_settings.trigger_patterns 中定义字符串数组，
 * 每个元素为一个正则表达式源码（如 "_.set\\\\(" 或 "<UpdateVariable"）。
 * 编译后合并为一个 OR 正则；若未定义则返回 null，表示不做预扫描过滤。
 */
function buildExternalMvuTriggerRegex(character: any): RegExp | null {
  const mvuSettings = character?.extensions?.mvu_settings ||
                      character?.extensions?.mvu ||
                      character?.extensions?.MVU;
  const patterns = mvuSettings?.trigger_patterns;
  if (!Array.isArray(patterns) || patterns.length === 0) return null;

  const validSources: string[] = [];
  for (const p of patterns) {
    if (typeof p === "string" && p.trim()) {
      try {
        // 验证正则合法性
        new RegExp(p);
        validSources.push(p);
      } catch {
        console.warn("[MVU] Invalid external trigger pattern skipped:", p);
      }
    }
  }
  if (validSources.length === 0) return null;
  try {
    return new RegExp(validSources.join("|"), "i");
  } catch {
    return null;
  }
}

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
  const { responseText, settings, activeCharacter } = context;
  let currentSession = context.resultSession || context.session;

  // 功能关闭或空响应时跳过
  if (!settings.enableScriptExecution || !responseText) {
    context.resultSession = currentSession;
    await next();
    return;
  }

  const kernel = context.kernel;
  if (!kernel) {
    console.warn("[mvuScriptMiddleware] kernel not injected in OutputPipelineContext, skipping.");
    context.resultSession = currentSession;
    await next();
    return;
  }

  // 内容预扫描：若响应文本不含任何 MVU 命令模式，跳过解析以节省数据库查询
  const HAS_MVU_CONTENT = /(?:<UpdateVariable\b|<initvar\b|_\.(?:set|add|delete|remove|unset|assign|insert|move)\s*\()/i;
  if (!HAS_MVU_CONTENT.test(responseText)) {
    // 快速路径：无 MVU 命令，跳过解析
    context.resultSession = currentSession;
    await next();
    return;
  }

  // L2 快速通道：角色卡定义的 trigger_patterns 仅作为性能提示，
  // 用于在响应文本明显不含 MVU 内容时跳过解析。但若外部正则不匹配，
  // 仍需执行解析——trigger_patterns 是优化而非门控，错误定义不应导致数据丢失。
  const externalRegex = buildExternalMvuTriggerRegex(activeCharacter);
  if (externalRegex && !externalRegex.test(responseText)) {
    console.warn(
      "[mvuScriptMiddleware] External trigger_patterns did not match, but MVU parsing will proceed as fallback.",
      "Card:", activeCharacter?.name
    );
  }

  try {
    const scriptService = kernel.getService<any>(KernelServices.Script);
    currentSession = await scriptService.executeMvuScript(currentSession, responseText);
  } catch (err) {
    console.warn("[MvuScript] Middleware execution error:", err);
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
