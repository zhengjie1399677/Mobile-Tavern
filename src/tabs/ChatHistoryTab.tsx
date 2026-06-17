import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { Trash2, History, MessageSquare } from "lucide-react";

export default function ChatHistoryTab() {
  const {
    characters,
    sessions,
    setActiveCharId,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    deleteBranch,
    triggerScroll,
  } = useContext(AppContext);
  return (
    <div className="px-4 pb-4 pt-1.5 space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5 pb-2 border-b border-border">
        历史对话 (History)
      </h1>
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
          <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
          <p className="text-sm">暂无任何对话记录</p>
          <p className="text-[11px] mt-1">去角色馆选择一个角色开始聊天吧！</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {[...sessions]
            .sort((a, b) => {
              const aLastMsg = a.messages && a.messages.length > 0 ? a.messages[a.messages.length - 1] : null;
              const aTime = aLastMsg ? (aLastMsg.timestamp || a.createdAt) : a.createdAt;
              const bLastMsg = b.messages && b.messages.length > 0 ? b.messages[b.messages.length - 1] : null;
              const bTime = bLastMsg ? (bLastMsg.timestamp || b.createdAt) : b.createdAt;
              return bTime - aTime;
            })
            .map((s) => {
              const char = characters.find((c) => c.id === s.characterId);
              const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
              const lastActiveTime = lastMsg ? (lastMsg.timestamp || s.createdAt) : s.createdAt;
              return (
                <div
                  key={s.id}
                  className="glass-panel rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition shadow-sm"
                  onClick={() => {
                    setActiveCharId(s.characterId);
                    setActiveSessionId(s.id);
                    setActiveTab("chat");
                    setChatSubTab("dialogue");
                    triggerScroll();
                  }}
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-muted border border-border/80 shrink-0">
                    {char?.avatar ? (
                      <img
                        src={char.avatar}
                        alt="avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="flex items-center justify-center h-full text-sm font-bold text-primary">
                        {char?.name?.[0] || "?"}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-sm truncate text-foreground">
                        {s.title || "主剧情线"}
                      </h4>
                      <span className="text-[9px] text-muted-foreground whitespace-nowrap pt-0.5">
                        {new Date(lastActiveTime).toLocaleString(undefined, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate opacity-70">
                      {char?.name || "未知角色"} | {s.messages.length} 回合 |{" "}
                      {s.messages.reduce(
                        (total, msg) => total + msg.content.length,
                        0,
                      ) > 1000
                        ? (
                            s.messages.reduce(
                              (total, msg) => total + msg.content.length,
                              0,
                            ) / 1000
                          ).toFixed(1) + "k"
                        : s.messages.reduce(
                            (total, msg) => total + msg.content.length,
                            0,
                          )}{" "}
                      字
                    </p>
                    {lastMsg && (
                      <p className="text-[10px] text-muted-foreground truncate mt-1.5 italic border-t border-border/20 pt-1.5 opacity-80">
                        <span className="font-semibold text-primary mr-1">
                          {lastMsg.sender === "user" ? "我" : (char?.name || "AI")}:
                        </span>
                        {lastMsg.content}
                      </p>
                    )}
                  </div>
                  <button
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive p-2 rounded shrink-0 transition"
                    title="删除对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBranch(s.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
