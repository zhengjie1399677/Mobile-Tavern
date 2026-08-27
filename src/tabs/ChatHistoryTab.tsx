import React, { useMemo, useState, useEffect } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { Trash2, MessageSquare, Clock, Users, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { getAvatarGradientClass } from "../utils/avatarUtils";

type ViewMode = "timeline" | "character";

export default function ChatHistoryTab() {
  const { t } = useTranslation();
  const {
    characters,
    sessions,
    setActiveCharId,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    deleteBranch,
    totalSessionCount,
    loadMoreSessions,
    hasMoreSessions,
    isLoadingMoreSessions,
  } = useUnifiedApp((state) => ({
    characters: state.characters,
    sessions: state.sessions,
    setActiveCharId: state.setActiveCharId,
    setActiveSessionId: state.setActiveSessionId,
    setActiveTab: state.setActiveTab,
    setChatSubTab: state.setChatSubTab,
    deleteBranch: state.deleteBranch,
    totalSessionCount: state.totalSessionCount,
    loadMoreSessions: state.loadMoreSessions,
    hasMoreSessions: state.hasMoreSessions,
    isLoadingMoreSessions: state.isLoadingMoreSessions,
  }));

  // 1. 视图模式状态（按时间平铺 / 按角色卡归纳），支持 localStorage 持久化记住用户选择
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem("mobile_tavern_history_view_mode");
      if (saved === "timeline" || saved === "character") return saved;
    } catch {
      // ignore storage error
    }
    return "timeline";
  });

  const handleModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("mobile_tavern_history_view_mode", mode);
    } catch {
      // ignore storage error
    }
  };

  // 2. 角色卡折叠展开状态 (characterId -> boolean)
  const [expandedChars, setExpandedChars] = useState<Record<string, boolean>>({});

  // 3. 预计算每个 session 的派生数据并按时间降序排列
  const enrichedSessions = useMemo(() => {
    return [...sessions]
      .map((s) => {
        const char = characters.find((c) => c.id === s.characterId);
        const messages = Array.isArray(s.messages) ? s.messages : [];
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const lastActiveTime = lastMsg ? (lastMsg.timestamp || s.createdAt) : s.createdAt;
        
        // sessions Store 冷启动投影会固定提供 messages: []，不能用 Array.isArray
        // 判断消息是否已水合。空数组时优先使用持久化统计；有消息时取缓存值与
        // 当前内存页计算值的较大者，避免长会话只加载最近一页时被低估。
        const calculatedChars = messages.reduce(
          (total, msg) => total + (msg.content?.length || 0),
          0,
        );
        const cachedChars = Number.isFinite(s.charCount) ? Math.max(0, s.charCount ?? 0) : 0;
        const totalChars = messages.length > 0
          ? Math.max(cachedChars, calculatedChars)
          : cachedChars;
          
        const totalCharsDisplay = totalChars > 1000
          ? (totalChars / 1000).toFixed(1) + "k"
          : String(totalChars);
          
        const userMsgCount = messages.filter((m) => m.sender === "user").length;
        const calculatedTurns = userMsgCount > 0
          ? userMsgCount
          : messages.length > 1
            ? Math.floor(messages.length / 2)
            : messages.length > 0
              ? 1
              : 0;
        const cachedTurns = Number.isFinite(s.turnCount) ? Math.max(0, s.turnCount ?? 0) : 0;
        const turnCount = messages.length > 0
          ? Math.max(cachedTurns, calculatedTurns)
          : cachedTurns;

        return { s, char, lastMsg, lastActiveTime, totalCharsDisplay, rawTotalChars: totalChars, turnCount };
      })
      .sort((a, b) => b.lastActiveTime - a.lastActiveTime);
  }, [sessions, characters]);

  // 4. 按角色卡归纳分组
  const groupedByCharacter = useMemo(() => {
    const map = new Map<
      string,
      {
        characterId: string;
        characterName: string;
        avatar?: string;
        sessions: typeof enrichedSessions;
        latestActiveTime: number;
        totalChars: number;
      }
    >();

    for (const item of enrichedSessions) {
      const charId = item.s.characterId || "unknown";
      const existing = map.get(charId);

      if (!existing) {
        map.set(charId, {
          characterId: charId,
          characterName: item.char?.name || (charId === "unknown" ? t("history.unassigned_char") : t("history.removed_char")),
          avatar: item.char?.avatar,
          sessions: [item],
          latestActiveTime: item.lastActiveTime,
          totalChars: item.rawTotalChars,
        });
      } else {
        existing.sessions.push(item);
        if (item.lastActiveTime > existing.latestActiveTime) {
          existing.latestActiveTime = item.lastActiveTime;
        }
        existing.totalChars += item.rawTotalChars;
      }
    }

    // 将分组列表按最新活动时间倒序
    return Array.from(map.values()).sort((a, b) => b.latestActiveTime - a.latestActiveTime);
  }, [enrichedSessions]);

  // 默认首次加载时全部角色卡默认处于展开状态
  useEffect(() => {
    if (groupedByCharacter.length > 0) {
      setExpandedChars((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const group of groupedByCharacter) {
          if (next[group.characterId] === undefined) {
            next[group.characterId] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [groupedByCharacter]);

  const toggleExpand = (charId: string) => {
    setExpandedChars((prev) => ({
      ...prev,
      [charId]: !prev[charId],
    }));
  };

  const openSession = (characterId: string, sessionId: string) => {
    if (characterId && characterId !== "unknown") {
      setActiveCharId(characterId);
    }
    setActiveSessionId(sessionId);
    setActiveTab("chat");
    setChatSubTab("dialogue");
  };

  return (
    <div className="px-4 pb-4 pt-1.5 space-y-4">
      {/* 头部标题与模式切换器 */}
      <div className="flex min-h-12 items-center justify-between gap-2 pb-2 border-b border-border">
        <h1 className="shrink-0 text-base font-bold tracking-tight text-foreground flex items-center gap-1.5">
          {t("history.title")}
        </h1>

        {/* 顶部 segmented 控制组 */}
        <div className="flex min-w-0 bg-muted/60 p-0.5 rounded-lg border border-border/60 shadow-inner">
          <button
            type="button"
            aria-pressed={viewMode === "timeline"}
            onClick={() => handleModeChange("timeline")}
            className={`flex min-h-11 max-w-[112px] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              viewMode === "timeline"
                ? "bg-card text-primary shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            {t("history.sort_by_time")}
          </button>

          <button
            type="button"
            aria-pressed={viewMode === "character"}
            onClick={() => handleModeChange("character")}
            className={`flex min-h-11 max-w-[112px] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              viewMode === "character"
                ? "bg-card text-primary shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {t("history.sort_by_char")}
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
          <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
          <p className="text-sm">{t("history.empty")}</p>
          <p className="text-[11px] mt-1">{t("history.empty_tip")}</p>
        </div>
      ) : viewMode === "timeline" ? (
        /* 模式一：原按时间线倒序平铺 */
        <div className="space-y-2.5">
          {enrichedSessions.map(({ s, char, lastMsg, lastActiveTime, totalCharsDisplay, turnCount }) => {
            return (
              <article
                key={s.id}
                className="mobile-list-item flex items-center gap-1 rounded-xl border border-border/80 bg-card/85 p-1 shadow-sm transition-colors hover:border-primary/50"
              >
                <button
                  type="button"
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openSession(s.characterId, s.id)}
                >
                  <div className={`w-10 h-10 rounded-full overflow-hidden border border-border/80 shrink-0 flex items-center justify-center ${
                    char?.avatar ? "bg-muted" : getAvatarGradientClass(char?.name || "?")
                  }`}>
                    {char?.avatar ? (
                      <img
                        src={char.avatar}
                        alt={char.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-bold">
                        {char?.name?.[0] || "?"}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-bold text-sm truncate text-foreground">
                        {s.title || t("history.main_timeline")}
                      </p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">
                        {new Date(lastActiveTime).toLocaleString(undefined, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate opacity-70">
                      {char?.name || t("history.removed_char")} | {t("history.turns_chars", { turnCount, charCount: totalCharsDisplay })}
                    </p>
                    {lastMsg && (
                      <p className="text-xs text-muted-foreground truncate mt-1.5 italic border-t border-border/20 pt-1.5 opacity-80">
                        <span className="font-semibold text-primary mr-1">
                          {lastMsg.sender === "user" ? t("history.me") : (char?.name || "AI")}:
                        </span>
                        {lastMsg.content}
                      </p>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`${t("history.delete")}: ${s.title || t("history.main_timeline")}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  title={t("history.delete")}
                  onClick={() => deleteBranch(s.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        /* 模式二：同一个角色卡归纳在一起 */
        <div className="space-y-3">
          {groupedByCharacter.map((group) => {
            const isExpanded = expandedChars[group.characterId] ?? true;
            const totalCharsDisplay = group.totalChars > 1000
              ? (group.totalChars / 1000).toFixed(1) + "k"
              : String(group.totalChars);

            return (
              <div
                key={group.characterId}
                className="mobile-list-item bg-card/70 border border-border/80 rounded-xl overflow-hidden shadow-sm transition-colors"
              >
                {/* 归纳头部：角色卡信息与收起/展开控制 */}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  className="flex min-h-16 w-full items-center justify-between bg-muted/40 p-3 text-left transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => toggleExpand(group.characterId)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-9 h-9 rounded-full overflow-hidden border border-border/80 shrink-0 flex items-center justify-center ${
                      group.avatar ? "bg-muted" : getAvatarGradientClass(group.characterName)
                    }`}>
                      {group.avatar ? (
                        <img
                          src={group.avatar}
                          alt={group.characterName}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-bold">
                          {group.characterName?.[0] || "?"}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-foreground truncate">
                          {group.characterName}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                          {t("history.sessions_count", { count: group.sessions.length })}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-muted-foreground truncate opacity-75 mt-0.5">
                        {t("history.recent_active", {
                          time: new Date(group.latestActiveTime).toLocaleString(undefined, {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        })} · {t("history.total_chars", { count: totalCharsDisplay })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 pl-2 text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 transition-transform duration-200" />
                    ) : (
                      <ChevronRight className="w-5 h-5 transition-transform duration-200" />
                    )}
                  </div>
                </button>

                {/* 归纳展开后的分支子列表 */}
                {isExpanded && (
                  <div className="p-2 pt-1 space-y-2 border-t border-border/40 bg-card/30">
                    {group.sessions.map(({ s, char, lastMsg, lastActiveTime, totalCharsDisplay, turnCount }) => (
                      <article
                        key={s.id}
                        className="flex items-center justify-between gap-1 rounded-lg border border-border/50 bg-background/50 p-1 transition-colors hover:border-primary/40"
                      >
                        <button
                          type="button"
                          className="min-h-14 min-w-0 flex-1 rounded-md p-2 text-left outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openSession(s.characterId, s.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-xs text-foreground truncate">
                              {s.title || t("history.main_timeline")}
                            </p>
                            <span className="text-xs text-muted-foreground shrink-0 font-mono">
                              {new Date(lastActiveTime).toLocaleString(undefined, {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground opacity-80">
                            <span>{t("history.turns", { count: turnCount })}</span>
                            <span>·</span>
                            <span>{t("history.chars", { count: totalCharsDisplay })}</span>
                          </div>
                          {lastMsg && (
                            <p className="text-xs text-muted-foreground truncate mt-1 italic border-t border-border/10 pt-1 opacity-75">
                              <span className="font-medium text-primary">
                                {lastMsg.sender === "user" ? t("history.me") : (char?.name || "AI")}:
                              </span>{" "}
                              {lastMsg.content}
                            </p>
                          )}
                        </button>

                        <button
                          type="button"
                          aria-label={`${t("history.delete")}: ${s.title || t("history.main_timeline")}`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                          title={t("history.delete")}
                          onClick={() => deleteBranch(s.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="flex flex-col items-center gap-2 py-2" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            {t("history.loaded_sessions", { loaded: sessions.length, total: totalSessionCount })}
          </p>
          {hasMoreSessions && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11 min-w-36"
              disabled={isLoadingMoreSessions}
              onClick={() => void loadMoreSessions()}
            >
              {isLoadingMoreSessions && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {isLoadingMoreSessions ? t("history.loading_more") : t("history.load_more")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
