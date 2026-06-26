import { useState, useEffect } from "react";
import type { ChangeEvent } from "react";
import { CharacterCard, Message, LorebookEntry } from "../../types";
import { assemblePromptContext } from "../../utils/promptBuilder";
import { parseCharacterFile } from "../../utils/cardParser";
import { FLOW_NODES } from "./flowNodes";

export function usePlaygroundActions() {
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

  useEffect(() => {
    let interval: any;
    if (simulationActive) {
      interval = setInterval(() => {
        setSimNodeIdx((prev) => {
          const next = prev + 1;
          if (next >= FLOW_NODES.length) {
            setSimulationActive(false);
            setSimConsole((c) => [...c, `[${new Date().toLocaleTimeString()}] [SYSTEM] ✔ 仿真模拟顺利结束！全链路通畅，无报错，前缀缓存就绪。`]);
            return -1;
          }
          const nextNode = FLOW_NODES[next];
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
    setSelectedNodeId(FLOW_NODES[0].id);
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

  const handleCardUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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

  return {
    // Flowchart
    selectedNodeId,
    setSelectedNodeId,
    simulationActive,
    simNodeIdx,
    simConsole,
    startLifecycleSimulation,
    interactiveInput,
    setInteractiveInput,
    macroInput,
    setMacroInput,
    unescapeInput,
    setUnescapeInput,
    simulatedAndroidTheme,
    setSimulatedAndroidTheme,
    simulatedStatusHex,
    setSimulatedStatusHex,
    // Compiler
    mockChar,
    setMockChar,
    mockSettings,
    setMockSettings,
    mockHistory,
    setMockHistory,
    mockUserInput,
    setMockUserInput,
    mockLoreEntries,
    setMockLoreEntries,
    compiledPayload,
    handleCompile,
    // SSE
    sseSpeed,
    setSseSpeed,
    sseLogs,
    ssePbuf,
    sseResultText,
    sseIsRunning,
    handleSimulateSSE,
    // PNG
    pngData,
    pngParseError,
    handleCardUpload,
    // Keywords
    keywordLogs,
    handleTestKeywords,
  };
}

export type PlaygroundActions = ReturnType<typeof usePlaygroundActions>;
