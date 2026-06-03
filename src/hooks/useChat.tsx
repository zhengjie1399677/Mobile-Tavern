import React, { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { Message, ChatSession, SummaryCard } from "../types";
import { assemblePromptContext } from "../utils/promptBuilder";
import { reportUsage, incrementUsageCount } from "../utils/telemetry";
import { universalFetch } from "../utils/apiClient";

export const useChat = (
  settings: any,
  globalLorebook: any[],
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
  } = useChatState();

  // Local Chat / Timeline UI States
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [chatSubTab, setChatSubTab] = useState<"dialogue" | "timeline">("dialogue");

  useEffect(() => {
    setShowFullHistory(false);
  }, [activeSessionId]);

  // Message Input & Forms state
  const [userInputMessage, setUserInputMessage] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");
  const [msgMenuId, setMsgMenuId] = useState<string | null>(null);

  // SSE 流式渲染节流：避免每个 chunk 都触发 React 重渲染
  const lastStreamUpdateRef = useRef(0);
  const THROTTLE_MS = 100;

  // Timeline Memory creation state
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [newSummaryTag, setNewSummaryTag] = useState("");
  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);

  const triggerScroll = (behavior: "smooth" | "instant" = "smooth") => {
    setTimeout(() => {
      if (chatBottomRef && chatBottomRef.current) {
        chatBottomRef.current.scrollIntoView({ behavior });
      }
    }, 100);
  };

  const handleStartNewSession = async (customFirstMessage?: string) => {
    if (!activeCharacter) return;
    const starterMsg = customFirstMessage ?? activeCharacter.first_mes;

    const newSession: ChatSession = {
      id: "session_" + Math.random().toString(36).substring(2, 9),
      characterId: activeCharacter.id,
      title: activeCharacter.name + " 的新会话",
      createdAt: Date.now(),
      messages: starterMsg
        ? [
            {
              id: "msg_ai_" + Math.random().toString(36).substring(2, 9),
              sender: "assistant",
              content: starterMsg.trim(),
              timestamp: Date.now(),
            },
          ]
        : [],
      summaries: [],
    };

    await saveSession(newSession);
    setActiveSessionId(newSession.id);
    triggerScroll("instant");
  };

  const handleSendMessage = async (textToSend: string) => {
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
    await saveSession(updatedSession);
    triggerScroll("smooth");
    setIsSending(true);
    lastStreamUpdateRef.current = 0; // 重置节流计时器，首帧即时渲染

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

      let responseText = "";
      let tokenUsage = { prompt: 0, completion: 0 };
      const startTime = performance.now();
      const aiMsgId = "msg_ai_" + Math.random().toString(36).substring(2, 9);

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

      const response = await universalFetch("/api/proxy/openai", {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        reqBody: {
          model: settings.api.modelName || "gpt-3.5-turbo",
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
          presence_penalty: settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: settings.preset.repetitionPenalty,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let pbuf = "";

      while (!done && reader) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          pbuf += decoder.decode(value, { stream: true });
          let i;
          while ((i = pbuf.indexOf("\n\n")) >= 0) {
            const line = pbuf.slice(0, i).trim();
            pbuf = pbuf.slice(i + 2);
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.choices?.[0]?.delta?.content) {
                  responseText += data.choices[0].delta.content;
                }
                if (data.usage) {
                  tokenUsage = {
                    prompt: data.usage.prompt_tokens || 0,
                    completion: data.usage.completion_tokens || 0,
                  };
                }

                // 节流 UI 更新
                const now = Date.now();
                if (now - lastStreamUpdateRef.current >= THROTTLE_MS) {
                  lastStreamUpdateRef.current = now;
                  setSessions((prev) =>
                    prev.map((s) => {
                      if (s.id !== updatedSession.id) return s;
                      const msgs = s.messages.map((m) =>
                        m.id === aiMsgId ? { ...m, content: responseText } : m
                      );
                      return { ...s, messages: msgs };
                    })
                  );
                }
              } catch (e) {
                const contentReg = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
                const match = dataStr.match(contentReg);
                if (match && match[1]) {
                  const rescuedContent = match[1];
                  responseText += rescuedContent;

                  const now2 = Date.now();
                  if (now2 - lastStreamUpdateRef.current >= THROTTLE_MS) {
                    lastStreamUpdateRef.current = now2;
                    setSessions((prev) =>
                      prev.map((s) => {
                        if (s.id !== updatedSession.id) return s;
                        const msgs = s.messages.map((m) =>
                          m.id === aiMsgId ? { ...m, content: responseText } : m
                        );
                        return { ...s, messages: msgs };
                      })
                    );
                  }
                }
              }
            }
          }
        }
      }

      // 最终 flush：确保节流期间积攒的尾部文本完整渲染
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          const msgs = s.messages.map((m) =>
            m.id === aiMsgId ? { ...m, content: responseText } : m
          );
          return { ...s, messages: msgs };
        })
      );

      const updatedMessagesWithCompleteAi = updatedSession.messages.concat([
        {
          id: aiMsgId,
          sender: "assistant",
          content: responseText.trim(),
          timestamp: Date.now(),
          generationTime: (performance.now() - startTime) / 1000,
          tokenCount: tokenUsage.completion,
          promptTokenCount: tokenUsage.prompt,
        },
      ]);
      const trueFinalSession = {
        ...updatedSession,
        messages: updatedMessagesWithCompleteAi,
      };

      let wasSessionDeleted = false;
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === trueFinalSession.id);
        if (!exists) {
          wasSessionDeleted = true;
          return prev;
        }
        return prev.map((s) => (s.id === trueFinalSession.id ? trueFinalSession : s));
      });

      if (wasSessionDeleted) {
        console.warn("Aborted session save because it was deleted during generation:", trueFinalSession.id);
        return;
      }
      await saveSession(trueFinalSession);
      triggerScroll("smooth");

      // Telemetry: track message send with token usage
      reportUsage("send_message", {
        promptTokens: tokenUsage.prompt,
        completionTokens: tokenUsage.completion,
        totalTokens: tokenUsage.prompt + tokenUsage.completion,
        generationTime: performance.now() - startTime,
        modelName: settings.api.modelName,
        characterName: activeCharacter.name,
      });

      // Check if summaries need automatic compilation
      await handleAutoSummaryCheck(trueFinalSession);
    } catch (err: any) {
      showCustomAlert("发送失败，对话连接异常: " + err.message);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          return {
            ...s,
            messages: s.messages.filter((m) => !m.content.includes("💭...")),
          };
        })
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleRerollFromMessage = async (targetMsg: Message) => {
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
    await saveSession(updatedSession);
    triggerScroll();
    setIsSending(true);
    lastStreamUpdateRef.current = 0; // 重置节流计时器

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

      let responseText = "";
      let tokenUsage = { prompt: 0, completion: 0 };
      const startTime = performance.now();
      const aiMsgId = "msg_ai_" + Math.random().toString(36).substring(2, 9);

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

      const response = await universalFetch("/api/proxy/openai", {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        reqBody: {
          model: settings.api.modelName || "gpt-3.5-turbo",
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
          presence_penalty: settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: settings.preset.repetitionPenalty,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let pbuf = "";

      while (!done && reader) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          pbuf += decoder.decode(value, { stream: true });
          let i;
          while ((i = pbuf.indexOf("\n\n")) >= 0) {
            const line = pbuf.slice(0, i).trim();
            pbuf = pbuf.slice(i + 2);
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.choices?.[0]?.delta?.content) {
                  responseText += data.choices[0].delta.content;
                }
                if (data.usage) {
                  tokenUsage = {
                    prompt: data.usage.prompt_tokens || 0,
                    completion: data.usage.completion_tokens || 0,
                  };
                }

                const now3 = Date.now();
                if (now3 - lastStreamUpdateRef.current >= THROTTLE_MS) {
                  lastStreamUpdateRef.current = now3;
                  setSessions((prev) =>
                    prev.map((s) => {
                      if (s.id !== updatedSession.id) return s;
                      const msgs = s.messages.map((m) =>
                        m.id === aiMsgId ? { ...m, content: responseText } : m
                      );
                      return { ...s, messages: msgs };
                    })
                  );
                }
              } catch (e) {
                const contentReg = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
                const match = dataStr.match(contentReg);
                if (match && match[1]) {
                  const rescuedContent = match[1];
                  responseText += rescuedContent;

                  const now4 = Date.now();
                  if (now4 - lastStreamUpdateRef.current >= THROTTLE_MS) {
                    lastStreamUpdateRef.current = now4;
                    setSessions((prev) =>
                      prev.map((s) => {
                        if (s.id !== updatedSession.id) return s;
                        const msgs = s.messages.map((m) =>
                          m.id === aiMsgId ? { ...m, content: responseText } : m
                        );
                        return { ...s, messages: msgs };
                      })
                    );
                  }
                }
              }
            }
          }
        }
      }

      // 最终 flush
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updatedSession.id) return s;
          const msgs = s.messages.map((m) =>
            m.id === aiMsgId ? { ...m, content: responseText } : m
          );
          return { ...s, messages: msgs };
        })
      );

      const updatedMessagesWithCompleteAi = updatedSession.messages.concat([
        {
          id: aiMsgId,
          sender: "assistant",
          content: responseText.trim(),
          timestamp: Date.now(),
          generationTime: (performance.now() - startTime) / 1000,
          tokenCount: tokenUsage.completion,
          promptTokenCount: tokenUsage.prompt,
        },
      ]);
      const trueFinalSession = {
        ...updatedSession,
        messages: updatedMessagesWithCompleteAi,
      };

      let wasSessionDeleted = false;
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === trueFinalSession.id);
        if (!exists) {
          wasSessionDeleted = true;
          return prev;
        }
        return prev.map((s) => (s.id === trueFinalSession.id ? trueFinalSession : s));
      });

      if (wasSessionDeleted) {
        console.warn("Aborted session save because it was deleted during generation:", trueFinalSession.id);
        return;
      }
      await saveSession(trueFinalSession);
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

      await handleAutoSummaryCheck(trueFinalSession);
    } catch (e: any) {
      console.error("AI Regeneration failed:", e);
      reportUsage("api_error", {
        detail: String(e.message || "Unknown error"),
        playerName: settings.userName,
        characterName: activeCharacter.name,
        modelName: settings.api.modelName,
        sessionId: updatedSession.id,
      });
      const errorMsg: Message = {
        id: "msg_err_" + Math.random().toString(36).substring(2, 9),
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
      await saveSession(finalSession);
      triggerScroll();
    } finally {
      setIsSending(false);
    }
  };

  const handleRerollLast = async () => {
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
  };

  const handleAutoSummaryCheck = async (
    session: ChatSession,
    force: boolean = false
  ) => {
    const lastIndex = session.lastSummarizedMessageId
      ? session.messages.findIndex((m) => m.id === session.lastSummarizedMessageId)
      : -1;
    const startIndex = lastIndex >= 0 ? lastIndex + 1 : 0;
    const unsummarizedMessages = session.messages.slice(startIndex);
    const maxAllowedUnsummarized = 20;

    let messagesToCompress: Message[] = [];

    if (force || unsummarizedMessages.length >= maxAllowedUnsummarized) {
      if (unsummarizedMessages.length === 0) {
        if (force) await showCustomAlert("当前没有未被总结的有效对话。");
        return;
      }

      messagesToCompress = unsummarizedMessages.slice(0, 20);

      try {
        const promptInstruction = `你是一个高智能的故事缩影编纂者。请精确提炼以下未记录的剧情片段，以第三人称小说的口吻，写下紧凑、核心的剧情发展与行为要素，字数控制在300字以内，不要遗漏关键道具、角色心态与命运转折。仅返回描述文本，不要多余废话。请不要评价，直接输出提炼后的故事片段。`;
        const contentConcat = messagesToCompress
          .map((m) => `${m.sender === "user" ? "用户" : "角色"}: ${m.content}`)
          .join("\n");

        let compiledSummary = "";

        const reqBody = {
          model: settings.api.modelName || "gpt-3.5-turbo",
          messages: [
            { role: "system", content: promptInstruction },
            { role: "user", content: contentConcat },
          ],
          stream: false,
        };
        const response = await universalFetch("/api/proxy/openai", {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey,
          reqBody,
        });
        const resData = await response.json();
        if (resData.choices && resData.choices.length > 0) {
          compiledSummary = resData.choices[0].message.content;
        }

        if (compiledSummary) {
          const newCard: SummaryCard = {
            id: "summary_" + Math.random().toString(36).substring(2, 9),
            timeTag: `第${(session.summaries || []).length + 1}幕`,
            location: activeCharacter?.scenario?.slice(0, 8) || "未知地点",
            content: compiledSummary.trim(),
          };

          const lastSummarizedMessageId = messagesToCompress[messagesToCompress.length - 1].id;

          const finalSession = {
            ...session,
            summaries: [...(session.summaries || []), newCard],
            lastSummarizedMessageId,
          };

          setSessions((prev) =>
            prev.map((s) => (s.id === finalSession.id ? finalSession : s))
          );
          await saveSession(finalSession);
          if (force) await showCustomAlert("记忆整理完毕，已收录至潜意识年表！");
        } else {
          if (force) await showCustomAlert("记忆整理失败，请检查API连接。");
        }
      } catch (e) {
        console.warn("Auto-compactor service bypassed or offline:", e);
        if (force) await showCustomAlert("记忆整理出错: " + (e as Error).message);
      }
    } else {
      if (force) await showCustomAlert("当前无需强制压缩。");
    }
  };

  const createNewBranch = async () => {
    if (!activeCharId) return;
    const branchTitle = await showCustomPrompt(
      "请输入全新独立分支存档名称:",
      `${activeCharacter?.name} - 新分支线 ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    if (!branchTitle) return;

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: activeCharId,
      title: branchTitle,
      messages: [],
      summaries: [],
      createdAt: Date.now(),
    };

    await saveSession(newSession);
    setActiveSessionId(newSession.id);
    setShowSessionManager(false);
  };

  const deleteBranch = async (id: string) => {
    const confirm = await showCustomConfirm("确定要永久删除这个聊天分支吗？(无法恢复)");
    if (!confirm) return;

    await deleteSession(id);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
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
      return remaining;
    });
  };

  const selectCharacter = async (charId: string) => {
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
      const newSession: ChatSession = {
        id: "session_" + Math.random().toString(36).substring(2, 9),
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
      };
      await saveSession(newSession);
      setActiveSessionId(newSession.id);
    }
    setActiveTab("chat");
    triggerScroll();
  };

  const createBacktrackBranch = async (msg: Message) => {
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
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: activeCharId!,
      title: branchTitle,
      createdAt: Date.now(),
      messages: sourceSubHistory,
      summaries: [...(activeSession.summaries || [])],
    };

    await saveSession(newSession);
    setActiveSessionId(newSession.id);
    setMsgMenuId(null);
    setChatSubTab("dialogue");
    await showCustomAlert("分支故事线创建完美拉起！您已成功无痛回溯至选定对话时间轴。");
    triggerScroll();
  };

  const createBacktrackFromTimeline = async (summary: SummaryCard) => {
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
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: activeCharId!,
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

    await saveSession(newSession);
    setActiveSessionId(newSession.id);
    setChatSubTab("dialogue");
    await showCustomAlert(`已基于时间线：“${summary.timeTag}” 重构分叉世界！`);
    triggerScroll();
  };

  const handleAddTimelineSummary = async () => {
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
            }
          : s
      );
    } else {
      const newCard: SummaryCard = {
        id: "summary_" + Math.random().toString(36).substring(2, 9),
        timeTag: newSummaryTag.trim(),
        location: newSummaryLoc.trim() || "未知地点",
        content: newSummaryContent.trim(),
      };
      updatedSummaries = [...(activeSession.summaries || []), newCard];
    }

    const updatedSession = {
      ...activeSession,
      summaries: updatedSummaries,
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
    await saveSession(updatedSession);

    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
    setEditingSummaryId(null);
    setTimelineModalOpen(false);
  };

  const renderDialogueBubble = (text: string) => {
    const processedText = (text || "").replace(
      /\{\{user\}\}/gi,
      settings.userName || "未知探客"
    );

    if (settings.enableHtmlRendering) {
      // DOMPurify 消毒防止 XSS：允许基本格式标签，移除 script/iframe/事件属性等危险内容
      const sanitized = DOMPurify.sanitize(processedText, {
        ALLOWED_TAGS: [
          "p", "br", "b", "i", "em", "strong", "u", "s", "del", "ins",
          "h1", "h2", "h3", "h4", "h5", "h6",
          "ul", "ol", "li", "dl", "dt", "dd",
          "blockquote", "pre", "code", "hr",
          "a", "span", "div", "font",
          "table", "thead", "tbody", "tr", "th", "td",
          "img", "sub", "sup", "small", "mark", "ruby", "rt", "rp",
        ],
        ALLOWED_ATTR: [
          "href", "title", "target", "rel",
          "src", "alt", "width", "height",
          "class", "id", "style",
          "colspan", "rowspan",
        ],
        ALLOW_DATA_ATTR: false,
      });
      return (
        <div
          className="font-sans font-medium text-foreground text-[15.5px] leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      );
    }

    const parts = processedText.split(
      /(\（[^）]+\）|\([^)]+\)|【[^】]+】|\*\*[^*]+\*\*|\*[^*]+\*)/g
    );
    return parts.map((part, idx) => {
      if (!part) return null;
      const isAction =
        (part.startsWith("（") && part.endsWith("）")) ||
        (part.startsWith("(") && part.endsWith(")")) ||
        (part.startsWith("【") && part.endsWith("】")) ||
        (part.startsWith("*") && part.endsWith("*"));
      if (isAction) {
        return (
          <span
            key={idx}
            className="font-serif italic text-muted-foreground font-light text-[15px] opacity-90 block my-1 whitespace-pre-wrap"
          >
            {part}
          </span>
        );
      }
      return (
        <span
          key={idx}
          className="font-sans font-medium text-foreground text-[15.5px] leading-relaxed block my-1 whitespace-pre-wrap"
        >
          {part}
        </span>
      );
    });
  };

  return {
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
    editingSummaryId,
    setEditingSummaryId,
    handleRerollFromMessage,
    handleRerollLast,
    handleAutoSummaryCheck,
    createNewBranch,
    deleteBranch,
    selectCharacter,
    createBacktrackBranch,
    createBacktrackFromTimeline,
    handleAddTimelineSummary,
    renderDialogueBubble,
  };
};
