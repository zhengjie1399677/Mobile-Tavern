// 建议词弹窗 banner（消息操作菜单：复制/编辑/重发/分支/删除）
// 从原 ChatTab.tsx L1523-1615 抽离
// 内部调用 useUnifiedApp() 获取上下文

import React from "react";
import {
  Copy,
  Edit2,
  RefreshCw,
  GitFork,
  Trash2,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";

interface QuickDialogueOptionsProps {
  message: any;
  isUser: boolean;
}

const QuickDialogueOptions = ({ message, isUser }: QuickDialogueOptionsProps) => {
  const {
    isSending,
    setMsgMenuId,
    setEditingMsgId,
    setEditingMsgContent,
    handleRerollFromMessage,
    createBacktrackBranch,
    showCustomConfirm,
    setSessions,
    activeSession,
  } = useUnifiedApp();

  return (
    <div
      className={`absolute top-full mt-1.5 bg-popover text-popover-foreground border border-border rounded-lg p-1.5 flex items-center gap-1 shadow-2xl z-10 ${
        isUser ? "right-0" : "left-0"
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(
            message.content,
          );
          setMsgMenuId(null);
        }}
        className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1"
      >
        <Copy className="w-3 h-3" /> 复制
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditingMsgId(message.id);
          setEditingMsgContent(message.content);
          setMsgMenuId(null);
        }}
        disabled={isSending}
        className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Edit2 className="w-3 h-3" /> 编辑
      </button>

      {message.id !== activeSession?.messages[0]?.id && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMsgMenuId(null);
            handleRerollFromMessage(message);
          }}
          disabled={isSending}
          className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title="从该对白开始重新生成后续回答"
        >
          <RefreshCw className="w-3 h-3" /> 重发
        </button>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          setMsgMenuId(null);
          createBacktrackBranch(message);
        }}
        disabled={isSending}
        className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
        title="从此处创立平行宇宙分支记录"
      >
        <GitFork className="w-3 h-3" /> 分支
      </button>

      <button
        onClick={async (e) => {
          e.stopPropagation();
          const ok =
            await showCustomConfirm(
              "确定删除该单条对白台词吗？",
            );
          if (ok) {
            const nextMessages =
              (activeSession.messages || []).filter(
                (m: any) => m.id !== message.id,
              );
            const updated = {
              ...activeSession,
              messages: nextMessages,
            };
            setSessions((prev: any) =>
              prev.map((s: any) =>
                s.id === updated.id ? updated : s,
              ),
            );
            await saveSession(updated);
            setMsgMenuId(null);
          }
        }}
        disabled={isSending}
        className="text-[11px] text-red-500/80 hover:text-red-400 px-2 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
};

export default QuickDialogueOptions;
