// 建议词弹窗 banner（消息操作菜单：复制/编辑/重发/分支/删除）
// 从原 ChatTab.tsx L1523-1615 抽离
// 内部调用 useUnifiedApp() 获取上下文

import React from "react";
import {
  Copy,
  Edit2,
  RefreshCw,
  GitFork,
  Trash2,
  Palette,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";

interface QuickDialogueOptionsProps {
  message: any;
  isUser: boolean;
}

const QuickDialogueOptions = ({ message, isUser }: QuickDialogueOptionsProps) => {
  const {
    isSending,
    setMsgMenuId,
    setEditingMsgId,
    setEditingMsgContent,
    handleRerollFromMessage,
    createBacktrackBranch,
    showCustomConfirm,
    showCustomPrompt,
    setSessions,
    activeSession,
    settings,
    activeCharacter,
  } = useUnifiedApp();

  return (
    <div
      className={`absolute top-full mt-1.5 bg-popover text-popover-foreground border border-border rounded-lg p-1.5 flex items-center gap-1 shadow-2xl z-10 ${
        isUser ? "right-0" : "left-0"
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(
            message.content,
          );
          setMsgMenuId(null);
        }}
        className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1"
      >
        <Copy className="w-3 h-3" /> 复制
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditingMsgId(message.id);
          setEditingMsgContent(message.content);
          setMsgMenuId(null);
        }}
        disabled={isSending}
        className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Edit2 className="w-3 h-3" /> 编辑
      </button>

      {message.id !== activeSession?.messages[0]?.id && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMsgMenuId(null);
            handleRerollFromMessage(message);
          }}
          disabled={isSending}
          className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title="从该对白开始重新生成后续回答"
        >
          <RefreshCw className="w-3 h-3" /> 重发
        </button>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          setMsgMenuId(null);
          createBacktrackBranch(message);
        }}
        disabled={isSending}
        className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
        title="从此处创立平行宇宙分支记录"
      >
        <GitFork className="w-3 h-3" /> 分支
      </button>

      {settings.imageGenApi?.enabled && !isUser && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMsgMenuId(null);
            if (!activeSession) return;
            const targetMsgId = message.id;
            
            // Set loading state
            const drawSession = {
              ...activeSession,
              messages: activeSession.messages.map((m: any) =>
                m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: true } } : m
              )
            };
            setSessions((prev: any) =>
              prev.map((s: any) => (s.id === drawSession.id ? drawSession : s)),
            );

            import("../../kernel").then(async ({ globalKernel, KernelServices }) => {
              const imageGenService = globalKernel.getService<any>(KernelServices.ImageGen);
              try {
                const config = settings.imageGenApi;
                if (!config || !config.enabled) {
                  throw new Error("请先在设置中启用生图功能并配置接口参数。");
                }

                // 1. 调用大模型根据上下文提炼场景 Prompt
                let finalPrompt = message.content;
                let template = config.promptGeneratorTemplate || "Based on the following character appearance features, conversation context, and current sentence, write a vivid English prompt describing the visual scene, character appearance (strictly following the appearance features), action, expression, location, and atmosphere. Focus on concrete visual details. Avoid text, abstract ideas, or dialogue.\nOutput only the raw English prompt, no extra text.\n\n### Appearance Features\n{appearance}\n\n### Conversation Context\n{context}\n\nCurrent Sentence to Visualize:\n{message}\n\nDescriptive English Prompt:";

                // Ensure compatibility with old user templates that might not have {appearance} placeholder.
                if (!template.includes("{appearance}")) {
                  if (template.includes("Conversation Context:\n{context}")) {
                    template = template.replace(
                      "Conversation Context:\n{context}",
                      "### Appearance Features\n{appearance}\n\n### Conversation Context\n{context}"
                    );
                  } else if (template.includes("对话上下文：\n{context}")) {
                    template = template.replace(
                      "对话上下文：\n{context}",
                      "### 外观特征\n{appearance}\n\n### 对话上下文\n{context}"
                    );
                  } else if (template.includes("{context}")) {
                    template = template.replace(
                      "{context}",
                      "### 外观特征\n{appearance}\n\n### 对话上下文\n{context}"
                    );
                  } else {
                    template = `### Appearance Features\n{appearance}\n\n${template}`;
                  }
                }

                if (settings.api && settings.api.baseUrl) {
                  try {
                    const { universalFetch, API_ENDPOINT } = await import("../../utils/apiClient");
                    
                    // 获取最近 5 条对话作为 Context，帮助 LLM 了解上下文
                    const messageIndex = activeSession.messages.findIndex((m: any) => m.id === message.id);
                    const recentMessages = activeSession.messages.slice(Math.max(0, messageIndex - 4), messageIndex + 1);
                    const contextText = recentMessages
                      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
                      .join("\n");

                    // 准备并清洗人物外观特征描述文本
                    const charName = activeCharacter?.name || "Assistant";
                    const userName = settings.userName || "User";
                    const rawAppearance = activeCharacter?.description || "";
                    const appearanceText = rawAppearance
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
                        messages: [
                          {
                            role: "user",
                            content: llmPrompt
                          }
                        ],
                        temperature: 0.7,
                        max_tokens: 150
                      }
                    });

                    if (llmResponse.ok) {
                      const llmJson = await llmResponse.json();
                      const aiSummary = llmJson.choices?.[0]?.message?.content?.trim();
                      if (aiSummary) {
                        finalPrompt = aiSummary
                          .replace(/^["'“`]+|["'”`]+$/g, "") // 移除前后引号
                          .replace(/^(Prompt|Prompt:|Prompt description:|English Prompt:|Description:)\s*/i, "")
                          .trim();
                        console.log("[QuickDialogueOptions] Summarized Prompt:", finalPrompt);
                      }
                    } else {
                      console.warn(`[QuickDialogueOptions] LLM prompt summary failed with status ${llmResponse.status}, falling back to original message`);
                    }
                  } catch (e) {
                    console.warn("[QuickDialogueOptions] Failed to contact LLM for prompt summary, falling back:", e);
                  }
                }

                // 2. 根据设置，决定是否弹窗确认/修改提示词
                if (config.promptEditBeforeGenerate) {
                  const editedPrompt = await showCustomPrompt(
                    "生图提示词已生成，您可以在此修改：",
                    finalPrompt,
                    "提示词确认",
                    "textarea"
                  );
                  if (editedPrompt === null) {
                    // 用户取消了生图
                    const errorSession = {
                      ...activeSession,
                      messages: activeSession.messages.map((m: any) =>
                        m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: false } } : m
                      )
                    };
                    setSessions((prev: any) =>
                      prev.map((s: any) => (s.id === errorSession.id ? errorSession : s)),
                    );
                    return;
                  }
                  finalPrompt = editedPrompt.trim();
                }

                // 3. 传入提炼后的 finalPrompt 生成图像
                const imgUrl = await imageGenService.generateImage(finalPrompt, config);
                
                const finalSession = {
                  ...activeSession,
                  messages: activeSession.messages.map((m: any) =>
                    m.id === targetMsgId ? { ...m, extra: { ...m.extra, image: imgUrl, isDrawing: false } } : m
                  )
                };
                setSessions((prev: any) =>
                  prev.map((s: any) => (s.id === finalSession.id ? finalSession : s)),
                );
                await saveSession(finalSession);
              } catch (err: any) {
                console.error("Image generation failed:", err);
                alert(`绘图失败: ${err.message || String(err)}`);
                
                const errorSession = {
                  ...activeSession,
                  messages: activeSession.messages.map((m: any) =>
                    m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: false } } : m
                  )
                };
                setSessions((prev: any) =>
                  prev.map((s: any) => (s.id === errorSession.id ? errorSession : s)),
                );
                await saveSession(errorSession);
              }
            });
          }}
          disabled={isSending}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 px-2.5 py-1 rounded hover:bg-indigo-500/10 flex items-center gap-1 border border-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title="对当前对白场景进行绘制"
        >
          <Palette className="w-3 h-3" /> 生图
        </button>
      )}

      <button
        onClick={async (e) => {
          e.stopPropagation();
          const ok =
            await showCustomConfirm(
              "确定删除该单条对白台词吗？",
            );
          if (ok) {
            const nextMessages =
              (activeSession.messages || []).filter(
                (m: any) => m.id !== message.id,
              );
            const updated = {
              ...activeSession,
              messages: nextMessages,
            };
            setSessions((prev: any) =>
              prev.map((s: any) =>
                s.id === updated.id ? updated : s,
              ),
            );
            await saveSession(updated);
            setMsgMenuId(null);
          }
        }}
        disabled={isSending}
        className="text-[11px] text-red-500/80 hover:text-red-400 px-2 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
};

export default QuickDialogueOptions;
