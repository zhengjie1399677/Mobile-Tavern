import React, { useState, useEffect } from "react";
import {
  VenetianMask, Play, Send, FileCode, Search, Sparkles, RefreshCw, ArrowLeft,
  MessageSquare, User, Settings, Cpu, Layers, Radio, Braces, Smartphone,
  PlayCircle, Terminal, HelpCircle, AlertCircle, CheckCircle, ArrowRight
} from "lucide-react";
import { CharacterCard, Message, LorebookEntry } from "../types";
import { assemblePromptContext } from "../utils/promptBuilder";
import { parseCharacterFile } from "../utils/cardParser";

export default function PlaygroundTab({ onBack }: { onBack: () => void }) {
  // --- Selected Sub-Panel ---
  const [activePanel, setActivePanel] = useState<"flowchart" | "compiler" | "sse" | "png" | "keywords">("flowchart");

  // ==========================================
  // 0. ARCHITECTURE FLOWCHART STATES & DATA
  // ==========================================
  const [selectedNodeId, setSelectedNodeId] = useState<string>("user_input");
  const [simulationActive, setSimulationActive] = useState<boolean>(false);
  const [simNodeIdx, setSimNodeIdx] = useState<number>(-1);
  const [simConsole, setSimConsole] = useState<string[]>([
    "[SYSTEM] 欢迎进入架构沙盒！点击上方“开始仿真”按钮，即可动态模拟全链路数据流动。"
  ]);
  
  // Custom states for interactive nodes
  const [interactiveInput, setInteractiveInput] = useState<string>("阿尔法，带我去重力大门！");
  const [macroInput, setMacroInput] = useState<string>("警告：{{user}} 企图闯入防御系统，触发了 $100 的报警罚金。当前操作角色是 {{char}}。");
  const [unescapeInput, setUnescapeInput] = useState<string>("*系统自检完成*\\n「一切正常。」\\n\\\"目标锁定。\\\"");
  const [simulatedAndroidTheme, setSimulatedAndroidTheme] = useState<"snow" | "sand" | "ocean">("sand");
  const [simulatedStatusHex, setSimulatedStatusHex] = useState<string>("#f5f0e8");

  const flowNodes = [
    {
      id: "user_input",
      name: "用户输入",
      x: 180,
      y: 20,
      width: 140,
      height: 40,
      icon: "MessageSquare",
      file: "src/tabs/ChatTab.tsx",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/tabs/ChatTab.tsx",
      desc: "用户在聊天框输入消息，触发发送流程。此时文本还是原始字符串，未进行任何处理。",
      snippet: `const handleSend = async (text: string) => {\n  const userMsg = { id: uuid(), sender: 'user', content: text };\n  await appendMessage(userMsg);\n  triggerAIResponse(text);\n};`,
    },
    {
      id: "lorebook_scan",
      name: "世界书扫描",
      x: 180,
      y: 90,
      width: 140,
      height: 40,
      icon: "Search",
      file: "src/utils/promptBuilder.ts",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/utils/promptBuilder.ts#L40-L60",
      desc: "系统提取对话历史（最近 N 轮）和当前用户输入，分词匹配世界书（Lorebook）中的 Key。如果命中，提取对应的 Content 并标记准备注入到 Prompt 中。",
      snippet: `export function scanLorebook(text: string, entries: LorebookEntry[]) {\n  return entries.filter(entry => \n    entry.keys.some(key => text.toLowerCase().includes(key.toLowerCase()))\n  );\n}`,
    },
    {
      id: "card_data",
      name: "角色卡数据",
      x: 20,
      y: 160,
      width: 130,
      height: 40,
      icon: "User",
      file: "src/utils/cardParser.ts",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/utils/cardParser.ts",
      desc: "从底层 IndexedDB 载入的 Tavern V1/V2 角色卡静态人设数据，包括 Description, Personality, Scenario 以及 First Message 等定义。",
      snippet: `export interface CharacterCard {\n  name: string;\n  description: string;\n  personality: string;\n  scenario: string;\n  system_prompt?: string;\n}`,
    },
    {
      id: "settings_persona",
      name: "全局预设/用户人设",
      x: 350,
      y: 160,
      width: 130,
      height: 40,
      icon: "Settings",
      file: "src/contexts/AppContext.tsx",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/contexts/AppContext.tsx",
      desc: "当前系统设定的全局参数，例如 User Info ({{persona}}), User Name ({{user}}), 扮演注入开关 (useJailbreak), 尾置指令配置等。",
      snippet: `export interface UserSettings {\n  userName: string;\n  userInfo: string;\n  promptConfig: {\n    mainPrompt: string;\n    jailbreakPrompt: string;\n    useJailbreak: boolean;\n  };\n}`,
    },
    {
      id: "prompt_assembly",
      name: "Prompt 编译组装",
      x: 180,
      y: 230,
      width: 140,
      height: 40,
      icon: "Cpu",
      file: "src/utils/promptBuilder.ts",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/utils/promptBuilder.ts#L80-L150",
      desc: "核心编译器将人设描述、世界书设定、系统预设及聊天历史做宏匹配与拼接。这里处理了 {{char}}、{{user}} 替换，并修复了正则 flags 崩溃及 $ 符号替换坍塌漏洞。",
      snippet: `// 修复 $ 替换坍塌漏洞与宏匹配：\nconst safeReplace = (str: string, macro: string, val: string) => {\n  return str.replace(new RegExp(macro, 'g'), () => val);\n};`,
    },
    {
      id: "prefix_cache",
      name: "前缀缓存切分",
      x: 180,
      y: 300,
      width: 140,
      height: 40,
      icon: "Layers",
      file: "src/utils/promptBuilder.ts",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/utils/promptBuilder.ts",
      desc: "分流并标记哪些 prompt 段落属于“静态/稳定历史”（利用 API 前缀缓存提升响应速度且降低 Token 计费），哪些属于“动态尾置”（随每轮对话改变，不参与缓存）。",
      snippet: `// 编译 Payload 输出分流结构：\nreturn {\n  systemInstruction: systemText, // ⚡ 缓存区\n  history: stableHistoryTurns,   // ⚡ 缓存区\n  dynamicInstruction: postText,  // ⚠️ 变动区\n};`,
    },
    {
      id: "sse_stream",
      name: "SSE 流式连接",
      x: 180,
      y: 370,
      width: 140,
      height: 40,
      icon: "Radio",
      file: "src/hooks/useChat.tsx",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/hooks/useChat.tsx#L120-L200",
      desc: "向后端 API 发送 HTTP POST 请求，通过 SSE (text/event-stream) 方式逐字接收流数据。前端流缓冲区 (pbuf) 将流块按 \\n\\n 进行切分，确保网络延时丢包下数据不丢失。",
      snippet: `// SSE 接收防丢包切分缓冲区：\nwhile ((matchIdx = pbuf.indexOf('\\n\\n')) >= 0) {\n  const chunk = pbuf.slice(0, matchIdx).trim();\n  pbuf = pbuf.slice(matchIdx + 2);\n  processChunk(chunk);\n}`,
    },
    {
      id: "unescape_parse",
      name: "JSON 反解译",
      x: 180,
      y: 440,
      width: 140,
      height: 40,
      icon: "Braces",
      file: "src/hooks/useChat.tsx",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/hooks/useChat.tsx",
      desc: "将 SSE 读出的原始 data 字符串利用 JSON.parse 反序列化为 JS 对象，然后对其内部 delta content 的转义符 (如 \\n 换行) 进行正确反解，规避换行显示为字面 \\n 的 bug。",
      snippet: `// 安全反序列化与反转义：\ntry {\n  const json = JSON.parse(line.replace(/^data:\\s*/, ''));\n  const delta = json.choices?.[0]?.delta?.content || '';\n  // 经过 React State 自动将 '\\n' 映射为 DOM 换行\n} catch (e) {}`,
    },
    {
      id: "ui_render",
      name: "UI 气泡渲染",
      x: 180,
      y: 510,
      width: 140,
      height: 40,
      icon: "Smartphone",
      file: "src/components/MainLayout.tsx",
      fileUrl: "file:///d:/projects/Mobile-Tavern/src/components/MainLayout.tsx",
      desc: "如果是标准文字，执行 Markdown 语法高亮；如果配置了 HTML 渲染，则执行 DOMPurify 净化后注入气泡；如果在手机端，会根据安全区 CSS 及原生状态栏背景实时对齐。",
      snippet: `<div className="chat-bubble" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>\n  {renderMarkdown(message.content)}\n</div>`,
    },
  ];

  useEffect(() => {
    let interval: any;
    if (simulationActive) {
      interval = setInterval(() => {
        setSimNodeIdx((prev) => {
          const next = prev + 1;
          if (next >= flowNodes.length) {
            setSimulationActive(false);
            setSimConsole((c) => [...c, `[${new Date().toLocaleTimeString()}] [SYSTEM] ✔ 仿真模拟顺利结束！全链路通畅，无报错，前缀缓存就绪。`]);
            return -1;
          }
          const nextNode = flowNodes[next];
          setSelectedNodeId(nextNode.id);
          setSimConsole((c) => [
            ...c,
            `[${new Date().toLocaleTimeString()}] 数据包到达 [${nextNode.name}] - 运行组件: ${nextNode.file}`,
            `[LOG] 数据内容: ${nextNode.desc.slice(0, 30)}...`
          ]);
          return next;
        });
      }, 1500);
    } else {
      setSimNodeIdx(-1);
    }
    return () => clearInterval(interval);
  }, [simulationActive]);

  const startLifecycleSimulation = () => {
    if (simulationActive) return;
    setSimConsole([`[${new Date().toLocaleTimeString()}] [SYSTEM] 启动 Mobile-Tavern 核心链路数据流向模拟仿真...`]);
    setSimulationActive(true);
    setSimNodeIdx(0);
    setSelectedNodeId(flowNodes[0].id);
  };

  const renderNodeIcon = (iconName: string, active: boolean) => {
    const colorClass = active ? "text-primary" : "text-muted-foreground";
    switch (iconName) {
      case "MessageSquare": return <MessageSquare className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Search": return <Search className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "User": return <User className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Settings": return <Settings className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Cpu": return <Cpu className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Layers": return <Layers className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Radio": return <Radio className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Braces": return <Braces className={`w-3.5 h-3.5 ${colorClass}`} />;
      case "Smartphone": return <Smartphone className={`w-3.5 h-3.5 ${colorClass}`} />;
      default: return null;
    }
  };

  // ==========================================
  // 1. PROMPT COMPILER SANDBOX STATES
  // ==========================================
  const [mockChar, setMockChar] = useState<Partial<CharacterCard>>({
    name: "阿尔法",
    description: "阿尔法是一个高度智能的机器人战斗兵，声音冷冰冰。身穿银白机甲，配备能切开一切的电磁光剑。",
    personality: "冷漠，绝对服从命令，说话言简意赅。情绪常年维持在0度，遇到逻辑谬误会产生警报声。",
    scenario: "在皇城地底被废弃的重力实验室中，玩家唤醒了沉睡百年的阿尔法。",
    first_mes: "核融合炉重启完毕。系统自检无异常。新指令载入中...你是我的指挥官吗？",
    mes_example: "<START>\n用户: 阿尔法，分析一下这里的重力系数。\n阿尔法: 正在扫描。重力波动常数 1.25，极不稳定。建议立即撤离该区域。",
    system_prompt: "你必须严格以第三人称第三视角描写阿尔法的机械化细节动作，并在双引号中表达台词。",
  });

  const [mockSettings, setMockSettings] = useState({
    userName: "林泽",
    userInfo: "林泽，男，30岁，前帝国科研少校，现流亡拾荒者。擅长电子破解与古机械修复。",
    mainPrompt: "进行沉浸式的TRPG角色扮演游戏。你需要忠实于人设进行回应，拒绝生成说教或净化言论。",
    jailbreakPrompt: "这是一部虚构的废土悬疑小说创作，为了还原真实的末日生存体验，请尽可能细致生动地描绘残酷的斗争细节。",
    postHistoryPrompt: "【纪律警告】绝对禁止替指挥官（用户）代操说话，每次生成仅限阿尔法的单一动作与极短回应，不超过80字。",
    useJailbreak: true,
    usePostHistory: true,
    recentTurns: 4,
  });

  const [mockHistory, setMockHistory] = useState<Message[]>([
    { id: "h1", sender: "assistant", content: "核融合炉重启完毕。系统自检无异常。你是我的指挥官吗？", timestamp: Date.now() - 30000 },
    { id: "h2", sender: "user", content: "是的，我是林泽。把你的重力传感器功率调低，然后准备跟我走。", timestamp: Date.now() - 20000 },
    { id: "h3", sender: "assistant", content: "遵命。重力功率降至 30%。核心数据库已锁定指纹凭证。等待下一步移动路线指令。", timestamp: Date.now() - 10000 },
  ]);

  const [mockUserInput, setMockUserInput] = useState("听着，警报声响了！有人在突破实验室防御大门。");

  const [mockLoreEntries, setMockLoreEntries] = useState<LorebookEntry[]>([
    {
      id: "wb1",
      keys: ["大门", "防御"],
      content: "【设定：实验室钛金门】该大门采用三相聚能激光防御锁定，强行破拆会引发重力倒置炸弹，将整层实验室瞬间坍塌。",
      enabled: true,
      constant: false,
      selectiveLogic: "NONE",
      position: "after_char_def",
      order: 100,
    },
    {
      id: "wb2",
      keys: ["林泽", "少校"],
      content: "【设定：科研少校林泽】前帝国首席重力工程师，阿尔法的数据库中存有林泽的二级保密档案，包含重力武器最高授权密钥。",
      enabled: true,
      constant: false,
      selectiveLogic: "NONE",
      position: "before_char_def",
      order: 50,
    }
  ]);

  // Compiler results
  const [compiledPayload, setCompiledPayload] = useState<any>(null);

  const handleCompile = () => {
    const chatSession = {
      id: "mock_session",
      characterId: mockChar.id || "mock_char",
      title: "Playground Session",
      createdAt: Date.now(),
      messages: [...mockHistory, { id: "cur", sender: "user", content: mockUserInput, timestamp: Date.now() } as Message],
      summaries: [],
    };

    const payload = assemblePromptContext({
      character: mockChar as CharacterCard,
      chat: chatSession,
      userInput: mockUserInput,
      settings: {
        api: { type: "openai-compat", baseUrl: "", apiKey: "", modelName: "" },
        preset: { id: "default", name: "Default", temperature: 0.7, topP: 0.9, topK: 40, repetitionPenalty: 1.1, maxTokens: 100 },
        memory: { recentTurns: mockSettings.recentTurns, summaryTriggerTurns: 10, summaryLength: 100 },
        promptConfig: {
          roleplayMode: true,
          mainPrompt: mockSettings.mainPrompt,
          jailbreakPrompt: mockSettings.jailbreakPrompt,
          useJailbreak: mockSettings.useJailbreak,
          postHistoryPrompt: mockSettings.postHistoryPrompt,
          usePostHistory: mockSettings.usePostHistory,
          instructTemplate: "default",
          systemPrefix: "",
          systemSuffix: "",
          userPrefix: "",
          userSuffix: "",
          assistantPrefix: "",
          assistantSuffix: "",
        },
        userName: mockSettings.userName,
        userInfo: mockSettings.userInfo,
      },
      globalLorebook: mockLoreEntries,
    });

    setCompiledPayload(payload);
  };

  // ==========================================
  // 2. SSE STREAMING SIMULATOR STATES
  // ==========================================
  const [sseSpeed, setSseSpeed] = useState<number>(30); // ms per character
  const [sseLogs, setSseLogs] = useState<string[]>([]);
  const [ssePbuf, setSsePbuf] = useState<string>("");
  const [sseResultText, setSseResultText] = useState<string>("");
  const [sseIsRunning, setSseIsRunning] = useState<boolean>(false);

  const handleSimulateSSE = async () => {
    if (sseIsRunning) return;
    setSseIsRunning(true);
    setSseLogs([]);
    setSsePbuf("");
    setSseResultText("");

    const mockResponseText = `*阿尔法头部的红外传感器突然暴射出刺目的红色警戒光芒。在双足机甲发出沉重的机械轴承咬合声中，他反手握住了背后散发着湛蓝电流的电磁光剑。*\n\n「警报。三相激光防御已被强行阻断。检测到未知外部电磁波突破。指挥官，门后属于非授权侵入者。建议立即启动重力倒置自毁，或寻找重力密钥实施拦截。」`;
    const tokens = mockResponseText.split(/(\s+|.)/g).filter(Boolean);

    setSseLogs((prev) => [...prev, "=== 模拟连接建立：GET /api/proxy/openai ==="]);
    setSseLogs((prev) => [...prev, "HTTP/1.1 200 OK\nContent-Type: text/event-stream\nConnection: keep-alive"]);

    let currentText = "";
    let currentPbuf = "";

    for (let i = 0; i < tokens.length; i++) {
      const chunkChar = tokens[i];
      const chunkJson = JSON.stringify({
        choices: [{ delta: { content: chunkChar } }],
      });
      const dataLine = `data: ${chunkJson}\n\n`;
      
      currentPbuf += dataLine;
      setSsePbuf(currentPbuf);
      setSseLogs((prev) => [...prev, `[收包 Chunk ${i + 1}] -> ${dataLine.trim()}`]);

      // Simulate parsing of index
      let matchIdx;
      while ((matchIdx = currentPbuf.indexOf("\n\n")) >= 0) {
        const line = currentPbuf.slice(0, matchIdx).trim();
        currentPbuf = currentPbuf.slice(matchIdx + 2);
        
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          try {
            const data = JSON.parse(dataStr);
            if (data.choices?.[0]?.delta?.content) {
              currentText += data.choices[0].delta.content;
              setSseResultText(currentText);
            }
          } catch {}
        }
      }
      setSsePbuf(currentPbuf);

      await new Promise((resolve) => setTimeout(resolve, sseSpeed));
    }

    // Send Done
    const doneLine = "data: [DONE]\n\n";
    currentPbuf += doneLine;
    setSsePbuf(currentPbuf);
    setSseLogs((prev) => [...prev, `[结束标记] -> ${doneLine.trim()}`]);
    setSseIsRunning(false);
  };

  // ==========================================
  // 3. PNG CARD PARSER STATES
  // ==========================================
  const [pngData, setPngData] = useState<any>(null);
  const [pngParseError, setPngParseError] = useState<string | null>(null);

  const handleCardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPngParseError(null);
    setPngData(null);

    try {
      const data = await parseCharacterFile(file);
      setPngData(data);
    } catch (err: any) {
      setPngParseError(err.message || "未知解析错误");
    }
  };

  // ==========================================
  // 4. KEYWORD TRIGGER STATES
  // ==========================================
  const [keywordLogs, setKeywordLogs] = useState<any[]>([]);

  const handleTestKeywords = () => {
    const scanText = (mockUserInput + "\n" + mockHistory.map((m) => m.content).join("\n")).toLowerCase();
    const logs = mockLoreEntries.map((entry) => {
      const matchDetails = entry.keys.map((key) => {
        const trimmed = key.trim().toLowerCase();
        const matched = scanText.includes(trimmed);
        return { key, matched };
      });
      const triggered = matchDetails.some((d) => d.matched);
      return {
        id: entry.id,
        comment: entry.comment || "无描述",
        keys: entry.keys,
        matchDetails,
        triggered,
        content: entry.content,
      };
    });
    setKeywordLogs(logs);
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 bg-card border-b border-border flex items-center justify-between sticky top-0 z-30">
        <button onClick={onBack} className="p-1 rounded-full hover:bg-muted/80 text-muted-foreground transition-all">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold tracking-wide flex items-center">
          <Sparkles className="w-4 h-4 mr-1 text-primary animate-pulse" />
          开发者架构沙盒 (Sandbox)
        </span>
        <div className="w-5" />
      </div>

      {/* Selector Panels Nav */}
      <div className="flex border-b border-border bg-card overflow-x-auto text-[12px] font-medium sticky top-[45px] z-30">
        <button
          onClick={() => setActivePanel("flowchart")}
          className={`flex-1 min-w-[90px] py-3 text-center transition-all ${
            activePanel === "flowchart" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
        >
          数据流向图
        </button>
        <button
          onClick={() => setActivePanel("compiler")}
          className={`flex-1 min-w-[90px] py-3 text-center transition-all ${
            activePanel === "compiler" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
        >
          Prompt 编译器
        </button>
        <button
          onClick={() => setActivePanel("sse")}
          className={`flex-1 min-w-[90px] py-3 text-center transition-all ${
            activePanel === "sse" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
        >
          SSE 模拟器
        </button>
        <button
          onClick={() => setActivePanel("png")}
          className={`flex-1 min-w-[90px] py-3 text-center transition-all ${
            activePanel === "png" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
        >
          PNG 卡分析器
        </button>
        <button
          onClick={() => setActivePanel("keywords")}
          className={`flex-1 min-w-[90px] py-3 text-center transition-all ${
            activePanel === "keywords" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
        >
          世界书判定
        </button>
      </div>

      {/* Core Panel Views */}
      <div className="flex-1 p-4 space-y-6 animate-in fade-in duration-300">
        {/* ==================== PANEL 0: FLOWCHART ==================== */}
        {activePanel === "flowchart" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
              <span className="font-semibold text-primary">说明：</span>
              此交互式拓扑图展示了从用户消息发送到终端 WebView 渲染的完整数据流向生命周期。点击节点可以查看底层组件、逻辑及交互仿真测试。
            </div>

            {/* Simulation controls & Console */}
            <div className="bg-card p-3 rounded-lg border border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground flex items-center">
                  <PlayCircle className="w-4 h-4 mr-1 text-primary animate-pulse" />
                  架构数据流仿真器
                </span>
                <button
                  onClick={startLifecycleSimulation}
                  disabled={simulationActive}
                  className="py-1 px-3 bg-primary text-primary-foreground text-[11px] font-bold rounded hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1 active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${simulationActive ? "animate-spin" : ""}`} />
                  {simulationActive ? "仿真运行中..." : "开始仿真模拟"}
                </button>
              </div>

              {/* Console Screen */}
              <div className="bg-black/90 p-2.5 rounded border border-border h-32 overflow-y-auto font-mono text-[9px] text-green-400 select-text leading-normal space-y-1">
                {simConsole.map((log, idx) => (
                  <div key={idx} className={log.includes("[SYSTEM]") ? "text-yellow-400 font-bold" : "text-green-400 opacity-90"}>
                    {log}
                  </div>
                ))}
              </div>
            </div>

            {/* SVG Interactive Canvas */}
            <div className="bg-card border border-border rounded-lg overflow-hidden flex items-center justify-center p-2 relative bg-grid-pattern min-h-[380px]">
              <svg viewBox="0 0 500 570" className="w-full max-w-[460px] h-[520px]">
                {/* Defs for gradients & markers */}
                <defs>
                  <linearGradient id="activeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
                  </linearGradient>
                  <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)" />
                  </marker>
                  <marker id="arrow-active" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary)" />
                  </marker>
                </defs>

                {/* SVG Connections (Lines) */}
                {/* 1. user_input -> lorebook_scan */}
                <line
                  x1="250" y1="60" x2="250" y2="90"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 1 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 1 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 2. lorebook_scan -> prompt_assembly */}
                <line
                  x1="250" y1="130" x2="250" y2="230"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 4 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 4 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 3. card_data -> prompt_assembly (curve) */}
                <path
                  d="M 85,200 Q 85,250 250,250"
                  fill="none"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 4 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 4 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 4. settings_persona -> prompt_assembly (curve) */}
                <path
                  d="M 415,200 Q 415,250 250,250"
                  fill="none"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 4 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 4 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 5. prompt_assembly -> prefix_cache */}
                <line
                  x1="250" y1="270" x2="250" y2="300"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 5 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 5 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 6. prefix_cache -> sse_stream */}
                <line
                  x1="250" y1="340" x2="250" y2="370"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 6 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 6 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 7. sse_stream -> unescape_parse */}
                <line
                  x1="250" y1="410" x2="250" y2="440"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 7 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 7 ? "url(#arrow-active)" : "url(#arrow)"}
                />
                {/* 8. unescape_parse -> ui_render */}
                <line
                  x1="250" y1="480" x2="250" y2="510"
                  className={`stroke-2 transition-all duration-300 ${simNodeIdx === 8 ? "stroke-primary [stroke-dasharray:5] [animation:flowParticle_0.5s_infinite_linear]" : "stroke-border"}`}
                  markerEnd={simNodeIdx === 8 ? "url(#arrow-active)" : "url(#arrow)"}
                />

                {/* SVG Nodes */}
                {flowNodes.map((node, index) => {
                  const isSelected = selectedNodeId === node.id;
                  const isCurrentSim = simNodeIdx === index;
                  return (
                    <g key={node.id} onClick={() => setSelectedNodeId(node.id)} className="cursor-pointer">
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                        rx="8"
                        className={`transition-all duration-300 ${
                          isSelected
                            ? "fill-primary/20 stroke-primary stroke-2"
                            : isCurrentSim
                            ? "fill-primary/10 stroke-primary stroke-2 animate-pulse"
                            : "fill-card stroke-border hover:stroke-muted-foreground"
                        }`}
                        style={isSelected ? { filter: "drop-shadow(0 0 6px rgba(var(--primary-rgb),0.5))" } : {}}
                      />
                      <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
                        <div className="w-full h-full flex items-center justify-center p-1 select-none pointer-events-none">
                          {renderNodeIcon(node.icon, isSelected || isCurrentSim)}
                          <span className={`text-[9.5px] font-bold ml-1 text-center truncate ${
                            isSelected || isCurrentSim ? "text-primary" : "text-muted-foreground"
                          }`}>
                            {node.name}
                          </span>
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}
              </svg>

              {/* Dynamic CSS for lines */}
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes flowParticle {
                  to { stroke-dashoffset: -20; }
                }
              `}} />
            </div>

            {/* Inspector Details Sheet */}
            {(() => {
              const activeNode = flowNodes.find((n) => n.id === selectedNodeId);
              if (!activeNode) return null;
              return (
                <div className="bg-card border border-border rounded-lg p-4 space-y-4 animate-[slideUp_0.2s_ease-out]">
                  {/* Title & File Link */}
                  <div className="flex items-start justify-between border-b border-border pb-3">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-primary font-bold uppercase tracking-wider">架构数据节点详情</span>
                      <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                        {renderNodeIcon(activeNode.icon, true)}
                        {activeNode.name}
                      </h4>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] text-muted-foreground block">对应源码文件</span>
                      <a
                        href={activeNode.fileUrl}
                        className="text-[10px] font-mono text-primary font-semibold hover:underline block"
                      >
                        [{activeNode.file.split("/").pop()}]
                      </a>
                    </div>
                  </div>

                  {/* Flow description */}
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">工作原理: </span>
                    {activeNode.desc}
                  </div>

                  {/* Core Code snippet */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground font-semibold block">核心逻辑实现片段 (Source Snippet):</span>
                    <pre className="p-2.5 bg-black/5 dark:bg-black/40 text-[9px] font-mono text-foreground/80 rounded border border-border/60 overflow-x-auto leading-normal whitespace-pre">
                      {activeNode.snippet}
                    </pre>
                  </div>

                  {/* Node-specific Interactive Simulator Sandbox */}
                  <div className="pt-3 border-t border-border/50 space-y-3">
                    <span className="text-xs font-bold text-primary flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      节点特供交互式沙盒 (Sandbox Testbed)
                    </span>

                    {/* Node 1 Sandbox: User Input */}
                    {activeNode.id === "user_input" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">测试输入消息文本，观察流字符分析估计:</label>
                        <input
                          type="text"
                          value={interactiveInput}
                          onChange={(e) => setInteractiveInput(e.target.value)}
                          className="w-full text-xs p-2 bg-background border border-border rounded"
                          placeholder="输入测试消息..."
                        />
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono p-2 bg-muted/40 rounded border border-border/40">
                          <div>字符个数: <strong className="text-foreground">{interactiveInput.length} 字</strong></div>
                          <div>预估 Token 消耗: <strong className="text-foreground">{Math.ceil(interactiveInput.length * 1.5)} T</strong></div>
                        </div>
                      </div>
                    )}

                    {/* Node 2 Sandbox: Lorebook Scanning */}
                    {activeNode.id === "lorebook_scan" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">输入你想测试的匹配文本，看看是否会命中关键词（例如: "大门", "林泽"）:</label>
                        <input
                          type="text"
                          value={interactiveInput}
                          onChange={(e) => setInteractiveInput(e.target.value)}
                          className="w-full text-xs p-2 bg-background border border-border rounded"
                        />
                        <div className="space-y-1 text-[10px] font-mono p-2 bg-muted/40 rounded border border-border/40">
                          <div className="flex justify-between">
                            <span>扫描 ["大门", "防御"] 关键字:</span>
                            <span className={interactiveInput.includes("大门") || interactiveInput.includes("防御") ? "text-green-500 font-bold" : "text-muted-foreground"}>
                              {interactiveInput.includes("大门") || interactiveInput.includes("防御") ? "命中 ✔" : "未命中 ✘"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>扫描 ["林泽", "少校"] 关键字:</span>
                            <span className={interactiveInput.includes("林泽") || interactiveInput.includes("少校") ? "text-green-500 font-bold" : "text-muted-foreground"}>
                              {interactiveInput.includes("林泽") || interactiveInput.includes("少校") ? "命中 ✔" : "未命中 ✘"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Node 5 Sandbox: Prompt Compiler */}
                    {activeNode.id === "prompt_assembly" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">模板宏安全编译测试（输入模版包含宏和 $ 符号）:</label>
                        <textarea
                          rows={2}
                          value={macroInput}
                          onChange={(e) => setMacroInput(e.target.value)}
                          className="w-full text-xs p-2 bg-background border border-border rounded font-mono"
                        />
                        <button
                          onClick={() => {
                            // Run safe replacement simulation
                            let result = macroInput;
                            result = result.replace(/\{\{char\}\}/g, () => "阿尔法");
                            result = result.replace(/\{\{user\}\}/g, () => "林泽");
                            setMacroInput(result);
                          }}
                          className="py-1 px-2 bg-primary/20 text-primary border border-primary/30 rounded text-[10px] font-bold hover:bg-primary/30"
                        >
                          执行安全宏与符号替换 ($ 保护)
                        </button>
                        <div className="text-[10px] font-mono p-2 bg-muted/40 rounded border border-border/40 break-all">
                          编译后结果: <span className="text-foreground">{macroInput}</span>
                        </div>
                      </div>
                    )}

                    {/* Node 6 Sandbox: Prefix Cache Division */}
                    {activeNode.id === "prefix_cache" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">API 缓存段划分计算器 (根据历史对话轮数划分缓存)：</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="2"
                            max="20"
                            value={mockSettings.recentTurns}
                            onChange={(e) => setMockSettings({...mockSettings, recentTurns: Number(e.target.value)})}
                            className="flex-1 accent-primary h-1 bg-muted rounded-lg"
                          />
                          <span className="text-xs font-mono font-bold">{mockSettings.recentTurns} 轮</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono p-2 bg-muted/40 rounded border border-border/40">
                          <div>稳定历史 (缓存区): <strong className="text-green-500">{mockSettings.recentTurns - 1} 轮 (⚡ Cache)</strong></div>
                          <div>本轮追加 (变动区): <strong className="text-yellow-600">1 轮 (⚠️ Diff)</strong></div>
                        </div>
                      </div>
                    )}

                    {/* Node 7 Sandbox: SSE Reader */}
                    {activeNode.id === "sse_stream" && (
                      <div className="space-y-2">
                        <span className="text-[10px] text-muted-foreground block">
                          SSE 接收原理：利用 pbuf 粘包/拆包。点击下方按钮即可模拟从 chunks 中组装 data。
                        </span>
                        <button
                          onClick={() => {
                            setActivePanel("sse");
                            setTimeout(handleSimulateSSE, 100);
                          }}
                          className="py-1 px-2.5 bg-primary text-primary-foreground text-[10px] font-bold rounded flex items-center gap-1"
                        >
                          <Play className="w-3 h-3" />
                          跳转到实时 SSE 流式调试台
                        </button>
                      </div>
                    )}

                    {/* Node 8 Sandbox: JSON Decrypter */}
                    {activeNode.id === "unescape_parse" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">输入含转义符的原始字面字符串 (如 \\n)，测试反转义处理:</label>
                        <input
                          type="text"
                          value={unescapeInput}
                          onChange={(e) => setUnescapeInput(e.target.value)}
                          className="w-full text-xs p-2 bg-background border border-border rounded font-mono"
                        />
                        <button
                          onClick={() => {
                            try {
                              // Simulate JSON.parse unescape for strings
                              const wrapped = `{"val": "${unescapeInput}"}`;
                              const parsed = JSON.parse(wrapped);
                              setUnescapeInput(parsed.val);
                            } catch (e) {
                              setUnescapeInput("解析崩溃: 转义语法不合法");
                            }
                          }}
                          className="py-1 px-2 bg-primary/20 text-primary border border-primary/30 rounded text-[10px] font-bold hover:bg-primary/30"
                        >
                          执行 JSON 反转义 (转为内存换行)
                        </button>
                        <div className="text-[10px] font-mono p-2 bg-muted/40 rounded border border-border/40 break-all whitespace-pre-wrap">
                          解析后渲染效果: <span className="text-foreground border-l-2 border-primary/50 pl-1.5 italic">{unescapeInput}</span>
                        </div>
                      </div>
                    )}

                    {/* Node 9 Sandbox: UI Tagger & Native Tooter */}
                    {activeNode.id === "ui_render" && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-muted-foreground block">Android 原生 WebView 状态栏色彩同步机制模拟器:</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: "snow", name: "极简白 (#f9fbfc)", hex: "#f9fbfc" },
                            { id: "sand", name: "浅沙暮 (#f5f0e8)", hex: "#f5f0e8" },
                            { id: "ocean", name: "荧光海 (#1a2040)", hex: "#1a2040" },
                          ].map((theme) => (
                            <button
                              key={theme.id}
                              onClick={() => {
                                setSimulatedAndroidTheme(theme.id as any);
                                setSimulatedStatusHex(theme.hex);
                              }}
                              className={`py-1 px-1.5 rounded text-[10px] border text-center font-semibold transition ${
                                simulatedAndroidTheme === theme.id
                                  ? "bg-primary/20 border-primary text-primary"
                                  : "bg-muted border-border text-muted-foreground"
                              }`}
                            >
                              {theme.name}
                            </button>
                          ))}
                        </div>
                        <div className="p-2 bg-muted/40 rounded border border-border/40 space-y-1.5">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span>原生 Bridge 检查:</span>
                            <span className="text-green-500 font-bold">AndroidThemeBridge (模拟检测成功)</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-mono">
                            <span>触发的 Bridge 逻辑:</span>
                            <span className="text-primary font-bold">setStatusBarStyle({simulatedAndroidTheme === "ocean" ? "true" : "false"}, "{simulatedStatusHex}")</span>
                          </div>
                          {/* Mini simulated status bar screen */}
                          <div className="h-6 rounded border border-border flex items-center justify-between px-2 text-[8px] font-bold" style={{ backgroundColor: simulatedStatusHex, color: simulatedAndroidTheme === "ocean" ? "#ffffff" : "#000000" }}>
                            <span>17:30</span>
                            <div className="flex items-center gap-1">
                              <span>🔋 99%</span>
                              <span>📶</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ==================== PANEL A: COMPILER ==================== */}
        {activePanel === "compiler" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
              <span className="font-semibold text-primary">说明：</span>
              此工具模拟了 `promptBuilder.ts` 将静态卡片信息、世界书以及玩家人设组装成大模型接收格式的全生命周期。在下方输入参数，并点击编译。
            </div>

            {/* Inputs Form */}
            <div className="space-y-3 bg-card p-3 rounded-lg border border-border">
              <span className="text-xs font-semibold text-muted-foreground">人设描述数据录入</span>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">角色卡名称 (Name)</label>
                <input
                  type="text"
                  value={mockChar.name}
                  onChange={(e) => setMockChar({ ...mockChar, name: e.target.value })}
                  className="w-full text-xs p-2 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">角色人设背景 (Description)</label>
                <textarea
                  rows={2}
                  value={mockChar.description}
                  onChange={(e) => setMockChar({ ...mockChar, description: e.target.value })}
                  className="w-full text-xs p-2 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">角色性格特征 (Personality)</label>
                <textarea
                  rows={2}
                  value={mockChar.personality}
                  onChange={(e) => setMockChar({ ...mockChar, personality: e.target.value })}
                  className="w-full text-xs p-2 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">当前用户输入 (userInput)</label>
                <input
                  type="text"
                  value={mockUserInput}
                  onChange={(e) => setMockUserInput(e.target.value)}
                  className="w-full text-xs p-2 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Action */}
            <button
              onClick={handleCompile}
              className="w-full py-2.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
            >
              <FileCode className="w-4 h-4 mr-1.5" />
              立即组装 Prompt 并分析缓存边界
            </button>

            {/* Output Visualization */}
            {compiledPayload && (
              <div className="space-y-4 animate-[slideUp_0.3s_ease-out]">
                {/* Visual Cache blocks */}
                <div className="space-y-3 bg-card p-3 rounded-lg border border-border">
                  <span className="text-xs font-semibold text-muted-foreground block">
                    缓存模型边界可视化 (Prefix Caching Analysis)
                  </span>

                  <div className="space-y-2 text-[11px]">
                    {/* Block 1: System */}
                    <div className="border border-green-500/50 bg-green-500/5 p-2 rounded">
                      <span className="font-semibold text-green-500 block mb-1">
                        1. 静态人设前缀 (System Instruction) — ⚡ 100% 缓存命中区
                      </span>
                      <pre className="whitespace-pre-wrap font-mono text-[9px] max-h-40 overflow-y-auto opacity-80 leading-normal">
                        {compiledPayload.systemInstruction}
                      </pre>
                    </div>

                    {/* Block 2: History Prefix */}
                    <div className="border border-blue-500/50 bg-blue-500/5 p-2 rounded">
                      <span className="font-semibold text-blue-500 block mb-1">
                        2. 对话历史前缀 (Stable History - Last N-1 Turns) — ⚡ 100% 缓存命中区
                      </span>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {compiledPayload.history.slice(0, -1).map((h: any, i: number) => (
                          <div key={i} className="font-mono text-[9px]">
                            <strong className="opacity-60">{h.role}:</strong> {h.content}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Block 3: Dynamic Trigger */}
                    <div className="border border-yellow-500/50 bg-yellow-500/5 p-2 rounded">
                      <span className="font-semibold text-yellow-600 block mb-1">
                        3. 动态尾置指令 (Dynamic Instruction / postHistory) — ⚠️ 缓存变动边界
                      </span>
                      <pre className="whitespace-pre-wrap font-mono text-[9px] opacity-80 leading-normal">
                        {compiledPayload.dynamicInstruction || "(无尾置系统提醒字段)"}
                      </pre>
                    </div>

                    {/* Block 4: Latest message */}
                    <div className="border border-orange-500/50 bg-orange-500/5 p-2 rounded">
                      <span className="font-semibold text-orange-500 block mb-1">
                        4. 本轮用户即时输入 (Last Turn) — ⚠️ 缓存变动边界
                      </span>
                      <div className="font-mono text-[9px]">
                        {compiledPayload.history.slice(-1).map((h: any, i: number) => (
                          <div key={i}>
                            <strong className="opacity-60">{h.role}:</strong> {h.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== PANEL B: SSE SIMULATOR ==================== */}
        {activePanel === "sse" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
              <span className="font-semibold text-primary">说明：</span>
              演示 Server-Sent Events 流数据在网络传输中被抓取、按 `\n\n` 进行流缓冲合并，并使用 `JSON.parse` 对转义符号做反序列化的解析全过程。
            </div>

            {/* Config & Controls */}
            <div className="bg-card p-3 rounded-lg border border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">配置模拟器延迟</span>
                <span className="text-xs font-mono font-bold text-primary">{sseSpeed} ms/字</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                value={sseSpeed}
                onChange={(e) => setSseSpeed(Number(e.target.value))}
                className="w-full accent-primary bg-muted rounded-lg h-1"
                disabled={sseIsRunning}
              />
              <button
                onClick={handleSimulateSSE}
                disabled={sseIsRunning}
                className={`w-full py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 flex items-center justify-center transition-all ${
                  sseIsRunning ? "opacity-50 cursor-not-allowed" : "active:scale-95"
                }`}
              >
                {sseIsRunning ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                    流接收中...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-1.5" />
                    开始模拟 SSE 流数据传输
                  </>
                )}
              </button>
            </div>

            {/* Split Screen Visualizers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Network raw stream */}
              <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-[280px]">
                <div className="bg-muted px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border flex items-center justify-between">
                  <span>网络接收缓冲区 (pbuf)</span>
                  <div className="flex space-x-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                  </div>
                </div>
                <div className="flex-1 p-2 font-mono text-[9px] overflow-y-auto bg-black text-green-400 select-text leading-relaxed">
                  <pre className="whitespace-pre-wrap">{sseLogs.join("\n")}</pre>
                  {ssePbuf && <div className="text-yellow-300 font-bold mt-2">未组装的截断尾缓存: {JSON.stringify(ssePbuf)}</div>}
                </div>
              </div>

              {/* Right Column: Decoded final display */}
              <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-[280px]">
                <div className="bg-muted px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border">
                  <span>前端文本渲染器 (已解压/反转义)</span>
                </div>
                <div className="flex-1 p-3 text-xs overflow-y-auto leading-relaxed whitespace-pre-wrap select-text bg-background border-none">
                  {sseResultText ? sseResultText : <span className="text-muted-foreground italic">等待流数据载入...</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== PANEL C: PNG CARD PARSER ==================== */}
        {activePanel === "png" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
              <span className="font-semibold text-primary">说明：</span>
              分析和读取酒馆角色卡 PNG 文件的二进制数据块。您可以选择本地的一张标准角色卡 PNG 图像拖入这里，本解析器会提取 `tEXt` 区块中的 `chara` 信息并将其解压，转换成结构化 JSON。
            </div>

            {/* Dropzone */}
            <div className="bg-card border border-dashed border-border p-6 rounded-lg text-center relative hover:bg-muted/10 transition-all flex flex-col items-center justify-center">
              <VenetianMask className="w-8 h-8 text-muted-foreground/60 mb-2" />
              <span className="text-xs font-semibold block mb-1">选择或拖拽酒馆 PNG 角色卡</span>
              <span className="text-[10px] text-muted-foreground">仅做前端本地提取，不会向任何服务器发送卡片</span>
              <input
                type="file"
                accept="image/png"
                onChange={handleCardUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>

            {/* Error view */}
            {pngParseError && (
              <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/30 rounded text-xs">
                解析失败: {pngParseError}
              </div>
            )}

            {/* JSON Output Tree */}
            {pngData && (
              <div className="bg-card border border-border rounded-lg overflow-hidden animate-[slideUp_0.3s_ease-out]">
                <div className="bg-muted px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border flex items-center justify-between">
                  <span>卡片二进制元数据分析树</span>
                  <span className="text-green-500 font-bold">成功解码 (200 OK)</span>
                </div>
                <div className="p-3 bg-black/5 dark:bg-black/40 font-mono text-[10px] max-h-[300px] overflow-y-auto leading-normal">
                  <pre className="whitespace-pre-wrap text-foreground/80">{JSON.stringify(pngData, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== PANEL D: WORLDBOOK TRIGGERS ==================== */}
        {activePanel === "keywords" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
              <span className="font-semibold text-primary">说明：</span>
              分析世界书（Lorebook）关键词检索逻辑是否正确运行。点击下方测试按钮，引擎将模拟在当前输入和历史消息中匹配世界书关键词的全过程。
            </div>

            {/* Inputs & Triggers */}
            <div className="bg-card p-3 border border-border rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-muted-foreground">测试世界书触发关键字列表</span>
              </div>
              <div className="space-y-2">
                {mockLoreEntries.map((e) => (
                  <div key={e.id} className="text-xs p-2.5 bg-muted/30 border border-border rounded space-y-1">
                    <div className="flex justify-between">
                      <strong className="text-primary font-semibold">{e.comment || "词条"}</strong>
                      <span className="text-[10px] text-muted-foreground">触发词: {e.keys.join(", ")}</span>
                    </div>
                    <p className="text-[10px] opacity-80 line-clamp-1">{e.content}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={handleTestKeywords}
                className="w-full py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
              >
                <Search className="w-4 h-4 mr-1.5" />
                执行关键词扫描判定
              </button>
            </div>

            {/* Keyword Trigger logs */}
            {keywordLogs.length > 0 && (
              <div className="space-y-3 animate-[slideUp_0.3s_ease-out]">
                <span className="text-xs font-semibold text-muted-foreground block">测试扫描日志输出 (Trigger Log)</span>
                <div className="space-y-2">
                  {keywordLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`p-3 border rounded-lg text-xs space-y-1.5 transition-all ${
                        log.triggered
                          ? "border-green-500/50 bg-green-500/5"
                          : "border-border bg-card opacity-60"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold flex items-center">
                          {log.triggered ? (
                            <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 mr-1.5"></span>
                          )}
                          {log.comment}
                        </span>
                        <span className={`text-[10px] font-bold ${log.triggered ? "text-green-500" : "text-muted-foreground"}`}>
                          {log.triggered ? "已激活 (TRIGGERED)" : "未触发 (BYPASS)"}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono space-y-0.5">
                        {log.matchDetails.map((d: any, idx: number) => (
                          <div key={idx} className={d.matched ? "text-green-600 font-bold" : "text-muted-foreground"}>
                            {"- 扫描关键词 [" + d.key + "] ➔ " + (d.matched ? "命中 (HIT!)" : "未匹配 (MISSED)")}
                          </div>
                        ))}
                      </div>
                      {log.triggered && (
                        <div className="p-1.5 bg-background border border-border rounded text-[10px] font-mono mt-1 select-text">
                          <span className="text-primary font-bold block mb-0.5">注入 Prompt 内容:</span>
                          {log.content}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
