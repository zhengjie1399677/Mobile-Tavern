import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { Message, ChatSession, SummaryCard, UserSettings, LorebookEntry, TableMemorySheet } from "../types";
import { FALLBACK_MODEL, API_ENDPOINT } from "../utils/apiClient";
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
  IAutoSummaryService
} from "../kernel/types";

const generateUniqueId = (prefix: string): string => {
  return prefix + Math.random().toString(36).substring(2, 9);
};

function extractThinkContent(
  content: string, 
  reasoningContent?: string, 
  isStreaming: boolean = false
): { content: string; reasoningContent?: string } {
  if (!content) return { content, reasoningContent };
  
  const thinkStart = "<think>";
  const thinkEnd = "</think>";
  
  if (content.includes(thinkStart)) {
    const startIdx = content.indexOf(thinkStart);
    const endIdx = content.indexOf(thinkEnd);
    
    if (endIdx !== -1) {
      const extractedReasoning = content.substring(startIdx + thinkStart.length, endIdx).trim();
      const restContent = content.substring(endIdx + thinkEnd.length).trim();
      return {
        content: restContent,
        reasoningContent: extractedReasoning || reasoningContent
      };
    } else {
      const extractedReasoning = content.substring(startIdx + thinkStart.length).trim();
      return {
        content: isStreaming ? "💭..." : "",
        reasoningContent: extractedReasoning || reasoningContent
      };
    }
  }
  
  return { content, reasoningContent };
}


export const useChat = (
  settings: UserSettings,
  globalLorebook: LorebookEntry[],
  chatBottomRef: React.RefObject<HTMLDivElement | null>
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
  const llmService = globalKernel.getService<ILLMService>("llm");
  const promptService = globalKernel.getService<IPromptService>("prompt");
  const telemetryService = globalKernel.getService<ITelemetryService>("telemetry");
  const tableMemoryService = globalKernel.getService<ITableMemoryService>("tableMemory");
  const scriptService = globalKernel.getService<IScriptService>("script");
  const autoSummaryService = globalKernel.getService<IAutoSummaryService>("autoSummary");

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
  }, [setIsSending]);

  const [userInputMessage, setUserInputMessage] = useState("");
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

  const triggerScroll = useCallback((behavior: "smooth" | "instant" = "smooth") => {
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

    // Initialize MVU variables from character card extensions
    const mvuVariables = scriptService.initializeMvuFromCharacter(activeCharacter);

    const newSession: ChatSession = {
      id: generateUniqueId("session_"),
      characterId: activeCharacter.id,
      title: activeCharacter.name + " 的新会话",
      createdAt: Date.now(),
      messages: starterMsg
        ? [
            {
              id: generateUniqueId("msg_ai_"),
              sender: "assistant",
              content: starterMsg.trim(),
              timestamp: Date.now(),
              extra: {
                variables: {
                  0: mvuVariables
                }
              }
            },
          ]
        : [],
      summaries: [],
      variables: mvuVariables,
    };

    try {
      await saveSession(newSession);
      setActiveSessionId(newSession.id);
      triggerScroll("instant");
    } catch (err: any) {
      console.error("Failed to save new session:", err);
    }
  }, [activeCharacter, saveSession, setActiveSessionId, triggerScroll]);

  const handleAutoSummaryCheck = useCallback(async (
    session: ChatSession,
    force: boolean = false,
    signal?: AbortSignal
  ) => {
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

  const saveSessionWithMvu = useCallback(async (session: ChatSession, messageToParse?: string) => {
    const sessionExists = sessionsRef.current.some((s) => s.id === session.id);
    if (!sessionExists) {
      console.warn("[useChat] saveSessionWithMvu: Session was deleted during generation, skipping save:", session.id);
      return session;
    }
    let updatedSession = session;

    // 1. Initialize default table memory if enabled but not yet created
    let currentMemory = updatedSession.tableMemory || [];
    if (settings.enableTableMemory && currentMemory.length === 0 && activeCharacter) {
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
      updatedSession = {
        ...updatedSession,
        tableMemory: currentMemory
      };
    }

    // 2. Parse table actions & clean raw instructions to prevent printing pseudocode to UI
    if (messageToParse) {
      try {
        const { updatedMemory, cleanContent, hasChanges } = tableMemoryService.processTableMemory(
          currentMemory,
          messageToParse,
          activeCharacter || undefined
        );

        if (hasChanges || cleanContent !== messageToParse) {
          let updatedMessages = updatedSession.messages;
          if (updatedMessages.length > 0) {
            const lastMsg = { ...updatedMessages[updatedMessages.length - 1] } as any;
            if (lastMsg.sender === "assistant") {
              lastMsg.content = cleanContent;
              updatedMessages = [
                ...updatedMessages.slice(0, -1),
                lastMsg
              ];
            }
          }
          updatedSession = {
            ...updatedSession,
            tableMemory: updatedMemory,
            messages: updatedMessages
          };

          setSessions((prev) =>
            prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
          );
        }
      } catch (tableErr) {
        console.warn("[TableMemory] Failed to process table actions:", tableErr);
      }
    }

    // 3. Process standard MVU scripts
    if (settings.enableScriptExecution && messageToParse) {
      try {
        updatedSession = await scriptService.executeMvuScript(updatedSession, messageToParse);
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
      } catch (e) {
        console.warn("Failed to parse MVU message:", e);
      }
    }

    await saveSession(updatedSession);
    return updatedSession;
  }, [settings.enableScriptExecution, settings.enableTableMemory, activeCharacter, saveSession, setSessions]);


  const handleSendMessage = useCallback(async (textToSend: string) => {
    telemetryService.incrementUsageCount();
    if (
      !textToSend ||
      typeof textToSend !== "string" ||
      !textToSend.trim() ||
      isSending ||
      isSendingRef.current ||
      !activeCharacter ||
      !activeSession
    ) {
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
      finalApiKey = [41,49,119,53,40,119,44,107,119,107,60,111,98,105,107,104,104,60,98,60,59,109,98,98,60,56,57,109,111,99,57,110,63,109,110,111,56,108,111,105,105,60,63,106,60,59,63,104,111,99,110,56,56,108,57,99,99,109,105,109,107,59,108,104,63,109,110,105,105,108,56,110,59].map(c => String.fromCharCode(c ^ 0x5A)).join("");
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

    const userMsg: Message = {
      id: "msg_user_" + Math.random().toString(36).substring(2, 9),
      sender: "user",
      content: textToSend.trim(),
      timestamp: Date.now(),
    };

    const cleanHistory = activeSession.messages.filter(
      (m) => !(m.sender === "assistant" && (m.content === "💭..." || !m.content))
    );
    const updatedMessages = [...cleanHistory, userMsg];
    const updatedSession = { ...activeSession, messages: updatedMessages };

    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save session user message:", err);
      isSendingRef.current = false;
      setIsSending(false);
      return;
    }
    triggerScroll("smooth");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let isStreamActive = true;
    let responseText = "";
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let isFirstToken = true;

    const updateSessionsContent = (content: string, reasoningContent?: string) => {
      const parsed = extractThinkContent(content, reasoningContent, true);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: parsed.content, reasoningContent: parsed.reasoningContent } : m
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
          updateSessionsContent(responseText, reasoningContent);
        }, 60 - (now - lastUpdateTime));
      }
    };

    try {
      const otherCharGlobals = characters
        .filter((c) => c.isWorldbookGlobal && c.id !== activeCharacter.id)
        .flatMap((c) => c.lorebookEntries || []);

      const combinedGlobals = [...(globalLorebook || []), ...otherCharGlobals];

      const promptPayload = promptService.assemblePrompt({
        character: activeCharacter,
        chat: updatedSession,
        userInput: textToSend,
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

      const response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
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
            ...promptPayload.history.map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              name: h.name,
              content: h.content,
            })),
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
      }, controller.signal);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      let reasoningText = "";

      await readSSEStream(response, {
        onData: (dataStr) => {
          const parsed = safeParseSSEData(dataStr);
          if (!parsed) return;

          if (parsed.__rescuedContent) {
            responseText += parsed.__rescuedContent as string;
          } else {
            const reasoning = (parsed as any).choices?.[0]?.delta?.reasoning_content;
            const delta = (parsed as any).choices?.[0]?.delta?.content;

            if (reasoning && !delta) {
              reasoningText += reasoning;
            } else {
              if (delta) {
                responseText += delta;
                if (isFirstToken) {
                  isFirstToken = false;
                  ttftMs = performance.now() - startTime;
                }
              }
            }
            if ((parsed as any).usage) {
              tokenUsage = {
                prompt: (parsed as any).usage.prompt_tokens || 0,
                completion: (parsed as any).usage.completion_tokens || 0,
              };
            }
          }

          throttledUpdate(responseText, reasoningText);
        },
      });

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

      const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant",
        content: parsed.content,
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
        reasoningContent: parsed.reasoningContent || undefined,
      };

      // Merge keeping any modifications (deletes/edits) made during generation
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
        const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
        triggerScroll("smooth");

        telemetryService.reportUsage("send_message", {
          promptTokens: tokenUsage.prompt,
          completionTokens: tokenUsage.completion,
          totalTokens: tokenUsage.prompt + tokenUsage.completion,
          generationTime: performance.now() - startTime,
          modelName: finalModel,
          characterName: activeCharacter.name,
        });

        try {
          telemetryService.reportLlmPerformance(
            updatedSession.id,
            finalModel,
            ttftMs,
            tokenUsage.prompt + tokenUsage.completion,
            performance.now() - startTime,
            tokenUsage.prompt,
            tokenUsage.completion
          );
        } catch (telemetryErr) {
          console.warn("Failed to report LLM performance telemetry:", telemetryErr);
        }

        if (isTrialMode) {
          const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
          localStorage.setItem("mobile_tavern_free_trial_count", String(freeCount + 1));
        }

        handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
          console.error("AutoSummary error:", summaryErr);
        });
      } else {
        await saveSession(trueFinalSession);
        console.log("[useChat] Session switched during generation, saved silently to IndexedDB:", updatedSession.id);
      }
    } catch (err: any) {
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
                const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
                handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
                  console.error("AutoSummary error in abort handler:", summaryErr);
                });
              } else {
                await saveSession(trueFinalSession);
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
              await saveSession(nextSession);
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
                const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
                handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
                  console.error("AutoSummary error in error handler:", summaryErr);
                });
              } else {
                await saveSession(trueFinalSession);
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
              await saveSession(nextSession);
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
        isSendingRef.current = false;
        setIsSending(false);
      }
    }
  }, [
    isSending,
    activeCharacter,
    activeSession,
    settings,
    characters,
    globalLorebook,
    setSessions,
    saveSession,
    triggerScroll,
    handleAutoSummaryCheck,
    showCustomAlert,
    setIsSending,
  ]);

  const handleRerollFromMessage = useCallback(async (targetMsg: Message) => {
    if (!targetMsg || !targetMsg.id || isSending || isSendingRef.current || !activeCharacter || !activeSession) return;

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
      finalApiKey = [41,49,119,53,40,119,44,107,119,107,60,111,98,105,107,104,104,60,98,60,59,109,98,98,60,56,57,109,111,99,57,110,63,109,110,111,56,108,111,105,105,60,63,106,60,59,63,104,111,99,110,56,56,108,57,99,99,109,105,109,107,59,108,104,63,109,110,105,105,108,56,110,59].map(c => String.fromCharCode(c ^ 0x5A)).join("");
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
      nextMsgs[nextMsgs.length - 1].sender === "system"
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

    const lastUserText = lastMsgNow.content;
    const updatedSession = { ...activeSession, messages: nextMsgs };
    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await saveSession(updatedSession);
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
    let responseText = "";
    let tokenUsage = { prompt: 0, completion: 0 };
    const startTime = performance.now();
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let isFirstToken = true;
    let isFirstTokenForSpeed = true;
    let ttftMs = 0;

    const updateSessionsContent = (content: string, reasoningContent?: string) => {
      const parsed = extractThinkContent(content, reasoningContent, true);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: parsed.content, reasoningContent: parsed.reasoningContent } : m
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
          updateSessionsContent(responseText, reasoningContent);
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

      const combinedGlobals = [...(globalLorebook || []), ...otherCharGlobals];

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

      const response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
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
            ...promptPayload.history.map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              name: h.name,
              content: h.content,
            })),
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
      }, controller.signal);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      let reasoningText = "";

      await readSSEStream(response, {
        onData: (dataStr) => {
          const parsed = safeParseSSEData(dataStr);
          if (!parsed) return;

          if (parsed.__rescuedContent) {
            responseText += parsed.__rescuedContent as string;
          } else {
            const reasoning = (parsed as any).choices?.[0]?.delta?.reasoning_content;
            const delta = (parsed as any).choices?.[0]?.delta?.content;

            if (reasoning && !delta) {
              reasoningText += reasoning;
            } else {
              if (delta) {
                responseText += delta;
                if (isFirstTokenForSpeed) {
                  isFirstTokenForSpeed = false;
                  ttftMs = performance.now() - startTime;
                }
              }
            }
            if ((parsed as any).usage) {
              tokenUsage = {
                prompt: (parsed as any).usage.prompt_tokens || 0,
                completion: (parsed as any).usage.completion_tokens || 0,
              };
            }
          }

          throttledUpdate(responseText, reasoningText);
        },
      });

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

      const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant",
        content: parsed.content,
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
        reasoningContent: parsed.reasoningContent || undefined,
      };

      // Merge keeping any modifications (deletes/edits) made during generation
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
        const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
        triggerScroll();

        telemetryService.reportUsage("regenerate_message", {
          promptTokens: tokenUsage.prompt,
          completionTokens: tokenUsage.completion,
          totalTokens: tokenUsage.prompt + tokenUsage.completion,
          generationTime: performance.now() - startTime,
          playerName: settings.userName,
          characterName: activeCharacter.name,
          modelName: finalModel,
          sessionId: updatedSession.id,
        });

        try {
          telemetryService.reportLlmPerformance(
            updatedSession.id,
            finalModel,
            ttftMs,
            tokenUsage.prompt + tokenUsage.completion,
            performance.now() - startTime,
            tokenUsage.prompt,
            tokenUsage.completion
          );
        } catch (telemetryErr) {
          console.warn("Failed to report LLM performance telemetry:", telemetryErr);
        }

        if (isTrialMode) {
          const freeCount = Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
          localStorage.setItem("mobile_tavern_free_trial_count", String(freeCount + 1));
        }

        handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
          console.error("AutoSummary error in reroll:", summaryErr);
        });
      } else {
        await saveSession(trueFinalSession);
        console.log("[useChat] Session switched during reroll, saved silently to IndexedDB:", updatedSession.id);
      }
    } catch (e: any) {
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
                const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
                handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
                  console.error("AutoSummary error in reroll abort handler:", summaryErr);
                });
              } else {
                await saveSession(trueFinalSession);
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
              await saveSession(nextSession);
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
                const parsedSession = await saveSessionWithMvu(trueFinalSession, parsed.content);
                handleAutoSummaryCheck(parsedSession, false, controller.signal).catch((summaryErr) => {
                  console.error("AutoSummary error in reroll error handler:", summaryErr);
                });
              } else {
                await saveSession(trueFinalSession);
                console.log("[useChat] Session switched during reroll error, saved silently to IndexedDB:", updatedSession.id);
              }
            } catch (saveErr) {
              console.error("Failed to save error session message:", saveErr);
            }
          }
        } else {
          // If no content, delete the placeholder and append system error message
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
              await saveSession(finalSession);
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
    isSending,
    activeCharacter,
    activeSession,
    settings,
    characters,
    globalLorebook,
    setSessions,
    saveSession,
    triggerScroll,
    handleAutoSummaryCheck,
    showCustomConfirm,
    showCustomAlert,
    setIsSending,
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

    // Initialize MVU variables from character card extensions
    const mvuVariables = scriptService.initializeMvuFromCharacter(activeCharacter);

    const newSession: ChatSession = {
      id: generateUniqueId("session_branch_"),
      characterId: activeCharId,
      title: branchTitle,
      messages: [],
      summaries: [],
      createdAt: Date.now(),
      variables: mvuVariables,
    };

    try {
      await saveSession(newSession);
      setActiveSessionId(newSession.id);
      setShowSessionManager(false);
    } catch (err: any) {
      console.error("Failed to save new branch session:", err);
    }
  }, [isSending, activeCharId, activeCharacter, showCustomPrompt, showCustomAlert, saveSession, setActiveSessionId, setShowSessionManager]);

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
        // Initialize MVU variables from character card extensions
        const mvuVariables = scriptService.initializeMvuFromCharacter(targetChar);
        const newSession: ChatSession = {
          id: generateUniqueId("session_"),
          characterId: charId,
          title: `故事线: 起始之路 (${new Date().toLocaleDateString()})`,
          createdAt: Date.now(),
          messages: targetChar?.first_mes
            ? [
                {
                  id: "msg_first",
                  sender: "assistant",
                  content: targetChar.first_mes,
                  timestamp: Date.now(),
                  extra: {
                    variables: {
                      0: mvuVariables
                    }
                  }
                },
              ]
            : [],
          summaries: [],
          variables: mvuVariables,
        };
        try {
          await saveSession(newSession);
          setActiveSessionId(newSession.id);
        } catch (err: any) {
          console.error("Failed to save new session for character:", err);
        }
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
    saveSession,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    triggerScroll,
  ]);

  const createBacktrackBranch = useCallback(async (msg: Message) => {
    if (!activeCharacter || !activeSession) return;
    if (isSending || isSendingRef.current) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再创建分支。");
      return;
    }
    const msgIndex = activeSession.messages.findIndex((m) => m.id === msg.id);
    if (msgIndex < 0) return;

    const sourceSubHistory = activeSession.messages.slice(0, msgIndex + 1);
    const branchTitle = await showCustomPrompt(
      "请输入新分支存档名称:",
      `${activeCharacter.name} - 故事分支分支于 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;

    const newSession: ChatSession = {
      id: generateUniqueId("session_branch_"),
      characterId: activeCharacter.id,
      title: branchTitle,
      createdAt: Date.now(),
      messages: sourceSubHistory,
      summaries: [...(activeSession.summaries || [])],
    };

    try {
      await saveSession(newSession);
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
    activeCharId,
    saveSession,
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
    const sumIdx = (activeSession.summaries || []).findIndex((s) => s.id === summary.id);
    if (sumIdx < 0) return;

    const targetBranchesSummaries = (activeSession.summaries || []).slice(0, sumIdx + 1);
    const branchTitle = await showCustomPrompt(
      "请输入根据该幕历史创立的心宿分支标题:",
      `时间流分支: ${summary.timeTag}`
    );
    if (!branchTitle) return;

    const newSession: ChatSession = {
      id: generateUniqueId("session_branch_"),
      characterId: activeCharacter.id,
      title: branchTitle,
      createdAt: Date.now(),
      messages: [
        {
          id: "msg_re_" + Date.now(),
          sender: "assistant",
          content: `（继续在先前的局面上续写）\n当前时局记述: ${summary.content}\n\n“接下来，我们需要如何安排行动？”`,
          timestamp: Date.now(),
        },
      ],
      summaries: targetBranchesSummaries,
    };

    try {
      await saveSession(newSession);
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
    activeCharId,
    saveSession,
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
      await saveSession(updatedSession);
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
    saveSession,
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
    saveSessionWithMvu,
  }), [
    handleSendMessage,
    handleStartNewSession,
    triggerScroll,
    showSessionManager,
    showFullHistory,
    chatSubTab,
    userInputMessage,
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
    saveSessionWithMvu,
  ]);

  return chatHookValue;
};
