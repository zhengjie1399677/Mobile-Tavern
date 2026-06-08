import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { Message, ChatSession, SummaryCard, UserSettings, LorebookEntry } from "../types";
import { assemblePromptContext } from "../utils/promptBuilder";
import { reportUsage, incrementUsageCount } from "../utils/telemetry";
import { universalFetch, FALLBACK_MODEL, API_ENDPOINT } from "../utils/apiClient";
import { readSSEStream, safeParseSSEData } from "../utils/streamReader";
import FormattedText from "../components/FormattedText";
import { parseMvuMessage, notifyVariablesUpdated, initializeMvuFromCharacter } from "../utils/tavernHelperBridge";
import { getAllSessions } from "../utils/localDB";

const generateUniqueId = (prefix: string): string => {
  return prefix + Math.random().toString(36).substring(2, 9);
};

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

  const sessionsRef = React.useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Local Chat / Timeline UI States
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [chatSubTab, setChatSubTab] = useState<"dialogue" | "timeline">("dialogue");

  useEffect(() => {
    setShowFullHistory(false);
  }, [activeSessionId]);

  // Message Input & Forms state
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
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
        setIsSending(false);
      }
    };
  }, [setIsSending]);

  const triggerScroll = useCallback((behavior: "smooth" | "instant" = "smooth") => {
    setTimeout(() => {
      if (chatBottomRef && chatBottomRef.current) {
        chatBottomRef.current.scrollIntoView({ behavior });
      }
    }, 100);
  }, [chatBottomRef]);

  const handleStartNewSession = useCallback(async (customFirstMessage?: string) => {
    if (!activeCharacter) return;
    const starterMsg = customFirstMessage ?? activeCharacter.first_mes;

    // Initialize MVU variables from character card extensions
    const mvuVariables = initializeMvuFromCharacter(activeCharacter);

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
    const lastIndex = session.lastSummarizedMessageId
      ? session.messages.findIndex((m) => m.id === session.lastSummarizedMessageId)
      : -1;
    
    let startIndex = 0;
    if (lastIndex >= 0) {
      startIndex = lastIndex + 1;
    }
    const unsummarizedMessages = session.messages.slice(startIndex);
    
    const summaryTurnsVal = settings?.memory?.summaryTriggerTurns;
    const rawTriggerTurns = summaryTurnsVal ? Number(summaryTurnsVal) : 0;
    const rawRecentTurns = Number(settings?.memory?.recentTurns || 6);
    const triggerRounds = (!isNaN(rawTriggerTurns) && rawTriggerTurns > 0) ? rawTriggerTurns : rawRecentTurns;
    
    const maxAllowedUnsummarized = triggerRounds * 2;

    let messagesToCompress: Message[] = [];

    if (force || unsummarizedMessages.length >= maxAllowedUnsummarized) {
      if (unsummarizedMessages.length === 0) {
        if (force) await showCustomAlert("当前没有未被总结的有效对话。");
        return;
      }

      messagesToCompress = unsummarizedMessages.slice(0, maxAllowedUnsummarized);

      try {
        setIsSummarizing(true);
        const promptInstruction = settings?.memory?.summarySystemPrompt || "";
        const contentConcat = messagesToCompress
          .map((m) => `${m.sender === "user" ? (settings?.userName || "user") : (activeCharacter?.name || "角色")}: ${m.content}`)
          .join("\n");

        let compiledSummary = "";

        const reqBody = {
          model: settings.api.modelName || FALLBACK_MODEL,
          messages: [
            { role: "system", content: promptInstruction },
            { role: "user", content: contentConcat },
          ],
          stream: false,
          temperature: 0.5,
          max_tokens: 500,
        };
        const response = await universalFetch(API_ENDPOINT.ProxyOpenAI, {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey,
          chatPath: settings?.api?.chatPath,
          reqBody,
          bypassProxy: settings.api.bypassProxy,
        }, signal);

        if (signal?.aborted) return;

        if (!response.ok) {
          const errStatus = response.status;
          console.error("[AutoSummary] fetch failed with status:", errStatus);
          throw new Error(`API 返回错误状态码 ${errStatus}`);
        }

        const responseText = await response.text();
        let resData: any;
        try {
          resData = JSON.parse(responseText);
        } catch (e) {
          console.error("[AutoSummary] JSON parse failed. Response text was:", responseText);
          throw new Error("接口返回数据格式错误，解析 JSON 失败");
        }

        if (resData && resData.choices && resData.choices.length > 0) {
          compiledSummary = resData.choices[0].message?.content || "";
        }

        if (compiledSummary) {
          const indexVal = (session.summaries || []).length + 1;
          const timeTagTemplate = settings?.memory?.timeTagTemplate || "第{{index}}幕";
          const timeTag = timeTagTemplate.replace(/\{\{index\}\}/g, String(indexVal));

          let contentText = compiledSummary.trim();
          let locationStr = activeCharacter?.scenario?.slice(0, 8) || "未知地点";
          let timeTagStr = timeTag;
          let conditionStr = "";
          let inventoryStr = "";
          let bondingStr = "";

          const splitIdx = compiledSummary.lastIndexOf("---");
          if (splitIdx !== -1) {
            const body = compiledSummary.slice(0, splitIdx).trim();
            const meta = compiledSummary.slice(splitIdx + 3).trim();
            if (body) {
              contentText = body;
            }
            
            const locMatch = meta.match(/\[(?:Location|地点):\s*(.*?)\]/i);
            const timeMatch = meta.match(/\[(?:Time|时间):\s*(.*?)\]/i);
            const condMatch = meta.match(/\[(?:Condition|状态|心境):\s*(.*?)\]/i);
            const invMatch = meta.match(/\[(?:Inventory|物品|道具):\s*(.*?)\]/i);
            const bondMatch = meta.match(/\[(?:Bonding|羁绊|情感):\s*(.*?)\]/i);

            if (locMatch && locMatch[1].trim()) locationStr = locMatch[1].trim();
            if (timeMatch && timeMatch[1].trim()) timeTagStr = timeMatch[1].trim();
            if (condMatch && condMatch[1].trim()) conditionStr = condMatch[1].trim();
            if (invMatch && invMatch[1].trim()) inventoryStr = invMatch[1].trim();
            if (bondMatch && bondMatch[1].trim()) bondingStr = bondMatch[1].trim();
          }

          const lastSummarizedMessageId = messagesToCompress[messagesToCompress.length - 1].id;

          const newCard: SummaryCard = {
            id: generateUniqueId("summary_"),
            timeTag: timeTagStr,
            location: locationStr,
            content: contentText,
            condition: conditionStr || undefined,
            inventory: inventoryStr || undefined,
            bonding: bondingStr || undefined,
            lastMessageId: lastSummarizedMessageId,
          };

          if (signal?.aborted) return;

          const allSessions = await getAllSessions();
          const latestSession = allSessions.find((s) => s.id === session.id);
          if (latestSession) {
            const nextSession = {
              ...latestSession,
              summaries: [...(latestSession.summaries || []), newCard],
              lastSummarizedMessageId,
            };
            await saveSession(nextSession);
            if (force) await showCustomAlert("记忆整理完毕，已收录至潜意识年表！");
          } else {
            if (force) await showCustomAlert("记忆整理失败，该会话可能已被删除。");
          }
        } else {
          if (force) await showCustomAlert("记忆整理失败，请检查API连接。");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        console.warn("Auto-compactor service bypassed or offline:", e);
        if (force) await showCustomAlert("记忆整理出错: " + (e as Error).message);
      } finally {
        setIsSummarizing(false);
      }
    } else {
      if (force) await showCustomAlert("当前无需强制压缩。");
    }
  }, [settings, activeCharacter, showCustomAlert, saveSession, setIsSummarizing]);

  const saveSessionWithMvu = useCallback(async (session: ChatSession, messageToParse?: string) => {
    let updatedSession = session;
    if (settings.enableScriptExecution && messageToParse) {
      try {
        const parsedVariables = parseMvuMessage(messageToParse, session.variables || {});
        updatedSession = {
          ...session,
          variables: parsedVariables,
        };
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
        // Notify iframe scripts that variables have been updated so they can refresh their UI
        notifyVariablesUpdated(updatedSession);
      } catch (e) {
        console.warn("Failed to parse MVU message:", e);
      }
    }
    await saveSession(updatedSession);
    return updatedSession;
  }, [settings.enableScriptExecution, saveSession, setSessions]);


  const handleSendMessage = useCallback(async (textToSend: string) => {
    incrementUsageCount();
    if (
      !textToSend ||
      typeof textToSend !== "string" ||
      !textToSend.trim() ||
      isSending ||
      !activeCharacter ||
      !activeSession
    ) {
      return;
    }

    if (!settings.api.apiKey) {
      showCustomAlert(
        "当前未填写 API Key，API 亲测会被拦截！请前往“设置 -> API配置”中填写您的 API Key。"
      );
      return;
    }

    if (!settings.api.modelName) {
      showCustomAlert(
        "对话失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。"
      );
      return;
    }

    const userMsg: Message = {
      id: "msg_user_" + Math.random().toString(36).substring(2, 9),
      sender: "user",
      content: textToSend.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...activeSession.messages, userMsg];
    const updatedSession = { ...activeSession, messages: updatedMessages };

    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save session user message:", err);
      setIsSending(false);
      return;
    }
    triggerScroll("smooth");
    setIsSending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let responseText = "";
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let pendingUpdateTimeout: any = null;
    let isFirstToken = true;

    const updateSessionsContent = (content: string) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content } : m
            ),
          };
        })
      );
    };

    const throttledUpdate = (content: string) => {
      const now = performance.now();
      if (isFirstToken) {
        isFirstToken = false;
        lastUpdateTime = now;
        updateSessionsContent(content);
        return;
      }

      if (now - lastUpdateTime >= 60) {
        if (pendingUpdateTimeout) {
          clearTimeout(pendingUpdateTimeout);
          pendingUpdateTimeout = null;
        }
        lastUpdateTime = now;
        updateSessionsContent(content);
      } else if (!pendingUpdateTimeout) {
        pendingUpdateTimeout = setTimeout(() => {
          pendingUpdateTimeout = null;
          lastUpdateTime = performance.now();
          updateSessionsContent(responseText);
        }, 60 - (now - lastUpdateTime));
      }
    };

    try {
      const otherCharGlobals = characters
        .filter((c) => c.isWorldbookGlobal && c.id !== activeCharacter.id)
        .flatMap((c) => c.lorebookEntries || []);

      const combinedGlobals = [...(globalLorebook || []), ...otherCharGlobals];

      const promptPayload = assemblePromptContext({
        character: activeCharacter,
        chat: updatedSession,
        userInput: textToSend,
        settings,
        globalLorebook: combinedGlobals,
      });

      let tokenUsage = { prompt: 0, completion: 0 };
      const startTime = performance.now();

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

      const response = await universalFetch(API_ENDPOINT.ProxyOpenAI, {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        chatPath: settings?.api?.chatPath,
        bypassProxy: settings.api.bypassProxy,
        reqBody: {
          model: settings.api.modelName || FALLBACK_MODEL,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: promptPayload.systemInstruction },
            ...promptPayload.history.slice(0, -1).map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              content: h.content,
            })),
            ...(promptPayload.dynamicInstruction
              ? [{ role: "system", content: promptPayload.dynamicInstruction }]
              : []),
            ...promptPayload.history.slice(-1).map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              content: h.content,
            })),
          ],
          temperature: settings.preset.temperature,
          top_p: settings.preset.topP,
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

      await readSSEStream(response, {
        onData: (dataStr) => {
          const parsed = safeParseSSEData(dataStr);
          if (!parsed) return;

          if (parsed.__rescuedContent) {
            responseText += parsed.__rescuedContent as string;
          } else {
            const delta = (parsed as any).choices?.[0]?.delta?.content;
            if (delta) responseText += delta;
            if ((parsed as any).usage) {
              tokenUsage = {
                prompt: (parsed as any).usage.prompt_tokens || 0,
                completion: (parsed as any).usage.completion_tokens || 0,
              };
            }
          }

          throttledUpdate(responseText);
        },
      });

      const sessionExists = sessionsRef.current.some((s) => s.id === updatedSession.id);
      if (!sessionExists) {
        console.warn("Aborted session save because it was deleted during generation:", updatedSession.id);
        return;
      }

      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant",
        content: responseText.trim(),
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
      };
      const finalMessages = [...updatedSession.messages, finalAiMsg];
      const trueFinalSession = {
        ...updatedSession,
        messages: finalMessages,
      };
      const parsedSession = await saveSessionWithMvu(trueFinalSession, responseText);
      triggerScroll("smooth");

      reportUsage("send_message", {
        promptTokens: tokenUsage.prompt,
        completionTokens: tokenUsage.completion,
        totalTokens: tokenUsage.prompt + tokenUsage.completion,
        generationTime: performance.now() - startTime,
        modelName: settings.api.modelName,
        characterName: activeCharacter.name,
      });

      await handleAutoSummaryCheck(parsedSession, false, controller.signal);
    } catch (err: any) {
      const isManualAbort = err.name === "AbortError" || err.message?.includes("aborted") || controller.signal.aborted;
      if (isManualAbort) {
        if (responseText.trim().length > 0) {
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: responseText.trim(),
            timestamp: Date.now(),
          };
          const abortSessionExists = sessionsRef.current.some((s) => s.id === updatedSession.id);
          if (abortSessionExists) {
            const finalMessages = [...updatedSession.messages, finishedAiMsg];
            const trueFinalSession = {
              ...updatedSession,
              messages: finalMessages,
            };
            try {
              const parsedSession = await saveSessionWithMvu(trueFinalSession, responseText);
              await handleAutoSummaryCheck(parsedSession, false, controller.signal);
            } catch (saveErr) {
              console.error("Failed to save aborted session message:", saveErr);
            }
          }
        } else {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== updatedSession.id) return s;
              return {
                ...s,
                messages: s.messages.filter((m) => m.id !== aiMsgId),
              };
            })
          );
        }
      } else {
        showCustomAlert("发送失败，对话连接异常: " + err.message);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== updatedSession.id) return s;
            return {
              ...s,
              messages: s.messages.filter((m) => m.id !== aiMsgId),
            };
          })
        );
      }
    } finally {
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }
      if (abortControllerRef.current === controller) {
        setIsSending(false);
        abortControllerRef.current = null;
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
    if (!targetMsg || !targetMsg.id || isSending || !activeCharacter || !activeSession) return;

    if (!settings.api.modelName) {
      await showCustomAlert("重发失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
      return;
    }

    const msgs = activeSession.messages;
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

    const lastUserText = lastMsgNow.content;
    const updatedSession = { ...activeSession, messages: nextMsgs };
    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    try {
      await saveSession(updatedSession);
    } catch (err: any) {
      console.error("Failed to save session for reroll:", err);
      setIsSending(false);
      return;
    }
    triggerScroll();
    setIsSending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let responseText = "";
    let tokenUsage = { prompt: 0, completion: 0 };
    const startTime = performance.now();
    const aiMsgId = generateUniqueId("msg_ai_");

    let lastUpdateTime = 0;
    let pendingUpdateTimeout: any = null;
    let isFirstToken = true;

    const updateSessionsContent = (content: string) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content } : m
            ),
          };
        })
      );
    };

    const throttledUpdate = (content: string) => {
      const now = performance.now();
      if (isFirstToken) {
        isFirstToken = false;
        lastUpdateTime = now;
        updateSessionsContent(content);
        return;
      }

      if (now - lastUpdateTime >= 60) {
        if (pendingUpdateTimeout) {
          clearTimeout(pendingUpdateTimeout);
          pendingUpdateTimeout = null;
        }
        lastUpdateTime = now;
        updateSessionsContent(content);
      } else if (!pendingUpdateTimeout) {
        pendingUpdateTimeout = setTimeout(() => {
          pendingUpdateTimeout = null;
          lastUpdateTime = performance.now();
          updateSessionsContent(responseText);
        }, 60 - (now - lastUpdateTime));
      }
    };

    try {
      const otherCharGlobals = characters
        .filter((c) => c.isWorldbookGlobal && c.id !== activeCharacter.id)
        .flatMap((c) => c.lorebookEntries || []);

      const combinedGlobals = [...(globalLorebook || []), ...otherCharGlobals];

      const promptPayload = assemblePromptContext({
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

      const response = await universalFetch(API_ENDPOINT.ProxyOpenAI, {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        chatPath: settings?.api?.chatPath,
        bypassProxy: settings.api.bypassProxy,
        reqBody: {
          model: settings.api.modelName || FALLBACK_MODEL,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: promptPayload.systemInstruction },
            ...promptPayload.history.slice(0, -1).map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              content: h.content,
            })),
            ...(promptPayload.dynamicInstruction ? [{ role: "system", content: promptPayload.dynamicInstruction }] : []),
            ...promptPayload.history.slice(-1).map((h) => ({
              role: h.role === "model" ? "assistant" : h.role,
              content: h.content,
            })),
          ],
          temperature: settings.preset.temperature,
          top_p: settings.preset.topP,
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

      await readSSEStream(response, {
        onData: (dataStr) => {
          const parsed = safeParseSSEData(dataStr);
          if (!parsed) return;

          if (parsed.__rescuedContent) {
            responseText += parsed.__rescuedContent as string;
          } else {
            const delta = (parsed as any).choices?.[0]?.delta?.content;
            if (delta) responseText += delta;
            if ((parsed as any).usage) {
              tokenUsage = {
                prompt: (parsed as any).usage.prompt_tokens || 0,
                completion: (parsed as any).usage.completion_tokens || 0,
              };
            }
          }

          throttledUpdate(responseText);
        },
      });

      const sessionExists = sessionsRef.current.some((s) => s.id === updatedSession.id);
      if (!sessionExists) {
        console.warn("Aborted session save because it was deleted during generation:", updatedSession.id);
        return;
      }

      const finalAiMsg = {
        id: aiMsgId,
        sender: "assistant",
        content: responseText.trim(),
        timestamp: Date.now(),
        generationTime: (performance.now() - startTime) / 1000,
        tokenCount: tokenUsage.completion,
        promptTokenCount: tokenUsage.prompt,
      };
      const finalMessages = [...updatedSession.messages, finalAiMsg];
      const trueFinalSession = {
        ...updatedSession,
        messages: finalMessages,
      };
      const parsedSession = await saveSessionWithMvu(trueFinalSession, responseText);
      triggerScroll();

      reportUsage("regenerate_message", {
        promptTokens: tokenUsage.prompt,
        completionTokens: tokenUsage.completion,
        totalTokens: tokenUsage.prompt + tokenUsage.completion,
        generationTime: performance.now() - startTime,
        playerName: settings.userName,
        characterName: activeCharacter.name,
        modelName: settings.api.modelName,
        sessionId: updatedSession.id,
      });

      await handleAutoSummaryCheck(parsedSession, false, controller.signal);
    } catch (e: any) {
      const isManualAbort = e.name === "AbortError" || e.message?.includes("aborted") || controller.signal.aborted;
      if (isManualAbort) {
        if (responseText.trim().length > 0) {
          const finishedAiMsg: Message = {
            id: aiMsgId,
            sender: "assistant",
            content: responseText.trim(),
            timestamp: Date.now(),
          };
          const abortSessionExists = sessionsRef.current.some((s) => s.id === updatedSession.id);
          if (abortSessionExists) {
            const finalMessages = [...updatedSession.messages, finishedAiMsg];
            const trueFinalSession = {
              ...updatedSession,
              messages: finalMessages,
            };
            try {
              const parsedSession = await saveSessionWithMvu(trueFinalSession, responseText);
              await handleAutoSummaryCheck(parsedSession, false, controller.signal);
            } catch (saveErr) {
              console.error("Failed to save aborted session message:", saveErr);
            }
          }
        } else {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== updatedSession.id) return s;
              return {
                ...s,
                messages: s.messages.filter((m) => m.id !== aiMsgId),
              };
            })
          );
        }
      } else {
        console.error("AI Regeneration failed:", e);
        reportUsage("api_error", {
          detail: String(e.message || "Unknown error"),
          playerName: settings.userName,
          characterName: activeCharacter.name,
          modelName: settings.api.modelName,
          sessionId: updatedSession.id,
        });
        const errorMsg: Message = {
          id: generateUniqueId("msg_err_"),
          sender: "system",
          content: `【连接错误】重新生成失败。请检查端口或API秘钥状态。详细错误: ${e.message}`,
          timestamp: Date.now(),
        };
        const finalSession = {
          ...updatedSession,
          messages: [...updatedSession.messages, errorMsg],
        };
        setSessions((prev) =>
          prev.map((s) => (s.id === finalSession.id ? finalSession : s))
        );
        try {
          await saveSession(finalSession);
        } catch (saveErr) {
          console.error("Failed to save error session message:", saveErr);
        }
        triggerScroll();
      }
    } finally {
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }
      if (abortControllerRef.current === controller) {
        setIsSending(false);
        abortControllerRef.current = null;
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
    const branchTitle = await showCustomPrompt(
      "请输入全新独立分支存档名称:",
      `${activeCharacter?.name} - 新分支线 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;

    // Initialize MVU variables from character card extensions
    const mvuVariables = initializeMvuFromCharacter(activeCharacter);

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
  }, [activeCharId, activeCharacter, showCustomPrompt, saveSession, setActiveSessionId, setShowSessionManager]);

  const deleteBranch = useCallback(async (id: string) => {
    const confirm = await showCustomConfirm("确定要永久删除这个聊天分支吗？(无法恢复)");
    if (!confirm) return;

    try {
      await deleteSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        const charRemaining = remaining
          .filter((s) => s.characterId === activeCharId)
          .sort((a, b) => b.createdAt - a.createdAt);
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
  }, [showCustomConfirm, deleteSession, activeSessionId, activeCharId, setActiveSessionId, setSessions, sessions]);

  const selectCharacter = useCallback(async (charId: string) => {
    if (isSending) {
      await showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再切换角色卡。");
      return;
    }
    setActiveCharId(charId);

    const charSessions = sessions.filter((s) => s.characterId === charId);
    if (charSessions.length > 0) {
      const lastSession = charSessions.sort(
        (a, b) => b.createdAt - a.createdAt
      )[0];
      setActiveSessionId(lastSession.id);
    } else {
      const targetChar = characters.find((c) => c.id === charId);
      // Initialize MVU variables from character card extensions
      const mvuVariables = initializeMvuFromCharacter(targetChar);
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
      messages: activeCharacter.first_mes
        ? [
            {
              id: "msg_re_" + Date.now(),
              sender: "assistant",
              content: `（继续在先前的局面上续写）\n当前时局记述: ${summary.content}\n\n“接下来，我们需要如何安排行动？”`,
              timestamp: Date.now(),
            },
          ]
        : [],
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

  const renderDialogueBubble = useCallback((text: string) => {
    return (
      <FormattedText
        text={text}
        charName={activeCharacter?.name || ""}
        userName={settings.userName}
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
  ]);

  return chatHookValue;
};
