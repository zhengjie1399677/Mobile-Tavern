import { ChatSession } from "../../types";
import {
  BrainCircuit,
  Pin,
  VolumeX,
  Tag
} from "lucide-react";

export interface RecallTabProps {
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
}

/** 扩展 ChatSession 以包含记忆系统运行时写入的回调记忆字段。 */
type ChatSessionWithRecall = ChatSession & { lastRecalledMemories?: unknown[] };

function RecallTab({ activeSession, saveSession }: RecallTabProps) {
  const lastRecalled = (activeSession as ChatSessionWithRecall).lastRecalledMemories || [];

  // Pin (钉子) 逻辑交互
  const handleTogglePin = async (messageId: string) => {
    const pinned = activeSession.pinnedMessageIds || [];
    const muted = activeSession.mutedMessageIds || [];
    let nextPinned = [...pinned];
    let nextMuted = [...muted];

    if (pinned.includes(messageId)) {
      nextPinned = nextPinned.filter(id => id !== messageId);
    } else {
      nextPinned.push(messageId);
      nextMuted = nextMuted.filter(id => id !== messageId);
    }

    const nextSession = {
      ...activeSession,
      pinnedMessageIds: nextPinned,
      mutedMessageIds: nextMuted
    };
    await saveSession(nextSession);
  };

  // Mute (小黑屋) 逻辑交互
  const handleToggleMute = async (messageId: string) => {
    const pinned = activeSession.pinnedMessageIds || [];
    const muted = activeSession.mutedMessageIds || [];
    let nextPinned = [...pinned];
    let nextMuted = [...muted];

    if (muted.includes(messageId)) {
      nextMuted = nextMuted.filter(id => id !== messageId);
    } else {
      nextMuted.push(messageId);
      nextPinned = nextPinned.filter(id => id !== messageId);
    }

    const nextSession = {
      ...activeSession,
      pinnedMessageIds: nextPinned,
      mutedMessageIds: nextMuted
    };
    await saveSession(nextSession);
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 rounded-lg p-2.5 leading-relaxed">
        💡 这里展示的是**最近一次发送消息时被 AI 成功唤醒的关联历史记忆**。你可以在此对其进行置顶（使其成为永久记忆）或屏蔽（使其被 AI 忽略），以此来微调 AI 掌握的背景细节。
      </div>

      {lastRecalled.length === 0 ? (
        <div className="border border-dashed border-border/80 rounded-xl p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
          <BrainCircuit className="w-8 h-8 opacity-30 animate-pulse" />
          <span className="text-xs font-bold">本轮未唤醒相关记忆</span>
          <p className="text-[10px] max-w-xs text-muted-foreground mt-1">这意味着当前的话题没有匹配上词典实体，或者数据库中尚无足够关联的历史细节。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lastRecalled.map((msg: any) => {
            const isPinned = (activeSession.pinnedMessageIds || []).includes(msg.messageId);
            const isMuted = (activeSession.mutedMessageIds || []).includes(msg.messageId);

            return (
              <div
                key={msg.messageId}
                className={`border rounded-xl p-3 flex flex-col gap-2 transition ${isPinned
                  ? "bg-primary/5 border-primary/45 shadow-sm"
                  : isMuted
                    ? "bg-muted/30 border-border/40 opacity-40"
                    : "bg-card/40 border-border/50"
                  }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 border border-border/50 bg-muted rounded text-muted-foreground">
                      轮次 {msg.turnIndex + 1}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground border border-border'
                      }`}>
                      {msg.role === 'user' ? '用户' : '角色'}
                    </span>
                  </div>

                  {/* Row Actions: Pin or Mute */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleTogglePin(msg.messageId)}
                      className={`p-1 rounded border transition ${isPinned
                        ? "bg-primary border-primary text-primary-foreground"
                        : "hover:bg-muted border-border/60 text-muted-foreground"
                        }`}
                      title={isPinned ? "取消 Pin 固定" : "强行 Pin 固定"}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleToggleMute(msg.messageId)}
                      className={`p-1 rounded border transition ${isMuted
                        ? "bg-destructive border-destructive text-destructive-foreground"
                        : "hover:bg-muted border-border/60 text-muted-foreground"
                        }`}
                      title={isMuted ? "取消 Mute 屏蔽" : "强行 Mute 屏蔽"}
                    >
                      <VolumeX className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Content Preview */}
                <p className="text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all pl-1 italic">
                  "{msg.content}"
                </p>

                {/* Hit Tags */}
                {Array.isArray(msg.hitTags) && msg.hitTags.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 pl-1 flex-wrap">
                    <Tag className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
                    <span className="text-[9px] text-muted-foreground shrink-0">命中标签:</span>
                    {msg.hitTags.map((tag: string, idx: number) => (
                      <span key={idx} className="text-[8px] font-bold bg-primary/5 border border-primary/10 text-primary px-1 py-0.2 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RecallTab;
