import { ChatSession } from "../../types";
import {
  BrainCircuit,
  Pin,
  VolumeX,
  Tag
} from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { MemoryAuditSnapshot, RecalledMessage } from "../../kernel/services/memory/types";
import { MemoryFragmentsPanel } from "./MemoryFragmentsPanel";

export interface RecallTabProps {
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
  lastRecalledMemories: RecalledMessage[];
  lastMemoryAudit: MemoryAuditSnapshot | null;
}

function RecallTab({ activeSession, saveSession, lastRecalledMemories, lastMemoryAudit }: RecallTabProps) {
  const { t } = useTranslation();
  const lastRecalled = lastRecalledMemories ?? [];

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
    <div className="space-y-3">
      <div className="rounded-lg border border-border/30 bg-muted/30 px-2.5 py-2 text-[10px] font-medium leading-4 text-muted-foreground">
        {t("recall_tab.info")}
      </div>

      {lastMemoryAudit && (
        <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-foreground">{t("recall_tab.packet_title")}</h3>
              <p className="max-w-[16rem] truncate text-[9px] text-muted-foreground">{lastMemoryAudit.query || t("recall_tab.packet_empty_query")}</p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[9px] font-bold text-primary">
              ≈ {lastMemoryAudit.totalEstimatedTokens} tokens
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {lastMemoryAudit.sources.map((source) => (
              <div key={source.key} className={`rounded-lg border px-2 py-1.5 ${source.included ? "border-primary/20 bg-background/60" : "border-border/30 bg-muted/20 opacity-55"}`}>
                <p className="text-[9px] font-bold text-foreground">{t({
                  "memory.summaries": "memory_drawer.tab_timeline",
                  "memory.recalled": "memory_drawer.tab_recall",
                  "memory.tables": "memory_drawer.tab_table",
                }[source.key])}</p>
                <p className="mt-0.5 text-[8px] text-muted-foreground">
                  {source.included ? t("recall_tab.packet_included") : source.dropped ? t("recall_tab.packet_dropped") : t("recall_tab.packet_not_included")}
                  · {source.count}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {lastRecalled.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-5 py-6 text-center text-muted-foreground">
          <BrainCircuit className="size-7 animate-pulse opacity-35" />
          <span className="text-xs font-bold">{t("recall_tab.empty_title")}</span>
          <p className="text-[10px] max-w-xs text-muted-foreground mt-1">{t("recall_tab.empty_desc")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lastRecalled.map((msg) => {
            const memoryId = msg.memoryId || msg.messageId;
            const isPinned = (activeSession.pinnedMessageIds || []).includes(memoryId);
            const isMuted = (activeSession.mutedMessageIds || []).includes(memoryId);

            return (
              <div
                key={memoryId}
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
                      {t("recall_tab.turn_label", { turn: String(msg.turnIndex + 1) })}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground border border-border'
                      }`}>
                      {msg.role === 'user' ? t("recall_tab.role_user") : t("recall_tab.role_char")}
                    </span>
                    <span className="rounded bg-primary/5 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      {msg.kind === "event" ? t("recall_tab.kind_event") : t("recall_tab.kind_message")}
                    </span>
                  </div>

                  {/* Row Actions: Pin or Mute */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleTogglePin(memoryId)}
                      className={`p-1 rounded border transition ${isPinned
                        ? "bg-primary border-primary text-primary-foreground"
                        : "hover:bg-muted border-border/60 text-muted-foreground"
                        }`}
                      title={isPinned ? t("recall_tab.unpin") : t("recall_tab.pin")}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleToggleMute(memoryId)}
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
                <div className="flex items-center justify-between px-1 text-[8px] text-muted-foreground/70">
                  <span>{t(`recall_tab.reason_${msg.reason || "tag"}`)}</span>
                  <span>{t("recall_tab.score", { score: Number(msg.score || 0).toFixed(2) })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MemoryFragmentsPanel activeSession={activeSession} saveSession={saveSession} />
    </div>
  );
}

export default RecallTab;
