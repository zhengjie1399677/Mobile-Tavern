const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetRegex = /\/\/ Auto compile timeline card when limit is reached[\s\S]*?(?=\n  \/\/ Test current API setup)/;

const newContent = `  // Auto compile timeline card when limit is reached
  const handleAutoSummaryCheck = async (session: ChatSession, force: boolean = false) => {
    const { recentTurns, summaryTriggerTurns, summaryLength } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const maxAllowedMessages = recentTurns + interval;

    // Compress earlier turns if message count exceeds allowed accumulation or if forced manually
    if (force || session.messages.length >= maxAllowedMessages) {
      if (session.messages.length <= 2) {
        if (force) await showCustomAlert("当前历史消息不够，无法形成记忆碎片。");
        return;
      }
      
      const messagesToCompress = force && session.messages.length < maxAllowedMessages
        ? session.messages.slice(0, session.messages.length - Math.min(2, session.messages.length - 1))
        : session.messages.slice(0, session.messages.length - recentTurns);
        
      if (messagesToCompress.length === 0) return;

      const isSystemAlreadySummarized = session.summaries.length > 0;
      
      // Request AI text auto-compactor
      try {
        const promptInstruction = "你是一个精简的大纲压缩器。请用极简的语句，将以下角色扮演的对话梗概总结为一条日记式故事时间轴记忆，格式必须如：'[时间状态(如“临晨”)] 总结内容'。字数在150字以内。";
        const contentConcat = messagesToCompress.map((m) => \`\${m.sender === "user" ? "用户" : "角色"}: \${m.content}\`).join("\\n");
        
        let compiledSummary = "";

        if (settings.api.type === "gemini-builtin") {
          const response = await fetch("/api/gemini/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: promptInstruction,
              contents: [{ role: "user", content: contentConcat }],
              modelName: settings.api.modelName || "gemini-3.5-flash",
              apiKey: settings.api.apiKey
            })
          });
          const resData = await response.json();
          if (resData.success) compiledSummary = resData.text;
        } else {
          // Fallback proxy to OpenAI compat
          const reqBody = {
            model: settings.api.modelName || "gpt-3.5-turbo",
            messages: [
              { role: "system", content: promptInstruction },
              { role: "user", content: contentConcat }
            ],
            stream: false
          };
          const response = await fetch("/api/proxy/openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl: settings.api.baseUrl,
              apiKey: settings.api.apiKey,
              reqBody
            })
          });
          const resData = await response.json();
          if (resData.choices && resData.choices.length > 0) {
            compiledSummary = resData.choices[0].message.content;
          }
        }

        if (compiledSummary) {
          const newCard: SummaryCard = {
            id: "summary_" + Math.random().toString(36).substring(2, 9),
            timeTag: \`第\${session.summaries.length + 1}幕\`,
            location: activeCharacter?.scenario?.slice(0, 8) || "未知地点",
            content: compiledSummary.trim()
          };
          
          // Retain remaining messages
          const retainCount = force && session.messages.length < maxAllowedMessages
            ? Math.min(2, session.messages.length - 1)
            : recentTurns;
          const trimmedHistory = session.messages.slice(-retainCount);
          const finalSession = {
            ...session,
            messages: trimmedHistory,
            summaries: [...session.summaries, newCard]
          };
          
          setSessions((prev) => prev.map((s) => s.id === finalSession.id ? finalSession : s));
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
  };`;

code = code.replace(targetRegex, newContent);
fs.writeFileSync('src/App.tsx', code);
console.log("Patched auto summary in App.tsx");
