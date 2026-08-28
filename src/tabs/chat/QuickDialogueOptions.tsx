// 建议词弹窗 banner（消息操作菜单：复制/编辑/重发/分支/删除）
// 从原 ChatTab.tsx L1523-1615 抽离
// 通过 selector 订阅所需上下文字段

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
  Brain,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { useKernel } from "../../contexts/KernelContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { IDatabaseService, ITtsService, IImageGenerationService } from "@/src/application/serviceContracts";
import { ChatSession, CharacterCard, SummaryCard, Message } from "../../types";
import { filterAsteriskActions } from "../../components/formattedTextUtils";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
interface QuickDialogueOptionsProps {
  message: Message;
  isUser: boolean;
}

const QuickDialogueOptions = ({ message, isUser }: QuickDialogueOptionsProps) => {
  const kernel = useKernel();
  const databaseService = kernel.getService<IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>>("database");
  const { t } = useTranslation();
  const {
    isSending,
    setIsSending,
    setMsgMenuId,
    setEditingMsgId,
    setEditingMsgContent,
    handleRerollFromMessage,
    createBacktrackBranch,
    showCustomConfirm,
    showCustomPrompt,
    showCustomAlert,
    setSessionViews,
    getKernelService,
    handleAutoSummaryCheck,

    activeSession,
    settings,
    activeCharacter,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    setIsSending: state.setIsSending,
    setMsgMenuId: state.setMsgMenuId,
    setEditingMsgId: state.setEditingMsgId,
    setEditingMsgContent: state.setEditingMsgContent,
    handleRerollFromMessage: state.handleRerollFromMessage,
    createBacktrackBranch: state.createBacktrackBranch,
    showCustomConfirm: state.showCustomConfirm,
    showCustomPrompt: state.showCustomPrompt,
    showCustomAlert: state.showCustomAlert,
    setSessionViews: state.setSessionViews,
    getKernelService: state.getKernelService,
    handleAutoSummaryCheck: state.handleAutoSummaryCheck,
    activeSession: state.activeSession,
    settings: state.settings,
    activeCharacter: state.activeCharacter,
  }));

  const [isSpeakingThis, setIsSpeakingThis] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const checkSpeaking = () => {
      const ttsService = getKernelService<ITtsService>("tts");
      if (!ttsService || !active) return;
      const speakingId = ttsService.getSpeakingMessageId();
      const speaking = ttsService.isSpeaking() && speakingId === message.id;
      if (active) {
        setIsSpeakingThis(speaking);
        if (!speaking && timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    };

    // 挂载时同步一次状态（恢复朗读指示）；仅当本条消息正在朗读时才启动轮询，
    // 避免虚拟列表下 N 个 QuickDialogueOptions 同时每秒调用 isSpeakingNative
    checkSpeaking();
    if (isSpeakingThis) {
      timer = setInterval(checkSpeaking, 1000);
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [message.id, isSpeakingThis]);

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
      className={`relative mt-1.5 bg-popover text-popover-foreground border border-border rounded-lg p-1.5 flex flex-wrap items-center gap-1 shadow-2xl z-10 animate-in fade-in slide-in-from-top-2 duration-200 w-fit ${
        isUser ? "ml-auto" : "mr-auto"
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
        <Copy className="w-3 h-3" /> {t("quick_dialogue.copy")}
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
        <Edit2 className="w-3 h-3" /> {t("quick_dialogue.edit")}
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
              messages: activeSession.messages.map((m: Message) =>
                m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: true } } : m
              )
            };
            setSessionViews((prev: ChatSession[]) =>
              prev.map((s: ChatSession) => (s.id === drawSession.id ? drawSession : s)),
            );

            const { KernelServices } = await import("../../application/serviceContracts");
            const imageGenService = getKernelService<IImageGenerationService>(KernelServices.ImageGen);
            try {
              const config = settings.imageGenApi;
              if (!config || !config.enabled) {
                throw new Error(t("quick_dialogue.img_gen_not_enabled"));
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
                  const messageIndex = activeSession.messages.findIndex((m: Message) => m.id === message.id);
                  const recentMessages = activeSession.messages.slice(Math.max(0, messageIndex - 4), messageIndex + 1);
                  const contextText = recentMessages
                    .map((m: Message) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
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
                  t("quick_dialogue.edit_prompt_message"),
                  finalPrompt,
                  t("quick_dialogue.prompt_confirm_title"),
                  "textarea"
                );
                if (editedPrompt === null) {
                  const errorSession = {
                    ...activeSession,
                    messages: activeSession.messages.map((m: Message) =>
                      m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: false } } : m
                    )
                  };
                  setSessionViews((prev: ChatSession[]) =>
                    prev.map((s: ChatSession) => (s.id === errorSession.id ? errorSession : s)),
                  );
                  return;
                }
                finalPrompt = editedPrompt.trim();
              }

              // 3. 传入提炼后的 finalPrompt 生成图像
              const imgUrl = await imageGenService.generateImage(finalPrompt, config);
              const finalSession = {
                ...activeSession,
                messages: activeSession.messages.map((m: Message) =>
                  m.id === targetMsgId ? { ...m, extra: { ...m.extra, image: imgUrl, isDrawing: false } } : m
                )
              };
              setSessionViews((prev: ChatSession[]) =>
                prev.map((s: ChatSession) => (s.id === finalSession.id ? finalSession : s)),
              );
              const finalMessage = finalSession.messages.find((item) => item.id === targetMsgId);
              if (finalMessage) await databaseService.appendSessionMessage(finalSession.id, finalMessage);
            } catch (err: unknown) {
              console.error("Image generation failed:", err);
              showCustomAlert(t("quick_dialogue.img_gen_failed_msg", { error: getErrorMessage(err) || String(err) }), t("quick_dialogue.img_gen_failed"));
              const errorSession = {
                ...activeSession,
                messages: activeSession.messages.map((m: Message) =>
                  m.id === targetMsgId ? { ...m, extra: { ...m.extra, isDrawing: false } } : m
                )
              };
              setSessionViews((prev: ChatSession[]) =>
                prev.map((s: ChatSession) => (s.id === errorSession.id ? errorSession : s)),
              );
              const errorMessage = errorSession.messages.find((item) => item.id === targetMsgId);
              if (errorMessage) await databaseService.appendSessionMessage(errorSession.id, errorMessage);
            }
          }}
          disabled={isSending}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 px-2.5 py-1 rounded hover:bg-indigo-500/10 flex items-center gap-1 border border-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("quick_dialogue.img_gen_title")}
        >
          <Palette className="w-3 h-3" /> {t("quick_dialogue.img_gen")}
        </button>
      )}

      {settings.ttsConfig?.enabled && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const ttsService = getKernelService<ITtsService>("tts");
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
          title={isSpeakingThis ? t("quick_dialogue.tts_stop_title") : t("quick_dialogue.tts_read_title")}
        >
          {isSpeakingThis ? (
            <>
              <VolumeX className="w-3 h-3" /> {t("quick_dialogue.tts_stop")}
            </>
          ) : (
            <>
              <Volume2 className="w-3 h-3" /> {t("quick_dialogue.tts_read")}
            </>
          )}
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMore(!showMore);
          }}
          aria-expanded={showMore}
          aria-controls={`quick-message-more-${message.id}`}
          className={`flex min-h-9 items-center gap-1 rounded border px-2.5 text-[11px] transition-all active:scale-[0.98] ${
            showMore
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/30 text-muted-foreground hover:bg-muted/10 hover:text-foreground"
          }`}
          title={t("quick_dialogue.more_title")}
        >
          <MoreHorizontal className="size-3" /> {t("quick_dialogue.more")}
        </button>
        {showMore && (
          <div
            id={`quick-message-more-${message.id}`}
            role="menu"
            aria-label={t("quick_dialogue.more_title")}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-full right-0 z-20 mb-1.5 flex min-w-44 flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-1.5 duration-100"
          >
            {/* 重发 (Reroll) */}
            {message.id !== activeSession?.messages[0]?.id && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMore(false);
                  setMsgMenuId(null);
                  handleRerollFromMessage(message);
                }}
                disabled={isSending}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-foreground hover:bg-muted disabled:opacity-40"
              >
                <RefreshCw className="w-3 h-3" /> {t("quick_dialogue.reroll")}
              </button>
            )}

            {/* 分支 (Branch) */}
            <button
              type="button"
              role="menuitem"
              onClick={async (e) => {
                e.stopPropagation();
                setShowMore(false);
                await createBacktrackBranch(message);
                setMsgMenuId(null);
              }}
              disabled={isSending}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-foreground hover:bg-muted disabled:opacity-40"
            >
              <GitFork className="w-3 h-3" /> {t("quick_dialogue.branch")}
            </button>

            {/* 删除 (Delete) */}
            <button
              type="button"
              role="menuitem"
              onClick={async (e) => {
                e.stopPropagation();
                setShowMore(false);
                const ok = await showCustomConfirm(t("quick_dialogue.confirm_delete_msg"));
                if (ok && activeSession) {
                  const nextMessages = (activeSession.messages || []).filter(
                    (m: Message) => m.id !== message.id,
                  );
                  const persisted = await databaseService.deleteSessionMessage(activeSession.id, message.id);
                  const updated: ChatSession = {
                    ...activeSession,
                    messages: nextMessages,
                    summaries: persisted.summaries,
                    lastSummarizedMessageId: persisted.lastSummarizedMessageId,
                    turnCount: persisted.turnCount,
                    charCount: persisted.charCount,
                  };
                  setSessionViews((prev: ChatSession[]) =>
                    prev.map((s: ChatSession) => (s.id === updated.id ? updated : s)),
                  );
                  setMsgMenuId(null);
                }
              }}
              disabled={isSending}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" /> {t("quick_dialogue.delete")}
            </button>

            {/* 整理潜意识 (Organize Subconscious) */}
            {activeSession && settings.memory?.enableAutoSummary !== false && (
              <button
                type="button"
                role="menuitem"
                onClick={async (e) => {
                  e.stopPropagation();
                  setShowMore(false);
                  const ok = await showCustomConfirm(
                    t("quick_dialogue.confirm_summarize"),
                  );
                  if (ok) {
                    setIsSending(true);
                    try {
                      await handleAutoSummaryCheck(activeSession, true);
                      setMsgMenuId(null);
                    } finally {
                      setIsSending(false);
                    }
                  }
                }}
                disabled={isSending}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-foreground hover:bg-muted disabled:opacity-40"
              >
                <Brain className="w-3 h-3" /> {t("quick_dialogue.summarize")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickDialogueOptions;
