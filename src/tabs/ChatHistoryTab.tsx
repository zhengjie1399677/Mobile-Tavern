import React, { useMemo, useState, useEffect } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { Trash2, MessageSquare, Clock, Users, ChevronDown, ChevronRight } from "lucide-react";

type ViewMode = "timeline" | "character";

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
  } = useUnifiedApp();

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
        
        // 优先使用实际 messages 的长度计算，否则回退到 session 上持久化的缓存数据，解决懒加载状态下显示为 0 回合 0 字的 Bug
        const isLoaded = Array.isArray(s.messages);
        
        const totalChars = isLoaded
          ? messages.reduce((total, msg) => total + (msg.content?.length || 0), 0)
          : (s.charCount ?? 0);
          
        const totalCharsDisplay = totalChars > 1000
          ? (totalChars / 1000).toFixed(1) + "k"
          : String(totalChars);
          
        // 回合数计算：优先实际计算，兜底为缓存数
        let turnCount = 0;
        if (isLoaded) {
          const userMsgCount = messages.filter((m) => m.sender === "user").length;
          turnCount = userMsgCount > 0 ? userMsgCount : (messages.length > 1 ? Math.floor(messages.length / 2) : (messages.length > 0 ? 1 : 0));
        } else {
          turnCount = s.turnCount ?? 0;
        }

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
          characterName: item.char?.name || (charId === "unknown" ? "未指定角色" : "已移除角色"),
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
    triggerScroll();
  };

  return (
    <div className="px-4 pb-4 pt-1.5 space-y-4">
      {/* 头部标题与模式切换器 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5">
          历史对话 (History)
        </h1>

        {/* 顶部 segmented 控制组 */}
        <div className="flex bg-muted/60 p-1 rounded-xl border border-border/60 self-start sm:self-auto shadow-inner">
          <button
            onClick={() => handleModeChange("timeline")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === "timeline"
                ? "bg-card text-primary shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            时间排序
          </button>

          <button
            onClick={() => handleModeChange("character")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === "character"
                ? "bg-card text-primary shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            角色归纳
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
          <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
          <p className="text-sm">暂无任何对话记录</p>
          <p className="text-[11px] mt-1">去角色馆选择一个角色开始聊天吧！</p>
        </div>
      ) : viewMode === "timeline" ? (
        /* 模式一：原按时间线倒序平铺 */
        <div className="space-y-2.5">
          {enrichedSessions.map(({ s, char, lastMsg, lastActiveTime, totalCharsDisplay, turnCount }) => {
            return (
              <div
                key={s.id}
                className="glass-panel rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition shadow-sm"
                onClick={() => openSession(s.characterId, s.id)}
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
                    {char?.name || "未知角色"} | {turnCount} 回合 | {totalCharsDisplay} 字
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
                className="bg-card/70 border border-border/80 rounded-xl overflow-hidden shadow-sm transition-all"
              >
                {/* 归纳头部：角色卡信息与收起/展开控制 */}
                <div
                  className="p-3 bg-muted/40 hover:bg-muted/70 flex items-center justify-between cursor-pointer transition select-none"
                  onClick={() => toggleExpand(group.characterId)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-muted border border-border/80 shrink-0">
                      {group.avatar ? (
                        <img
                          src={group.avatar}
                          alt={group.characterName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="flex items-center justify-center h-full text-sm font-bold text-primary">
                          {group.characterName?.[0] || "?"}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-foreground truncate">
                          {group.characterName}
                        </h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                          {group.sessions.length} 个对话
                        </span>
                      </div>
                      <p className="text-[10.5px] text-muted-foreground truncate opacity-75 mt-0.5">
                        最近活动: {new Date(group.latestActiveTime).toLocaleString(undefined, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} · 共计 {totalCharsDisplay} 字
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
                </div>

                {/* 归纳展开后的分支子列表 */}
                {isExpanded && (
                  <div className="p-2 pt-1 space-y-2 border-t border-border/40 bg-card/30">
                    {group.sessions.map(({ s, char, lastMsg, lastActiveTime, totalCharsDisplay, turnCount }) => (
                      <div
                        key={s.id}
                        className="p-2.5 rounded-lg border border-border/50 bg-background/50 hover:bg-primary/5 hover:border-primary/40 transition flex items-center justify-between gap-2 cursor-pointer"
                        onClick={() => openSession(s.characterId, s.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-semibold text-xs text-foreground truncate">
                              {s.title || "主剧情线"}
                            </h4>
                            <span className="text-[9px] text-muted-foreground shrink-0 font-mono">
                              {new Date(lastActiveTime).toLocaleString(undefined, {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground opacity-80">
                            <span>{turnCount} 回合</span>
                            <span>·</span>
                            <span>{totalCharsDisplay} 字</span>
                          </div>
                          {lastMsg && (
                            <p className="text-[10px] text-muted-foreground truncate mt-1 italic border-t border-border/10 pt-1 opacity-75">
                              <span className="font-medium text-primary">
                                {lastMsg.sender === "user" ? "我" : (char?.name || "AI")}:
                              </span>{" "}
                              {lastMsg.content}
                            </p>
                          )}
                        </div>

                        <button
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive p-1.5 rounded shrink-0 transition"
                          title="删除对话"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBranch(s.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
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
