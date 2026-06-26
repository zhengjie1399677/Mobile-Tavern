import { RefreshCw, Play } from "lucide-react";
import type { PlaygroundActions } from "./usePlaygroundActions";

interface SseSimulatorPanelProps {
  actions: PlaygroundActions;
}

export default function SseSimulatorPanel({ actions }: SseSimulatorPanelProps) {
  const { sseSpeed, setSseSpeed, sseLogs, ssePbuf, sseResultText, sseIsRunning, handleSimulateSSE } = actions;

  return (
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
  );
}
