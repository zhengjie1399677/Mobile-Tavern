import { Search } from "lucide-react";
import type { PlaygroundActions } from "./usePlaygroundActions";

interface WorldbookTriggersPanelProps {
  actions: PlaygroundActions;
}

export default function WorldbookTriggersPanel({ actions }: WorldbookTriggersPanelProps) {
  const { mockLoreEntries, keywordLogs, handleTestKeywords } = actions;

  return (
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
  );
}
