import React from "react";
import { Terminal, X, Play } from "lucide-react";
import type { ExternalToolDescriptor } from "../../domain/externalSources/contracts";

export interface ToolPlaygroundModalProps {
  testingTool: {
    sourceId: string;
    sourceName: string;
    tool: ExternalToolDescriptor;
  };
  testInputText: string;
  onTestInputTextChange: (text: string) => void;
  isExecutingTest: boolean;
  onExecuteTest: () => void;
  onClose: () => void;
  testOutput: {
    result: unknown;
    durationMs: number;
    error?: string;
  } | null;
}

export const ToolPlaygroundModal: React.FC<ToolPlaygroundModalProps> = ({
  testingTool,
  testInputText,
  onTestInputTextChange,
  isExecutingTest,
  onExecuteTest,
  onClose,
  testOutput,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-card p-4 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <div>
              <h4 className="text-sm font-bold text-foreground">
                测试工具：{testingTool.tool.localName}
              </h4>
              <p className="text-[10px] text-muted-foreground font-mono">
                来源：{testingTool.sourceName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto space-y-3 py-2 text-xs">
          {/* 工具描述 */}
          <div className="rounded-lg border border-white/5 bg-white/5 p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">工具说明：</p>
            <p className="text-foreground text-[11px]">
              {testingTool.tool.description || "（未声明详细描述）"}
            </p>
          </div>

          {/* 输入参数编辑 */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground block mb-1">
              调用参数 (JSON)：
            </label>
            <textarea
              rows={4}
              value={testInputText}
              onChange={(e) => onTestInputTextChange(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 p-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          {/* 执行测试按钮 */}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={isExecutingTest}
              onClick={onExecuteTest}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/20 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/30 active:scale-95 disabled:opacity-50"
            >
              <Play className={`h-3 w-3 ${isExecutingTest ? "animate-spin" : ""}`} />
              <span>{isExecutingTest ? "调用执行中..." : "发送测试调用"}</span>
            </button>
          </div>

          {/* 运行结果面板 */}
          {testOutput && (
            <div
              className={`rounded-xl border p-2.5 space-y-1.5 ${
                testOutput.error
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-foreground"
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold font-mono">
                  {testOutput.error ? "调用异常" : "调用成功"}
                </span>
                <span className="font-mono text-muted-foreground">
                  耗时: {testOutput.durationMs}ms
                </span>
              </div>

              {testOutput.error ? (
                <p className="text-xs break-all">{testOutput.error}</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">压平返回内容：</p>
                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap break-all">
                    {String(
                      (testOutput.result as { text?: string })?.text ??
                        JSON.stringify(testOutput.result, null, 2)
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolPlaygroundModal;
