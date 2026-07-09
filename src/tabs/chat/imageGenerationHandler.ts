// 消息级生图处理逻辑，从 MessageBubble.tsx 抽离以保持单文件行数可控
// 负责：LLM 提示词生成 → 用户确认 → 调用生图服务 → 更新会话消息

import { globalKernel } from "../../kernel/Kernel";
import { IDatabaseService } from "../../kernel/types";

/**
 * 微内核插件式架构：会话持久化统一走 DatabaseService，业务层不再直接触碰 localDB。
 */
function saveSession(session: any): Promise<void> {
  return globalKernel.getService<IDatabaseService>("database").saveSession(session);
}

export interface ImageGenerationHandlerParams {
  message: any;
  activeSession: any;
  settings: any;
  activeCharacter: any;
  setSessions: (updater: (prev: any[]) => any[]) => void;
  showCustomAlert: (msg: string, title?: string) => void;
  showCustomPrompt: (
    message: string,
    defaultValue: string,
    title?: string,
    inputType?: string,
  ) => Promise<string | null>;
  getKernelService: (name: string) => any;
}

/** 将目标消息标记为正在/结束绘图 */
function updateMessageDrawingState(
  activeSession: any,
  targetMsgId: string,
  isDrawing: boolean,
  imageUrl?: string,
) {
  return {
    ...activeSession,
    messages: activeSession.messages.map((m: any) =>
      m.id === targetMsgId
        ? {
            ...m,
            extra: {
              ...m.extra,
              isDrawing,
              ...(imageUrl !== undefined ? { image: imageUrl } : {}),
            },
          }
        : m,
    ),
  };
}

/** 确保模板包含 {appearance} 占位符，缺失时按规则注入 */
function ensureAppearancePlaceholder(template: string): string {
  if (template.includes("{appearance}")) return template;

  if (template.includes("Conversation Context:\n{context}")) {
    return template.replace(
      "Conversation Context:\n{context}",
      "### Appearance Features\n{appearance}\n\n### Conversation Context\n{context}",
    );
  }
  if (template.includes("对话上下文：\n{context}")) {
    return template.replace(
      "对话上下文：\n{context}",
      "### 外观特征\n{appearance}\n\n### 对话上下文\n{context}",
    );
  }
  if (template.includes("{context}")) {
    return template.replace(
      "{context}",
      "### 外观特征\n{appearance}\n\n### 对话上下文\n{context}",
    );
  }
  return `### Appearance Features\n{appearance}\n\n${template}`;
}

const DEFAULT_TEMPLATE =
  "Based on the following character appearance features, conversation context, and current sentence, write a vivid English prompt describing the visual scene, character appearance (strictly following the appearance features), action, expression, location, and atmosphere. Focus on concrete visual details. Avoid text, abstract ideas, or dialogue.\nOutput only the raw English prompt, no extra text.\n\n### Appearance Features\n{appearance}\n\n### Conversation Context\n{context}\n\nCurrent Sentence to Visualize:\n{message}\n\nDescriptive English Prompt:";

/**
 * 执行消息级生图流程：
 * 1. 设置 loading 状态
 * 2. 可选调用 LLM 生成英文提示词
 * 3. 可选让用户编辑提示词
 * 4. 调用生图服务获取图片 URL
 * 5. 更新会话并持久化
 */
export async function handleGenerateImageForMessage({
  message,
  activeSession,
  settings,
  activeCharacter,
  setSessions,
  showCustomAlert,
  showCustomPrompt,
  getKernelService,
}: ImageGenerationHandlerParams): Promise<void> {
  if (!activeSession) return;
  const targetMsgId = message.id;

  // 设置 loading 状态
  const drawSession = updateMessageDrawingState(activeSession, targetMsgId, true);
  setSessions((prev: any[]) =>
    prev.map((s: any) => (s.id === drawSession.id ? drawSession : s)),
  );

  try {
    const config = settings.imageGenApi;
    if (!config || !config.enabled) {
      throw new Error("请先在设置中启用生图功能并配置接口参数。");
    }

    let finalPrompt = message.content;
    let template = ensureAppearancePlaceholder(
      config.promptGeneratorTemplate || DEFAULT_TEMPLATE,
    );

    // 可选：调用 LLM 生成英文提示词
    if (settings.api && settings.api.baseUrl) {
      try {
        const { universalFetch, API_ENDPOINT } = await import("../../utils/apiClient");
        const messageIndex = activeSession.messages.findIndex(
          (m: any) => m.id === message.id,
        );
        const recentMessages = activeSession.messages.slice(
          Math.max(0, messageIndex - 4),
          messageIndex + 1,
        );
        const contextText = recentMessages
          .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n");

        const charName = activeCharacter?.name || "Assistant";
        const userName = settings.userName || "User";
        const rawAppearance = activeCharacter?.description || "";
        const appearanceText =
          rawAppearance
            .replace(/\{\{char\}\}/gi, charName)
            .replace(/\{\{user\}\}/gi, userName)
            .trim() || "No character appearance described.";

        const llmPrompt = template
          .replace("{appearance}", appearanceText)
          .replace("{context}", contextText)
          .replace("{message}", message.content);

        const llmResponse = await universalFetch(API_ENDPOINT.ProxyOpenAI, {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey || "",
          chatPath: settings.api.chatPath,
          bypassProxy: settings.api.bypassProxy,
          disableReasoning: settings.api.disableReasoning,
          reqBody: {
            model: settings.api.modelName,
            messages: [{ role: "user", content: llmPrompt }],
            temperature: settings.preset?.temperature,
            top_p: settings.preset?.topP,
            top_k: settings.preset?.topK,
            min_p: settings.preset?.minP,
            max_tokens: 150,
            presence_penalty: settings.preset?.presencePenalty ?? 0.0,
            frequency_penalty: settings.preset?.frequencyPenalty ?? 0.0,
            repetition_penalty: settings.preset?.repetitionPenalty ?? 1.0,
          },
        });

        if (llmResponse.ok) {
          const llmJson = await llmResponse.json();
          const aiSummary = llmJson.choices?.[0]?.message?.content?.trim();
          if (aiSummary) {
            finalPrompt = aiSummary
              .replace(/^["'"`]+|["'"`]+$/g, "")
              .replace(
                /^(Prompt|Prompt:|Prompt description:|English Prompt:|Description:)\s*/i,
                "",
              )
              .trim();
            console.log("[ImageGeneration] Summarized Prompt:", finalPrompt);
          }
        }
      } catch (e) {
        console.warn("[ImageGeneration] LLM prompt summary failed, falling back:", e);
      }
    }

    // 可选：用户编辑提示词
    if (config.promptEditBeforeGenerate) {
      const editedPrompt = await showCustomPrompt(
        "生图提示词已生成，您可以在此修改：",
        finalPrompt,
        "提示词确认",
        "textarea",
      );
      if (editedPrompt === null) {
        const cancelledSession = updateMessageDrawingState(
          activeSession,
          targetMsgId,
          false,
        );
        setSessions((prev: any[]) =>
          prev.map((s: any) => (s.id === cancelledSession.id ? cancelledSession : s)),
        );
        return;
      }
      finalPrompt = editedPrompt.trim();
    }

    // 调用生图服务
    const { KernelServices } = await import("../../kernel");
    const imageGenService = getKernelService(KernelServices.ImageGen);
    const imgUrl = await imageGenService.generateImage(finalPrompt, config);

    const finalSession = updateMessageDrawingState(
      activeSession,
      targetMsgId,
      false,
      imgUrl,
    );
    setSessions((prev: any[]) =>
      prev.map((s: any) => (s.id === finalSession.id ? finalSession : s)),
    );
    await saveSession(finalSession);
  } catch (err: any) {
    console.error("Image generation failed:", err);
    showCustomAlert(`绘图失败: ${err.message || String(err)}`, "生图失败");
    const errorSession = updateMessageDrawingState(activeSession, targetMsgId, false);
    setSessions((prev: any[]) =>
      prev.map((s: any) => (s.id === errorSession.id ? errorSession : s)),
    );
    await saveSession(errorSession);
  }
}
