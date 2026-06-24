import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { Message, ChatSession, SummaryCard, UserSettings, LorebookEntry, TableMemorySheet, CustomWorldbook } from "../types";
import { FALLBACK_MODEL, API_ENDPOINT, TRIAL_OPENROUTER_KEY } from "../utils/apiClient";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../defaults/suggestionsPrompt";
import { readSSEStream, safeParseSSEData } from "../utils/streamReader";
import FormattedText from "../components/FormattedText";
import { notifyVariablesUpdated } from "../utils/tavernHelperBridge";
import { globalKernel } from "../kernel";
import {
  IDatabaseService,
  ILLMService,
  IPromptService,
  ITelemetryService,
  ITableMemoryService,
  IScriptService,
  IAutoSummaryService,
  IMultiMessageService,
  IChatStreamService,
  OutputPipelineContext
} from "../kernel/types";
import {
  extractThinkContent,
  cleanSuggestionsFromText,
  parseSuggestions,
  calculateBisonModeProbability,
} from "./useChat/helpers";

// 重新导出 calculateBisonModeProbability 以保持向后兼容
export { calculateBisonModeProbability } from "./useChat/helpers";

const generateUniqueId = (prefix: string): string => {
  return prefix + Math.random().toString(36).substring(2, 9);
};







export const useChat = (
  settings: UserSettings,
  globalLorebook: LorebookEntry[],
  chatBottomRef: React.RefObject<HTMLDivElement | null>,
  customWorldbooks: Record<string, CustomWorldbook>
) => {
  const { showCustomAlert, showCustomConfirm, showCustomPrompt, setActiveTab } = useApp();
  const { characters, activeCharId, setActiveCharId, activeCharacter } = useCharactersState();
  const {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    isSending,
    setIsSending,
    saveSession,
    deleteSession,
    isSummarizing,
    setIsSummarizing,
  } = useChatState();

  // Retrieve microservices from the Kernel singleton
  const databaseService = globalKernel.getService<IDatabaseService>("database");
  const promptService = globalKernel.getService<IPromptService>("prompt");
  const telemetryService = globalKernel.getService<ITelemetryService>("telemetry");
  const chatStreamService = globalKernel.getService<IChatStreamService>("chatStream");
  const multiMessageService = globalKernel.getService<IMultiMessageService>("multiMessage");

  const sessionsRef = React.useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSessionIdRef = React.useRef(activeSessionId);
  const activeCharIdRef = React.useRef(activeCharId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    activeCharIdRef.current = activeCharId;
  }, [activeCharId]);

  // Local Chat / Timeline UI States
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [chatSubTab, setChatSubTab] = useState<"dialogue" | "timeline">("dialogue");

  useEffect(() => {
    setShowFullHistory(false);
  }, [activeSessionId]);

  const [replySuggestions, setReplySuggestions] = useState<string[]>([]);

  // Load suggestions from the last message in the active session
  useEffect(() => {
    if (activeSession && activeSession.messages.length > 0) {
      const lastMsg = activeSession.messages[activeSession.messages.length - 1];
      if (lastMsg.sender === "assistant" && lastMsg.extra?.suggestions) {
        setReplySuggestions(lastMsg.extra.suggestions);
      } else {
        setReplySuggestions([]);
      }
    } else {
      setReplySuggestions([]);
    }
  }, [activeSessionId, activeSession]);

  // Message Input & Forms state
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isSendingRef = React.useRef(false);
  const activeRequestIdRef = React.useRef(0);
  const pendingUpdateTimeoutRef = React.useRef<any>(null);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isSendingRef.current = false;
    setIsSending(false);
    bisonRemainingCountRef.current = 0;
    setIsBisonLocking(false);
  }, [setIsSending]);

  const [userInputMessage, setUserInputMessage] = useState("");
  const draftsRef = React.useRef<Record<string, string>>({});
  const userInputMessageRef = React.useRef(userInputMessage);
  useEffect(() => {
    userInputMessageRef.current = userInputMessage;
  }, [userInputMessage]);

  const [isBisonLocking, setIsBisonLocking] = useState(false);
  const bisonRemainingCountRef = React.useRef<number>(0);

  const prevSessionIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current;
    const currentSessionId = activeSessionId;
    if (prevSessionId && prevSessionId !== currentSessionId) {
      draftsRef.current[prevSessionId] = userInputMessageRef.current;
    }
    if (currentSessionId) {
      setUserInputMessage(draftsRef.current[currentSessionId] || "");
    } else {
      setUserInputMessage("");
    }
    prevSessionIdRef.current = currentSessionId;
  }, [activeSessionId]);

  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");
  const [msgMenuId, setMsgMenuId] = useState<string | null>(null);

  // Timeline Memory creation state
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [newSummaryTag, setNewSummaryTag] = useState("");
  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");
  const [newSummaryCondition, setNewSummaryCondition] = useState("");
  const [newSummaryInventory, setNewSummaryInventory] = useState("");
  const [newSummaryBonding, setNewSummaryBonding] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        isSendingRef.current = false;
        setIsSending(false);
      }
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
    };
  }, [setIsSending]);

  // Abort running stream if active character or active session changes
  useEffect(() => {
    if (abortControllerRef.current) {
      console.log("[useChat] Aborting streaming request because active character or active session changed");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [activeCharId, activeSessionId, setIsSending]);

  const triggerScroll = useCallback((behavior: "smooth" | "instant" | "auto" = "smooth") => {
    setTimeout(() => {
      if (chatBottomRef && chatBottomRef.current) {
        const container = chatBottomRef.current.parentElement;
        if (container) {
          if (behavior === "smooth") {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }
        } else {
          chatBottomRef.current.scrollIntoView({ behavior });
        }
      }
    }, 100);
  }, [chatBottomRef]);

  const handleStartNewSession = useCallback(async (customFirstMessage?: string) => {
    if (!activeCharacter) return;
    const starterMsg = customFirstMessage ?? activeCharacter.first_mes;

    const defaultGreetingSuggestions = `\n<suggestions>["继续对话", "打个招呼", "静观其变", "进行互动"]</suggestions>`;
    let finalStarterMsg = starterMsg;
    let initialSuggestions: string[] | undefined = undefined;

    if (starterMsg && settings.enableReplySuggestions) {
      if (starterMsg.includes("<suggestions>")) {
        const cleanedTextObj = cleanSuggestionsFromText(starterMsg);
        if (cleanedTextObj.suggestionsText) {
          initialSuggestions = parseSuggestions(cleanedTextObj.suggestionsText);
        }
      } else {
        finalStarterMsg = `${starterMsg.trim()}${defaultGreetingSuggestions}`;
        initialSuggestions = ["继续对话", "打个招呼", "静观其变", "进行互动"];
      }
    }

    try {
      const newSession = await databaseService.createNewSession(activeCharacter, finalStarterMsg, initialSuggestions);
      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSession.id);
      triggerScroll("instant");
    } catch (err: any) {
      console.error("Failed to save new session:", err);
    }
  }, [activeCharacter, settings, databaseService, setSessions, setActiveSessionId, triggerScroll]);

  const handleAutoSummaryCheck = useCallback(async (
    session: ChatSession,
    force: boolean = false,
    signal?: AbortSignal
  ) => {
    const autoSummaryService = globalKernel.getService<any>("autoSummary");
    try {
      setIsSummarizing(true);
      const updatedSession = await autoSummaryService.handleAutoSummaryCheck(
        session,
        settings,
        activeCharacter,
        force,
        signal
      );
      if (updatedSession !== session) {
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
        if (force) await showCustomAlert("记忆整理完毕，已收录至潜意识年表！");
      } else if (force) {
        await showCustomAlert("当前无需强制压缩。");
      }
    } catch (e: any) {
      if (e.name === "AbortError" || e.message === "AbortError") return;
      console.warn("Auto-compactor service bypassed or offline:", e);
      if (force) await showCustomAlert("记忆整理出错: " + e.message);
    } finally {
      setIsSummarizing(false);
    }
  }, [settings, activeCharacter, showCustomAlert, setSessions, setIsSummarizing]);

  const handleSendMessage = useCallback(async (textToSend: string, options?: { isBisonConsecutive?: boolean, skipAI?: boolean }) => {
    const isBisonConsecutive = !!options?.isBisonConsecutive;
    const skipAI = !!options?.skipAI;
    let isBisonChainActive = false;
    telemetryService.incrementUsageCount();
    setReplySuggestions([]);
    
    if (!isBisonConsecutive) {
      const hasUnsentUserMessages = activeSession && activeSession.messages.length > 0 && activeSession.messages[activeSession.messages.length - 1].sender === "user";
      if (
        (!textToSend || typeof textToSend !== "string" || !textToSend.trim()) &&
        !hasUnsentUserMessages
      ) {
        return;
      }
      if (
        isSending ||
        isSendingRef.current ||
        !activeCharacter ||
        !activeSession
      ) {
        return;
      }

      const modelToReport = settings.api.apiKey ? (settings.api.modelName || FALLBACK_MODEL) : "openrouter/free";
      telemetryService.reportUsage("send_message", {
        modelName: modelToReport,
        characterName: activeCharacter.name,
      });
    } else {
      if (!activeCharacter || !activeSession) {
        return;
      }
    }

    if (!isBisonConsecutive && activeSessionIdRef.current) {
      draftsRef.current[activeSessionIdRef.current] = "";
    }

    if (skipAI && !isBisonConsecutive && textToSend && textToSend.trim()) {
      try {
        const updatedSession = await multiMessageService.queueUserMessage(activeSession, textToSend);
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
      } catch (err: any) {
        console.error("Failed to save session user message:", err);
      }
      triggerScroll("smooth");
      return;
    }
    let finalApiKey = settings.api.apiKey;
    let finalBaseUrl = settings.api.baseUrl;
    let finalModel = settings.api.modelName || FALLBACK_MODEL;
    let finalChatPath = settings?.api?.chatPath;
    let isTrialMode = false;

    if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
      const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
      if (freeCount >= 10) {
        showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往“设置 -> API配置”中填写您自己的 API Key。");
        return;
      }
      isTrialMode = true;
      finalApiKey = TRIAL_OPENROUTER_KEY;
      finalBaseUrl = "https://openrouter.ai/api/v1";
      finalModel = "openrouter/free";
      finalChatPath = undefined;
    } else {
      if (!settings.api.modelName) {
        showCustomAlert(
          "对话失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。"
        );
        return;
      }
    }

    isSendingRef.current = true;
    setIsSending(true);

    const requestId = ++activeRequestIdRef.current;
    let updatedSession = activeSession;

    if (!isBisonConsecutive && textToSend && textToSend.trim()) {
      try {
        updatedSession = await multiMessageService.queueUserMessage(activeSession, textToSend);
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
      } catch (err: any) {
        console.error("Failed to save session user message:", err);
        isSendingRef.current = false;
        setIsSending(false);
        return;
      }
      triggerScroll("smooth");
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let isStreamActive = true;
    const responseChunks: string[] = [];
    const reasoningChunks: string[] = [];
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let isFirstToken = true;

    const updateSessionsContent = (content: string, reasoningContent?: string) => {
      const parsed = extractThinkContent(content, reasoningContent, true);
      const cleaned = cleanSuggestionsFromText(parsed.content);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: cleaned.content, reasoningContent: parsed.reasoningContent } : m
            ),
          };
        })
      );
    };

    const throttledUpdate = (content: string, reasoningContent?: string) => {
      if (!isStreamActive) return;
      const now = performance.now();
      if (isFirstToken) {
        isFirstToken = false;
        lastUpdateTime = now;
        updateSessionsContent(content, reasoningContent);
        return;
      }

      if (now - lastUpdateTime >= 60) {
        if (pendingUpdateTimeoutRef.current) {
          clearTimeout(pendingUpdateTimeoutRef.current);
          pendingUpdateTimeoutRef.current = null;
        }
        lastUpdateTime = now;
        updateSessionsContent(content, reasoningContent);
      } else if (!pendingUpdateTimeoutRef.current) {
        pendingUpdateTimeoutRef.current = setTimeout(() => {
          pendingUpdateTimeoutRef.current = null;
          if (!isStreamActive) return;
          lastUpdateTime = performance.now();
          updateSessionsContent(responseChunks.join(""), reasoningChunks.join(""));
        }, 60 - (now - lastUpdateTime));
      }
    };

    try {
      const otherCharGlobals = characters
        .filter((c) => c.isWorldbookGlobal && c.id !== activeCharacter.id)
        .flatMap((c) => c.lorebookEntries || []);

      const customWorldbookGlobals = Object.values(customWorldbooks || {})
        .filter((wb) => wb.enabled)
        .flatMap((wb) => wb.entries || []);

      const combinedGlobals = [
        ...(globalLorebook || []),
        ...otherCharGlobals,
        ...customWorldbookGlobals,
      ];

      const promptPayload = promptService.assemblePrompt({
        character: activeCharacter,
        chat: updatedSession,
        userInput: isBisonConsecutive ? "" : textToSend,
        settings,
        globalLorebook: combinedGlobals,
      });

      let tokenUsage = { prompt: 0, completion: 0 };
      const startTime = performance.now();
      let isFirstToken = true;
      let ttftMs = 0;

      const placeholderAiMsg: Message = {
        id: aiMsgId,
        sender: "assistant",
        content: "💭...",
        timestamp: Date.now(),
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === updatedSession.id) {
            return { ...s, messages: [...s.messages, placeholderAiMsg] };
          }
          return s;
        })
      );

      const stream = chatStreamService.streamLlmResponse({
        baseUrl: finalBaseUrl,
        apiKey: finalApiKey,
        chatPath: finalChatPath,
        bypassProxy: settings.api.bypassProxy,
        reqBody: {
          model: finalModel,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            {
              role: "system",
              content: [promptPayload.systemInstruction, promptPayload.dynamicInstruction]
                .filter(Boolean)
                .join("\n\n"),
            },
            ...promptPayload.history.map((h: any, idx: number) => {
              const msgObj: any = {
                role: h.role === "model" ? "assistant" : h.role,
                content: h.content,
              };
              if (h.name) {
                msgObj.name = h.name;
              }
              return msgObj;
            }),
          ],
          temperature: settings.preset.temperature,
          top_p: settings.preset.topP,
          top_k: settings.preset.topK,
          min_p: settings.preset.minP,
          max_tokens: isBisonConsecutive ? 300 : settings.preset.maxTokens,
          max_completion_tokens: isBisonConsecutive ? 300 : settings.preset.maxTokens,
          presence_penalty: settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: settings.preset.repetitionPenalty,
        },
        signal: controller.signal
      });

      for await (const chunk of stream) {
        if (chunk.__rescuedContent) {
          responseChunks.push(chunk.__rescuedContent);
        } else {
          const reasoning = chunk.choices?.[0]?.delta?.reasoning_content;
          const delta = chunk.choices?.[0]?.delta?.content;

          if (reasoning && !delta) {
            reasoningChunks.push(reasoning);
          } else if (delta) {
            responseChunks.push(delta);
            if (isFirstToken) {
              isFirstToken = false;
              ttftMs = performance.now() - startTime;
            }
          }
          if (chunk.usage) {
            tokenUsage = {
              prompt: chunk.usage.prompt_tokens || 0,
              completion: chunk.usage.completion_tokens || 0,
            };
          }
        }

        throttledUpdate(responseChunks.join(""), reasoningChunks.join(""));
      }

      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }

      const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) {
        console.warn("Aborted session save because it was deleted during generation:", updatedSession.id);
        return;
      }

      const responseText = responseChunks.join("");
      const reasoningText = reasoningChunks.join("");
      const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
      const cleaned = cleanSuggestionsFromText(parsed.content);
      let suggestions: string[] = [];
      if (settings.enableReplySuggestions && cleaned.suggestionsText) {
        suggestions = parseSuggestions(cleaned.suggestionsText);
      }

      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant" as const,
        content: settings.enableReplySuggestions ? parsed.content : cleaned.content,
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
        reasoningContent: parsed.reasoningContent || undefined,
        extra: {
          ...(latestSession.messages.find(m => m.id === aiMsgId)?.extra || {}),
          suggestions: suggestions.length > 0 ? suggestions : undefined
        }
      };

      let finalMessages = [...latestSession.messages];
      const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
      if (placeholderIdx >= 0) {
        finalMessages[placeholderIdx] = finalAiMsg;
      } else {
        finalMessages.push(finalAiMsg);
      }

      const trueFinalSession = {
        ...latestSession,
        messages: finalMessages,
      };

      const isStillActive = activeSessionIdRef.current === updatedSession.id;
      if (isStillActive) {
        // Run Output Pipeline
        const outputCtx: OutputPipelineContext = {
          session: trueFinalSession,
          responseText: parsed.content,
          reasoningText: parsed.reasoningContent || "",
          settings,
          activeCharacter,
          controller,
          isStillActive,
          isBisonConsecutive,
          bisonRemainingCount: bisonRemainingCountRef.current
        };

        await globalKernel.getPipeline("output").execute(outputCtx);

        const parsedSession = outputCtx.resultSession || trueFinalSession;
        await databaseService.saveSession(parsedSession);

        setSessions((prev) =>
          prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
        );
        triggerScroll("smooth");

        if (isTrialMode) {
          const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
          localStorage.setItem("mobile_tavern_free_trial_count", String(freeCount + 1));
        }

        if (outputCtx.shouldTriggerBison) {
          bisonRemainingCountRef.current = outputCtx.nextBisonRemainingCount ?? 0;
          isBisonChainActive = true;
          setIsBisonLocking(true);

          setTimeout(() => {
            handleSendMessage("", { isBisonConsecutive: true }).catch((err) => {
              console.error("Failed in bison consecutive send:", err);
            });
          }, 500);
        } else {
          bisonRemainingCountRef.current = 0;
          setIsBisonLocking(false);
        }
      } else {
        await databaseService.saveSession(trueFinalSession);
        console.log("[useChat] Session switched during generation, saved silently to IndexedDB:", updatedSession.id);
      }
    } catch (err: any) {
      const responseText = responseChunks.join("");
      bisonRemainingCountRef.current = 0;
      setIsBisonLocking(false);
      if (requestId !== activeRequestIdRef.current) return;
      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      const isManualAbort = err.name === "AbortError" || err.message?.includes("aborted") || controller.signal.aborted;
      const isStillActive = activeSessionIdRef.current === updatedSession.id;

      if (isManualAbort) {
        if (responseText.trim().length > 0) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: parsed.content,
            timestamp: Date.now(),
            reasoningContent: parsed.reasoningContent,
          };
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            let finalMessages = [...latestSession.messages];
            const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
            if (placeholderIdx >= 0) {
              finalMessages[placeholderIdx] = finishedAiMsg;
            } else {
              finalMessages.push(finishedAiMsg);
            }
            const trueFinalSession = {
              ...latestSession,
              messages: finalMessages,
            };
            try {
              if (isStillActive) {
                const outputCtx: OutputPipelineContext = {
                  session: trueFinalSession,
                  responseText: parsed.content,
                  reasoningText: parsed.reasoningContent || "",
                  settings,
                  activeCharacter,
                  controller,
                  isStillActive,
                  isBisonConsecutive: false,
                  bisonRemainingCount: 0
                };
                await globalKernel.getPipeline("output").execute(outputCtx);
                const parsedSession = outputCtx.resultSession || trueFinalSession;
                await databaseService.saveSession(parsedSession);
                setSessions((prev) =>
                  prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
                );
              } else {
                await databaseService.saveSession(trueFinalSession);
                console.log("[useChat] Session switched during abort, saved silently to IndexedDB:", updatedSession.id);
              }
            } catch (saveErr) {
              console.error("Failed to save aborted session message:", saveErr);
            }
          }
        } else {
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            const nextSession = {
              ...latestSession,
              messages: latestSession.messages.filter((m) => m.id !== aiMsgId),
            };
            if (isStillActive) {
              setSessions((prev) =>
                prev.map((s) => (s.id === nextSession.id ? nextSession : s))
              );
            }
            try {
              await databaseService.saveSession(nextSession);
            } catch (saveErr) {
              console.error("Failed to save session after filtering placeholder:", saveErr);
            }
          }
        }
      } else {
        if (isStillActive) {
          showCustomAlert("发送失败，对话连接异常: " + err.message);
        }
        if (responseText.trim().length > 0) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: parsed.content ? parsed.content + "\n\n*(连接中断，仅保留部分生成内容)*" : "\n\n*(连接中断，仅保留部分生成内容)*",
            timestamp: Date.now(),
            reasoningContent: parsed.reasoningContent,
          };
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            let finalMessages = [...latestSession.messages];
            const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
            if (placeholderIdx >= 0) {
              finalMessages[placeholderIdx] = finishedAiMsg;
            } else {
              finalMessages.push(finishedAiMsg);
            }
            const trueFinalSession = {
              ...latestSession,
              messages: finalMessages,
            };
            try {
              if (isStillActive) {
                const outputCtx: OutputPipelineContext = {
                  session: trueFinalSession,
                  responseText: parsed.content,
                  reasoningText: parsed.reasoningContent || "",
                  settings,
                  activeCharacter,
                  controller,
                  isStillActive,
                  isBisonConsecutive: false,
                  bisonRemainingCount: 0
                };
                await globalKernel.getPipeline("output").execute(outputCtx);
                const parsedSession = outputCtx.resultSession || trueFinalSession;
                await databaseService.saveSession(parsedSession);
                setSessions((prev) =>
                  prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
                );
              } else {
                await databaseService.saveSession(trueFinalSession);
                console.log("[useChat] Session switched during error saving, saved silently to IndexedDB:", updatedSession.id);
              }
            } catch (saveErr) {
              console.error("Failed to save error session message:", saveErr);
            }
          }
        } else {
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            const nextSession = {
              ...latestSession,
              messages: latestSession.messages.filter((m) => m.id !== aiMsgId),
            };
            if (isStillActive) {
              setSessions((prev) =>
                prev.map((s) => (s.id === nextSession.id ? nextSession : s))
              );
            }
            try {
              await databaseService.saveSession(nextSession);
            } catch (saveErr) {
              console.error("Failed to save session after filtering placeholder on error:", saveErr);
            }
          }
        }
      }
    } finally {
      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (requestId === activeRequestIdRef.current) {
        const isBisonScheduled = settings.enableBisonMode && (bisonRemainingCountRef.current > 0 || isBisonChainActive);
        if (!isBisonScheduled) {
          isSendingRef.current = false;
          setIsSending(false);
          setIsBisonLocking(false);
        }
      }
    }
  }, [
    activeCharacter,
    activeSession,
    settings,
    characters,
    globalLorebook,
    customWorldbooks,
    setSessions,
    databaseService,
    triggerScroll,
    showCustomAlert,
    chatStreamService,
    telemetryService,
    multiMessageService,
    promptService
  ]);

  const handleRerollFromMessage = useCallback(async (targetMsg: Message) => {
    setReplySuggestions([]);
    if (!targetMsg || !targetMsg.id || isSendingRef.current || !activeCharacter || !activeSession) return;

    let finalApiKey = settings.api.apiKey;
    let finalBaseUrl = settings.api.baseUrl;
    let finalModel = settings.api.modelName || FALLBACK_MODEL;
    let finalChatPath = settings?.api?.chatPath;
    let isTrialMode = false;

    if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
      const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
      if (freeCount >= 10) {
        showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往“设置 -> API配置”中填写您自己的 API Key。");
        return;
      }
      isTrialMode = true;
      finalApiKey = TRIAL_OPENROUTER_KEY;
      finalBaseUrl = "https://openrouter.ai/api/v1";
      finalModel = "openrouter/free";
      finalChatPath = undefined;
    } else {
      if (!settings.api.modelName) {
        await showCustomAlert("重发失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        return;
      }
    }

    const requestId = ++activeRequestIdRef.current;

    const cleanHistory = activeSession.messages.filter(
      (m) => !(m.sender === "assistant" && (m.content === "💭..." || !m.content))
    );
    const msgs = cleanHistory;
    const targetIdx = msgs.findIndex((m) => m.id === targetMsg.id);
    if (targetIdx === -1) return;

    if (targetIdx < msgs.length - 1) {
      const ok = await showCustomConfirm(
        "从该条对白开始重新生成，将会抹除整条分支此后的所有对话。确认继续吗？"
      );
      if (!ok) return;
    }

    const nextMsgsIdx = targetMsg.sender === "user" ? targetIdx + 1 : targetIdx;
    const nextMsgs = msgs.slice(0, nextMsgsIdx);

    while (
      nextMsgs.length > 0 &&
      (nextMsgs[nextMsgs.length - 1].sender === "system" ||
       nextMsgs[nextMsgs.length - 1].sender === "assistant")
    ) {
      nextMsgs.pop();
    }

    if (nextMsgs.length === 0) {
      await showCustomAlert("无可用的历史对话上下文来进行重新生成！");
      return;
    }

    const lastMsgNow = nextMsgs[nextMsgs.length - 1];
    if (lastMsgNow.sender !== "user") {
      await showCustomAlert("重新生成回复之前，需要前置有一条用户消息作为驱动对白！");
      return;
    }

    isSendingRef.current = true;
    setIsSending(true);

    const modelToReport = settings.api.apiKey ? (settings.api.modelName || FALLBACK_MODEL) : "openrouter/free";
    telemetryService.reportUsage("regenerate_message", {
      modelName: modelToReport,
      characterName: activeCharacter.name,
    });

    const lastUserText = lastMsgNow.content;
    const updatedSession = { ...activeSession, messages: nextMsgs };
    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await databaseService.saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save session for reroll:", err);
      isSendingRef.current = false;
      setIsSending(false);
      return;
    }
    triggerScroll();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let isStreamActive = true;
    const responseChunks: string[] = [];
    const reasoningChunks: string[] = [];
    let tokenUsage = { prompt: 0, completion: 0 };
    const startTime = performance.now();
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let isFirstToken = true;
    let isFirstTokenForSpeed = true;
    let ttftMs = 0;

    const updateSessionsContent = (content: string, reasoningContent?: string) => {
      const parsed = extractThinkContent(content, reasoningContent, true);
      const cleaned = cleanSuggestionsFromText(parsed.content);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: cleaned.content, reasoningContent: parsed.reasoningContent } : m
            ),
          };
        })
      );
    };

    const throttledUpdate = (content: string, reasoningContent?: string) => {
      if (!isStreamActive) return;
      const now = performance.now();
      if (isFirstToken) {
        isFirstToken = false;
        lastUpdateTime = now;
        updateSessionsContent(content, reasoningContent);
        return;
      }

      if (now - lastUpdateTime >= 60) {
        if (pendingUpdateTimeoutRef.current) {
          clearTimeout(pendingUpdateTimeoutRef.current);
          pendingUpdateTimeoutRef.current = null;
        }
        lastUpdateTime = now;
        updateSessionsContent(content, reasoningContent);
      } else if (!pendingUpdateTimeoutRef.current) {
        pendingUpdateTimeoutRef.current = setTimeout(() => {
          pendingUpdateTimeoutRef.current = null;
          if (!isStreamActive) return;
          lastUpdateTime = performance.now();
          updateSessionsContent(responseChunks.join(""), reasoningChunks.join(""));
        }, 60 - (now - lastUpdateTime));
      }
    };

    try {
      const otherCharGlobals = characters
        .filter((c) => c.isWorldbookGlobal && c.id !== activeCharacter.id)
        .flatMap((c) =>
          (c.lorebookEntries || []).map((entry) => ({
            ...entry,
            content: `[来自世界书: ${c.name}]\n${entry.content}`,
          }))
        );

      const customWorldbookGlobals = Object.values(customWorldbooks || {})
        .filter((wb) => wb.enabled)
        .flatMap((wb) =>
          (wb.entries || []).map((entry) => ({
            ...entry,
            content: `[来自世界书: ${wb.name}]\n${entry.content}`,
          }))
        );

      const combinedGlobals = [
        ...(globalLorebook || []),
        ...otherCharGlobals,
        ...customWorldbookGlobals,
      ];

      const promptPayload = promptService.assemblePrompt({
        character: activeCharacter,
        chat: updatedSession,
        userInput: lastUserText,
        settings,
        globalLorebook: combinedGlobals,
      });

      const placeholderAiMsg: Message = {
        id: aiMsgId,
        sender: "assistant",
        content: "💭...",
        timestamp: Date.now(),
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === updatedSession.id)
            return { ...s, messages: [...s.messages, placeholderAiMsg] };
          return s;
        })
      );

      const stream = chatStreamService.streamLlmResponse({
        baseUrl: finalBaseUrl,
        apiKey: finalApiKey,
        chatPath: finalChatPath,
        bypassProxy: settings.api.bypassProxy,
        reqBody: {
          model: finalModel,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            {
              role: "system",
              content: [promptPayload.systemInstruction, promptPayload.dynamicInstruction]
                .filter(Boolean)
                .join("\n\n"),
            },
            ...promptPayload.history.map((h: any, idx: number) => {
              const msgObj: any = {
                role: h.role === "model" ? "assistant" : h.role,
                content: h.content,
              };
              if (h.name) {
                msgObj.name = h.name;
              }
              return msgObj;
            }),
          ],
          temperature: settings.preset.temperature,
          top_p: settings.preset.topP,
          top_k: settings.preset.topK,
          min_p: settings.preset.minP,
          max_tokens: settings.preset.maxTokens,
          max_completion_tokens: settings.preset.maxTokens,
          presence_penalty: settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: settings.preset.repetitionPenalty,
        },
        signal: controller.signal
      });

      for await (const chunk of stream) {
        if (chunk.__rescuedContent) {
          responseChunks.push(chunk.__rescuedContent);
        } else {
          const reasoning = chunk.choices?.[0]?.delta?.reasoning_content;
          const delta = chunk.choices?.[0]?.delta?.content;

          if (reasoning && !delta) {
            reasoningChunks.push(reasoning);
          } else if (delta) {
            responseChunks.push(delta);
            if (isFirstTokenForSpeed) {
              isFirstTokenForSpeed = false;
              ttftMs = performance.now() - startTime;
            }
          }
          if (chunk.usage) {
            tokenUsage = {
              prompt: chunk.usage.prompt_tokens || 0,
              completion: chunk.usage.completion_tokens || 0,
            };
          }
        }

        throttledUpdate(responseChunks.join(""), reasoningChunks.join(""));
      }

      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }

      const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) {
        console.warn("Aborted session save because it was deleted during generation:", updatedSession.id);
        return;
      }

      const responseText = responseChunks.join("");
      const reasoningText = reasoningChunks.join("");
      const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
      const cleaned = cleanSuggestionsFromText(parsed.content);
      let suggestions: string[] = [];
      if (settings.enableReplySuggestions && cleaned.suggestionsText) {
        suggestions = parseSuggestions(cleaned.suggestionsText);
      }

      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant" as const,
        content: settings.enableReplySuggestions ? parsed.content : cleaned.content,
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
        reasoningContent: parsed.reasoningContent || undefined,
        extra: {
          ...(latestSession.messages.find(m => m.id === aiMsgId)?.extra || {}),
          suggestions: suggestions.length > 0 ? suggestions : undefined
        }
      };

      let finalMessages = [...latestSession.messages];
      const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
      if (placeholderIdx >= 0) {
        finalMessages[placeholderIdx] = finalAiMsg;
      } else {
        finalMessages.push(finalAiMsg);
      }

      const trueFinalSession = {
        ...latestSession,
        messages: finalMessages,
      };

      const isStillActive = activeSessionIdRef.current === updatedSession.id;
      if (isStillActive) {
        const outputCtx: OutputPipelineContext = {
          session: trueFinalSession,
          responseText: parsed.content,
          reasoningText: parsed.reasoningContent || "",
          settings,
          activeCharacter,
          controller,
          isStillActive,
          isBisonConsecutive: false,
          bisonRemainingCount: 0
        };

        await globalKernel.getPipeline("output").execute(outputCtx);

        const parsedSession = outputCtx.resultSession || trueFinalSession;
        await databaseService.saveSession(parsedSession);

        setSessions((prev) =>
          prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
        );
        triggerScroll();

        if (isTrialMode) {
          const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
          localStorage.setItem("mobile_tavern_free_trial_count", String(freeCount + 1));
        }
      } else {
        await databaseService.saveSession(trueFinalSession);
        console.log("[useChat] Session switched during reroll, saved silently to IndexedDB:", updatedSession.id);
      }
    } catch (e: any) {
      const responseText = responseChunks.join("");
      if (requestId !== activeRequestIdRef.current) return;
      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      const isManualAbort = e.name === "AbortError" || e.message?.includes("aborted") || controller.signal.aborted;
      const isStillActive = activeSessionIdRef.current === updatedSession.id;

      if (isManualAbort) {
        if (responseText.trim().length > 0) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: parsed.content,
            timestamp: Date.now(),
            reasoningContent: parsed.reasoningContent,
          };
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            let finalMessages = [...latestSession.messages];
            const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
            if (placeholderIdx >= 0) {
              finalMessages[placeholderIdx] = finishedAiMsg;
            } else {
              finalMessages.push(finishedAiMsg);
            }
            const trueFinalSession = {
              ...latestSession,
              messages: finalMessages,
            };
            try {
              if (isStillActive) {
                const outputCtx: OutputPipelineContext = {
                  session: trueFinalSession,
                  responseText: parsed.content,
                  reasoningText: parsed.reasoningContent || "",
                  settings,
                  activeCharacter,
                  controller,
                  isStillActive,
                  isBisonConsecutive: false,
                  bisonRemainingCount: 0
                };
                await globalKernel.getPipeline("output").execute(outputCtx);
                const parsedSession = outputCtx.resultSession || trueFinalSession;
                await databaseService.saveSession(parsedSession);
                setSessions((prev) =>
                  prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
                );
              } else {
                await databaseService.saveSession(trueFinalSession);
                console.log("[useChat] Session switched during reroll abort, saved silently to IndexedDB:", updatedSession.id);
              }
            } catch (saveErr) {
              console.error("Failed to save aborted session message:", saveErr);
            }
          }
        } else {
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            const nextSession = {
              ...latestSession,
              messages: latestSession.messages.filter((m) => m.id !== aiMsgId),
            };
            if (isStillActive) {
              setSessions((prev) =>
                prev.map((s) => (s.id === nextSession.id ? nextSession : s))
              );
            }
            try {
              await databaseService.saveSession(nextSession);
            } catch (saveErr) {
              console.error("Failed to save session after filtering placeholder:", saveErr);
            }
          }
        }
      } else {
        if (isStillActive) {
          console.error("AI Regeneration failed:", e);
          telemetryService.reportUsage("api_error", {
            detail: String(e.message || "Unknown error"),
            playerName: settings.userName,
            characterName: activeCharacter.name,
            modelName: settings.api.modelName,
            sessionId: updatedSession.id,
          });
        }

        if (responseText.trim().length > 0) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: parsed.content ? parsed.content + "\n\n*(连接中断，仅保留部分生成内容)*" : "\n\n*(连接中断，仅保留部分生成内容)*",
            timestamp: Date.now(),
            reasoningContent: parsed.reasoningContent,
          };
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            let finalMessages = [...latestSession.messages];
            const placeholderIdx = finalMessages.findIndex((m) => m.id === aiMsgId);
            if (placeholderIdx >= 0) {
              finalMessages[placeholderIdx] = finishedAiMsg;
            } else {
              finalMessages.push(finishedAiMsg);
            }
            const trueFinalSession = {
              ...latestSession,
              messages: finalMessages,
            };
            try {
              if (isStillActive) {
                const outputCtx: OutputPipelineContext = {
                  session: trueFinalSession,
                  responseText: parsed.content,
                  reasoningText: parsed.reasoningContent || "",
                  settings,
                  activeCharacter,
                  controller,
                  isStillActive,
                  isBisonConsecutive: false,
                  bisonRemainingCount: 0
                };
                await globalKernel.getPipeline("output").execute(outputCtx);
                const parsedSession = outputCtx.resultSession || trueFinalSession;
                await databaseService.saveSession(parsedSession);
                setSessions((prev) =>
                  prev.map((s) => (s.id === parsedSession.id ? parsedSession : s))
                );
              } else {
                await databaseService.saveSession(trueFinalSession);
                console.log("[useChat] Session switched during reroll error, saved silently to IndexedDB:", updatedSession.id);
              }
            } catch (saveErr) {
              console.error("Failed to save error session message:", saveErr);
            }
          }
        } else {
          const errorMsg: Message = {
            id: generateUniqueId("msg_err_"),
            sender: "system",
            content: `【连接错误】重新生成失败。请检查端口或API秘钥状态。详细错误: ${e.message}`,
            timestamp: Date.now(),
          };
          const latestSession = sessionsRef.current.find((s) => s.id === updatedSession.id);
          if (latestSession) {
            const finalMessages = latestSession.messages
              .filter((m) => m.id !== aiMsgId)
              .concat(errorMsg);
            const finalSession = {
              ...latestSession,
              messages: finalMessages,
            };
            if (isStillActive) {
              setSessions((prev) =>
                prev.map((s) => (s.id === finalSession.id ? finalSession : s))
              );
            }
            try {
              await databaseService.saveSession(finalSession);
            } catch (saveErr) {
              console.error("Failed to save error session message:", saveErr);
            }
          }
        }
        if (isStillActive) {
          triggerScroll();
        }
      }
    } finally {
      isStreamActive = false;
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (requestId === activeRequestIdRef.current) {
        isSendingRef.current = false;
        setIsSending(false);
      }
    }
  }, [
    activeCharacter,
    activeSession,
    settings,
    characters,
    globalLorebook,
    customWorldbooks,
    setSessions,
    databaseService,
    triggerScroll,
    showCustomConfirm,
    showCustomAlert,
    chatStreamService,
    telemetryService,
    promptService
  ]);

  const handleRerollLast = useCallback(async () => {
    if (!activeSession || activeSession.messages.length === 0) return;
    const msgs = activeSession.messages;
    let lastAiMsg: Message | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender === "assistant") {
        lastAiMsg = msgs[i];
        break;
      }
    }
    if (!lastAiMsg) {
      await showCustomAlert("对话中尚未存在可供重新生成的智能回复对话！");
      return;
    }
    await handleRerollFromMessage(lastAiMsg);
  }, [activeSession, showCustomAlert, handleRerollFromMessage]);

  const createNewBranch = useCallback(async () => {
    if (!activeCharId) return;
    if (isSending || isSendingRef.current) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建新分支。");
      return;
    }
    const branchTitle = await showCustomPrompt(
      "请输入全新独立分支存档名称:",
      `${activeCharacter?.name} - 新分支线 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;

    try {
      const newSession = await databaseService.createEmptyBranch(activeCharacter, branchTitle);
      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSession.id);
      setShowSessionManager(false);
    } catch (err: any) {
      console.error("Failed to save new branch session:", err);
    }
  }, [isSending, activeCharId, activeCharacter, showCustomPrompt, showCustomAlert, databaseService, setSessions, setActiveSessionId, setShowSessionManager]);

  const deleteBranch = useCallback(async (id: string) => {
    if (isSending || isSendingRef.current) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再删除分支。");
      return;
    }
    const confirm = await showCustomConfirm("确定要永久删除这个聊天分支吗？(无法恢复)");
    if (!confirm) return;

    try {
      await deleteSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        const charRemaining = remaining
          .filter((s) => s.characterId === activeCharId)
          .sort((a, b) => {
            const aLastMsg = a.messages && a.messages.length > 0 ? a.messages[a.messages.length - 1] : null;
            const aTime = aLastMsg ? (aLastMsg.timestamp || a.createdAt) : a.createdAt;
            const bLastMsg = b.messages && b.messages.length > 0 ? b.messages[b.messages.length - 1] : null;
            const bTime = bLastMsg ? (bLastMsg.timestamp || b.createdAt) : b.createdAt;
            return bTime - aTime;
          });
        if (charRemaining.length > 0) {
          setActiveSessionId(charRemaining[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
      setSessions(remaining);
    } catch (err: any) {
      console.error("Failed to delete branch session:", err);
    }
  }, [isSending, showCustomAlert, showCustomConfirm, deleteSession, activeSessionId, activeCharId, setActiveSessionId, setSessions, sessions]);

  const selectCharacter = useCallback(async (charId: string) => {
    if (isSending) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再切换角色卡。");
      return;
    }
    const loadStartTime = performance.now();
    try {
      setActiveCharId(charId);

      const charSessions = sessions.filter((s) => s.characterId === charId);
      if (charSessions.length > 0) {
        const lastSession = charSessions.sort((a, b) => {
          const aLastMsg = a.messages && a.messages.length > 0 ? a.messages[a.messages.length - 1] : null;
          const aTime = aLastMsg ? (aLastMsg.timestamp || a.createdAt) : a.createdAt;
          const bLastMsg = b.messages && b.messages.length > 0 ? b.messages[b.messages.length - 1] : null;
          const bTime = bLastMsg ? (bLastMsg.timestamp || b.createdAt) : b.createdAt;
          return bTime - aTime;
        })[0];
        setActiveSessionId(lastSession.id);
      } else {
        const targetChar = characters.find((c) => c.id === charId);
        const newSession = await databaseService.createNewSession(targetChar, targetChar?.first_mes);
        setSessions((prev) => [...prev, newSession]);
        setActiveSessionId(newSession.id);
      }
      setActiveTab("chat");
      setChatSubTab("dialogue");
      triggerScroll();
    } finally {
      const duration = performance.now() - loadStartTime;
      try {
        telemetryService.reportUsage("performance_chat_load", {
          detail: "Chat session load completed",
          generationTime: duration,
        });
      } catch (telemetryErr) {
        console.warn("Failed to report chat load time telemetry:", telemetryErr);
      }
    }
  }, [
    isSending,
    showCustomAlert,
    setActiveCharId,
    sessions,
    characters,
    databaseService,
    setSessions,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    triggerScroll,
    telemetryService
  ]);

  const createBacktrackBranch = useCallback(async (msg: Message) => {
    if (!activeCharacter || !activeSession) return;
    if (isSending || isSendingRef.current) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建分支。");
      return;
    }
    const branchTitle = await showCustomPrompt(
      "请输入新分支存档名称:",
      `${activeCharacter.name} - 故事分支分支于 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;

    try {
      const newSession = await databaseService.createBacktrackBranch(activeSession, branchTitle, msg.id);
      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSession.id);
      setMsgMenuId(null);
      setChatSubTab("dialogue");
      await showCustomAlert("分支故事线创建完美拉起！您已成功无痛回溯至选定对话时间轴。");
      triggerScroll();
    } catch (err: any) {
      console.error("Failed to save backtrack branch session:", err);
    }
  }, [
    isSending,
    activeCharacter,
    activeSession,
    showCustomPrompt,
    databaseService,
    setSessions,
    setActiveSessionId,
    setMsgMenuId,
    setChatSubTab,
    showCustomAlert,
    triggerScroll,
  ]);

  const createBacktrackFromTimeline = useCallback(async (summary: SummaryCard) => {
    if (!activeCharacter || !activeSession) return;
    if (isSending || isSendingRef.current) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建平行分支。");
      return;
    }
    const branchTitle = await showCustomPrompt(
      "请输入根据该幕历史创立的心宿分支标题:",
      `时间流分支: ${summary.timeTag}`
    );
    if (!branchTitle) return;

    try {
      const newSession = await databaseService.createBacktrackFromTimeline(activeSession, branchTitle, summary.id);
      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSession.id);
      setChatSubTab("dialogue");
      await showCustomAlert(`已基于时间线：“${summary.timeTag}” 重构分叉世界！`);
      triggerScroll();
    } catch (err: any) {
      console.error("Failed to save backtrack timeline session:", err);
    }
  }, [
    isSending,
    activeCharacter,
    activeSession,
    showCustomPrompt,
    databaseService,
    setSessions,
    setActiveSessionId,
    setChatSubTab,
    showCustomAlert,
    triggerScroll,
  ]);

  const handleAddTimelineSummary = useCallback(async () => {
    if (!newSummaryTag.trim() || !newSummaryContent.trim() || !activeSession) return;

    let updatedSummaries: SummaryCard[];
    if (editingSummaryId) {
      updatedSummaries = (activeSession.summaries || []).map((s) =>
        s.id === editingSummaryId
          ? {
              ...s,
              timeTag: newSummaryTag.trim(),
              location: newSummaryLoc.trim() || "未知地点",
              content: newSummaryContent.trim(),
              condition: newSummaryCondition.trim() || undefined,
              inventory: newSummaryInventory.trim() || undefined,
              bonding: newSummaryBonding.trim() || undefined,
            }
          : s
      );
    } else {
      const lastMsgId = activeSession.messages[activeSession.messages.length - 1]?.id;
      const newCard: SummaryCard = {
        id: generateUniqueId("summary_"),
        timeTag: newSummaryTag.trim(),
        location: newSummaryLoc.trim() || "未知地点",
        content: newSummaryContent.trim(),
        condition: newSummaryCondition.trim() || undefined,
        inventory: newSummaryInventory.trim() || undefined,
        bonding: newSummaryBonding.trim() || undefined,
        lastMessageId: lastMsgId,
      };
      updatedSummaries = [...(activeSession.summaries || []), newCard];
    }

    const updatedSession = {
      ...activeSession,
      summaries: updatedSummaries,
      lastSummarizedMessageId: editingSummaryId 
        ? activeSession.lastSummarizedMessageId 
        : (updatedSummaries[updatedSummaries.length - 1]?.lastMessageId || activeSession.lastSummarizedMessageId),
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await databaseService.saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save timeline summary:", err);
    }

    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
    setNewSummaryCondition("");
    setNewSummaryInventory("");
    setNewSummaryBonding("");
    setEditingSummaryId(null);
    setTimelineModalOpen(false);
  }, [
    newSummaryTag,
    newSummaryContent,
    newSummaryLoc,
    newSummaryCondition,
    newSummaryInventory,
    newSummaryBonding,
    activeSession,
    editingSummaryId,
    setSessions,
    databaseService,
    setNewSummaryTag,
    setNewSummaryLoc,
    setNewSummaryContent,
    setNewSummaryCondition,
    setNewSummaryInventory,
    setNewSummaryBonding,
    setEditingSummaryId,
    setTimelineModalOpen,
  ]);

  const renderDialogueBubble = useCallback((text: string, messageIndex?: number) => {
    return (
      <FormattedText
        text={text}
        charName={activeCharacter?.name || ""}
        userName={settings.userName}
        messageIndex={messageIndex}
      />
    );
  }, [activeCharacter, settings]);

  const chatHookValue = useMemo(() => ({
    handleSendMessage,
    handleStartNewSession,
    triggerScroll,
    showSessionManager,
    setShowSessionManager,
    showFullHistory,
    setShowFullHistory,
    chatSubTab,
    setChatSubTab,
    userInputMessage,
    setUserInputMessage,
    replySuggestions,
    setReplySuggestions,
    editingMsgId,
    setEditingMsgId,
    editingMsgContent,
    setEditingMsgContent,
    msgMenuId,
    setMsgMenuId,
    timelineModalOpen,
    setTimelineModalOpen,
    newSummaryTag,
    setNewSummaryTag,
    newSummaryLoc,
    setNewSummaryLoc,
    newSummaryContent,
    setNewSummaryContent,
    newSummaryCondition,
    setNewSummaryCondition,
    newSummaryInventory,
    setNewSummaryInventory,
    newSummaryBonding,
    setNewSummaryBonding,
    editingSummaryId,
    setEditingSummaryId,
    handleRerollFromMessage,
    handleRerollLast,
    handleAutoSummaryCheck,
    handleStopGeneration,
    createNewBranch,
    deleteBranch,
    selectCharacter,
    createBacktrackBranch,
    createBacktrackFromTimeline,
    handleAddTimelineSummary,
    renderDialogueBubble,
    saveSessionWithMvu: async (s: ChatSession) => {
      // 兼容接口，后置 pipeline 已经在 handleSendMessage/handleReroll 里替代了此操作
      await databaseService.saveSession(s);
      return s;
    },
    isBisonLocking,
  }), [
    handleSendMessage,
    handleStartNewSession,
    triggerScroll,
    showSessionManager,
    showFullHistory,
    chatSubTab,
    userInputMessage,
    replySuggestions,
    editingMsgId,
    editingMsgContent,
    msgMenuId,
    timelineModalOpen,
    newSummaryTag,
    newSummaryLoc,
    newSummaryContent,
    newSummaryCondition,
    newSummaryInventory,
    newSummaryBonding,
    editingSummaryId,
    handleRerollFromMessage,
    handleRerollLast,
    handleAutoSummaryCheck,
    handleStopGeneration,
    createNewBranch,
    deleteBranch,
    selectCharacter,
    createBacktrackBranch,
    createBacktrackFromTimeline,
    handleAddTimelineSummary,
    renderDialogueBubble,
    databaseService,
    isBisonLocking,
  ]);

  return chatHookValue;
};
