import {
  PlayCircle, RefreshCw, Sparkles, Play,
  MessageSquare, Search, User, Settings, Cpu, Layers, Radio, Braces, Smartphone,
} from "lucide-react";
import { FLOW_NODES } from "./flowNodes";
import type { PlaygroundActions } from "./usePlaygroundActions";

interface FlowchartPanelProps {
  actions: PlaygroundActions;
  onJumpToSse: () => void;
}

export default function FlowchartPanel({ actions, onJumpToSse }: FlowchartPanelProps) {
  const {
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
    mockSettings,
    setMockSettings,
  } = actions;

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

  return (
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
          {FLOW_NODES.map((node, index) => {
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
        const activeNode = FLOW_NODES.find((n) => n.id === selectedNodeId);
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
                    onClick={onJumpToSse}
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
  );
}
