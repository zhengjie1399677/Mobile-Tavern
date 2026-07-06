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
  Volume2,
  VolumeX,
  MoreHorizontal,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";
import { filterAsteriskActions } from "../../components/formattedTextUtils";

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
    showCustomAlert,
    setSessions,
    getKernelService,

    activeSession,
    settings,
    activeCharacter,
  } = useUnifiedApp();

  const [isSpeakingThis, setIsSpeakingThis] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let timer: any = null;

    const checkSpeaking = () => {
      const ttsService = getKernelService<any>("tts");
      if (ttsService) {
          const speakingId = ttsService.getSpeakingMessageId();
          const speaking = ttsService.isSpeaking() && speakingId === message.id;
          if (active) {
            setIsSpeakingThis(speaking);
          }
        }
    };

    checkSpeaking();
    timer = setInterval(checkSpeaking, 500);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [message.id]);

  React.useEffect(() => {
    if (!showMore) return;
    const handleGlobalClick = () => {
      setShowMore(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
    };
  }, [showMore]);

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


      {settings.imageGenApi?.enabled && !isUser && (
        <button
          onClick={async (e) => {
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

            const { KernelServices } = await import("../../kernel");
            const imageGenService = getKernelService<any>(KernelServices.ImageGen);
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
                      messages: [{ role: "user", content: llmPrompt }],
                      temperature: settings.preset?.temperature,
                      top_p: settings.preset?.topP,
                      top_k: settings.preset?.topK,
                      min_p: settings.preset?.minP,
                      max_tokens: 150,
                      presence_penalty: settings.preset?.presencePenalty ?? 0.0,
                      frequency_penalty: settings.preset?.frequencyPenalty ?? 0.0,
                      repetition_penalty: settings.preset?.repetitionPenalty ?? 1.0,
                    }
                  });

                  if (llmResponse.ok) {
                    const llmJson = await llmResponse.json();
                    const aiSummary = llmJson.choices?.[0]?.message?.content?.trim();
                    if (aiSummary) {
                      finalPrompt = aiSummary
                        .replace(/^["'"`]+|["'"`]+$/g, "")
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
              showCustomAlert(`绘图失败: ${err.message || String(err)}`, "生图失败");
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
          }}
          disabled={isSending}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 px-2.5 py-1 rounded hover:bg-indigo-500/10 flex items-center gap-1 border border-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title="对当前对白场景进行绘制"
        >
          <Palette className="w-3 h-3" /> 生图
        </button>
      )}

      {settings.ttsConfig?.enabled && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const ttsService = getKernelService<any>("tts");
            if (!ttsService) return;

            if (isSpeakingThis) {
              ttsService.stop();
              setIsSpeakingThis(false);
            } else {
              setIsSpeakingThis(true);
              let textToSpeak = message.content;
              if (settings.ttsConfig?.readMode === "dialogue_only") {
                const filtered = filterAsteriskActions(message.content);
                if (filtered.trim().length > 0) {
                  textToSpeak = filtered;
                }
              }
              ttsService.speak(textToSpeak, {
                ...settings.ttsConfig,
                messageId: message.id
              }).catch(() => {
                setIsSpeakingThis(false);
              }).finally(() => {
                setIsSpeakingThis(false);
              });
            }
          }}
          className={`text-[11px] px-2.5 py-1 rounded flex items-center gap-1 border disabled:opacity-40 disabled:cursor-not-allowed ${
            isSpeakingThis
              ? "text-rose-400 hover:text-rose-300 border-rose-500/20 hover:bg-rose-500/10"
              : "text-emerald-400 hover:text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/10"
          }`}
          title={isSpeakingThis ? "停止语音朗读" : "语音朗读当前对白"}
        >
          {isSpeakingThis ? (
            <>
              <VolumeX className="w-3 h-3" /> 停止
            </>
          ) : (
            <>
              <Volume2 className="w-3 h-3" /> 朗读
            </>
          )}
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowMore(!showMore);
        }}
        className={`text-[11px] px-2.5 py-1 rounded flex items-center gap-1 border active:scale-[0.98] transition-all relative ${
          showMore
            ? "text-primary border-primary bg-primary/10"
            : "text-muted-foreground hover:text-foreground border-border/30 hover:bg-muted/10"
        }`}
        title="更多选项"
      >
        <MoreHorizontal className="w-3 h-3" /> 更多

        {showMore && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-full mb-1.5 right-0 bg-popover border border-border shadow-2xl rounded-lg py-1 px-1 min-w-[90px] flex flex-col gap-0.5 z-20 animate-in fade-in slide-in-from-bottom-1.5 duration-100"
          >
            {/* 重发 (Reroll) */}
            {message.id !== activeSession?.messages[0]?.id && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMore(false);
                  setMsgMenuId(null);
                  handleRerollFromMessage(message);
                }}
                disabled={isSending}
                className="w-full text-[11px] text-left text-primary hover:bg-primary/10 px-2 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-40"
              >
                <RefreshCw className="w-3 h-3" /> 重发
              </button>
            )}

            {/* 分支 (Branch) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMore(false);
                setMsgMenuId(null);
                createBacktrackBranch(message);
              }}
              disabled={isSending}
              className="w-full text-[11px] text-left text-primary hover:bg-primary/10 px-2 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-40"
            >
              <GitFork className="w-3 h-3" /> 分支
            </button>

            {/* 删除 (Delete) */}
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                setShowMore(false);
                const ok = await showCustomConfirm("确定删除该单条对白台词吗？");
                if (ok) {
                  const nextMessages = (activeSession.messages || []).filter(
                    (m: any) => m.id !== message.id,
                  );
                  const updated = {
                    ...activeSession,
                    messages: nextMessages,
                  };
                  setSessions((prev: any) =>
                    prev.map((s: any) => (s.id === updated.id ? updated : s)),
                  );
                  await saveSession(updated);
                  setMsgMenuId(null);
                }
              }}
              disabled={isSending}
              className="w-full text-[11px] text-left text-red-500 hover:bg-red-500/10 px-2 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        )}
      </button>
    </div>
  );
};

export default QuickDialogueOptions;
