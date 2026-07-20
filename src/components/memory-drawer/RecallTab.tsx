import { ChatSession } from "../../types";
import {
  BrainCircuit,
  Pin,
  VolumeX,
  Tag
} from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { RecalledMessage } from "../../kernel/services/memory/types";

export interface RecallTabProps {
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
  lastRecalledMemories: RecalledMessage[];
}

function RecallTab({ activeSession, saveSession, lastRecalledMemories }: RecallTabProps) {
  const { t } = useTranslation();
  const lastRecalled = lastRecalledMemories;

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
        {t("recall_tab.info")}
      </div>

      {lastRecalled.length === 0 ? (
        <div className="border border-dashed border-border/80 rounded-xl p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
          <BrainCircuit className="w-8 h-8 opacity-30 animate-pulse" />
          <span className="text-xs font-bold">{t("recall_tab.empty_title")}</span>
          <p className="text-[10px] max-w-xs text-muted-foreground mt-1">{t("recall_tab.empty_desc")}</p>
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
                      {t("recall_tab.turn_label", { turn: msg.turnIndex + 1 })}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground border border-border'
                      }`}>
                      {msg.role === 'user' ? t("recall_tab.role_user") : t("recall_tab.role_char")}
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
                      title={isPinned ? t("recall_tab.unpin") : t("recall_tab.pin")}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleToggleMute(msg.messageId)}
                      className={`p-1 rounded border transition ${isMuted
                        ? "bg-destructive border-destructive text-destructive-foreground"
                        : "hover:bg-muted border-border/60 text-muted-foreground"
                        }`}
                      title={isMuted ? t("recall_tab.unmute") : t("recall_tab.mute")}
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
                    <span className="text-[9px] text-muted-foreground shrink-0">{t("recall_tab.hit_tags")}</span>
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
