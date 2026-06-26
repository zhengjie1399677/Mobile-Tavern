import { FileCode } from "lucide-react";
import type { PlaygroundActions } from "./usePlaygroundActions";

interface CompilerPanelProps {
  actions: PlaygroundActions;
}

export default function CompilerPanel({ actions }: CompilerPanelProps) {
  const { mockChar, setMockChar, mockUserInput, setMockUserInput, compiledPayload, handleCompile } = actions;

  return (
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
  );
}
