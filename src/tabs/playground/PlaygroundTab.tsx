import { useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { usePlaygroundActions } from "./usePlaygroundActions";
import FlowchartPanel from "./FlowchartPanel";
import CompilerPanel from "./CompilerPanel";
import SseSimulatorPanel from "./SseSimulatorPanel";
import PngCardParserPanel from "./PngCardParserPanel";
import WorldbookTriggersPanel from "./WorldbookTriggersPanel";

export default function PlaygroundTab({ onBack }: { onBack: () => void }) {
  // --- Selected Sub-Panel ---
  const [activePanel, setActivePanel] = useState<"flowchart" | "compiler" | "sse" | "png" | "keywords">("flowchart");
  const actions = usePlaygroundActions();

  const handleJumpToSse = () => {
    setActivePanel("sse");
    setTimeout(actions.handleSimulateSSE, 100);
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
          系统运行沙盒 (Sandbox)
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
        {activePanel === "flowchart" && <FlowchartPanel actions={actions} onJumpToSse={handleJumpToSse} />}

        {/* ==================== PANEL A: COMPILER ==================== */}
        {activePanel === "compiler" && <CompilerPanel actions={actions} />}

        {/* ==================== PANEL B: SSE SIMULATOR ==================== */}
        {activePanel === "sse" && <SseSimulatorPanel actions={actions} />}

        {/* ==================== PANEL C: PNG CARD PARSER ==================== */}
        {activePanel === "png" && <PngCardParserPanel actions={actions} />}

        {/* ==================== PANEL D: WORLDBOOK TRIGGERS ==================== */}
        {activePanel === "keywords" && <WorldbookTriggersPanel actions={actions} />}
      </div>
    </div>
  );
}
