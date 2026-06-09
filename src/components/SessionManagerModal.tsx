import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { GitFork, X, Trash2, Plus } from "lucide-react";

export default function SessionManagerModal() {
  const {
    showSessionManager,
    setShowSessionManager,
    activeCharacter,
    sessions,
    activeSession,
    setActiveSessionId,
    deleteBranch,
    createNewBranch,
    isSending,
    showCustomAlert,
  } = useContext(AppContext);

  if (!showSessionManager || !activeCharacter) return null;

  return (
    <div
      className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 transition-all duration-200"
      style={{ zIndex: 100 }}
    >
      <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 shadow-2xl text-foreground flex flex-col h-[60vh] max-h-[500px]">
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <GitFork className="w-5 h-5 text-primary" /> 对话分支管理
          </h3>
          <button
            onClick={() => setShowSessionManager(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pb-4 pr-1 custom-scrollbar">
          {sessions
            .filter((s) => s.characterId === activeCharacter.id)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((s) => (
              <div
                key={s.id}
                className={`p-3 border rounded-lg flex flex-col gap-2 transition-colors cursor-pointer ${
                  s.id === activeSession?.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/50"
                }`}
                onClick={() => {
                  if (isSending) {
                    showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再切换分支。");
                    return;
                  }
                  setActiveSessionId(s.id);
                  setShowSessionManager(false);
                }}
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0 pr-2 pb-1">
                    <h4 className="font-bold text-sm truncate">
                      {s.title || "主剧情线"}
                    </h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      {new Date(s.createdAt).toLocaleString()} |{" "}
                      {s.messages.length} 回合 | {(s.summaries || []).length} 片段
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSending) {
                        showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再删除分支。");
                        return;
                      }
                      deleteBranch(s.id);
                    }}
                    className="text-destructive p-1.5 rounded hover:bg-destructive/10 shrink-0 transition"
                    title="删除该分支"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
        </div>
        <button
          onClick={() => {
            if (isSending) {
              showCustomAlert("当前有正在生成的对话，请等待生成完毕或手动停止生成后再新建分支。");
              return;
            }
            createNewBranch();
          }}
          className="shrink-0 w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 flex justify-center items-center gap-2 mt-2"
        >
          <Plus className="w-4 h-4" /> 新建空白分支
        </button>
      </div>
    </div>
  );
}
