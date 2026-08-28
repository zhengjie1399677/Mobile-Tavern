import React, { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { CharacterCard, ChatSession, Message } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import { getAvatarGradientClass } from "../../utils/avatarUtils";

export type SessionDirectoryView = "recent" | "character";

interface SessionDirectoryProps {
  sessions: ChatSession[];
  characters: CharacterCard[];
  activeSessionId?: string | null;
  view: SessionDirectoryView;
  onViewChange?: (view: SessionDirectoryView) => void;
  onOpen: (session: ChatSession) => void;
  onRename: (session: ChatSession) => void | Promise<void>;
  onDelete: (session: ChatSession) => void | Promise<void>;
  compact?: boolean;
}

interface SessionDirectoryItem {
  session: ChatSession;
  character?: CharacterCard;
  lastMessage: Message | null;
  lastActiveTime: number;
  turnCount: number;
  charCount: number;
}

interface CharacterSessionGroup {
  id: string;
  name: string;
  avatar?: string;
  items: SessionDirectoryItem[];
  lastActiveTime: number;
}

function resolveSessionItem(
  session: ChatSession,
  character: CharacterCard | undefined,
): SessionDirectoryItem {
  const messages = session.messages ?? [];
  const lastMessage = messages.at(-1) ?? null;
  const calculatedTurns = messages.filter((message) => message.sender === "user").length;
  const calculatedChars = messages.reduce(
    (total, message) => total + (message.content?.length ?? 0),
    0,
  );
  return {
    session,
    character,
    lastMessage,
    lastActiveTime: lastMessage?.timestamp ?? session.createdAt,
    turnCount: Math.max(session.turnCount ?? 0, calculatedTurns),
    charCount: Math.max(session.charCount ?? 0, calculatedChars),
  };
}

function formatCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function SessionAvatar({ character }: { character?: CharacterCard }) {
  const name = character?.name || "?";
  return (
    <div className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 ${
      character?.avatar ? "bg-muted" : getAvatarGradientClass(name)
    }`}>
      {character?.avatar ? (
        <img
          src={character.avatar}
          alt={name}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <span className="text-sm font-semibold">{name[0]}</span>
      )}
    </div>
  );
}

function SessionRow({
  item,
  active,
  menuOpen,
  compact,
  onOpen,
  onToggleMenu,
  onRename,
  onDelete,
}: {
  item: SessionDirectoryItem;
  active: boolean;
  menuOpen: boolean;
  compact: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { session, character, lastMessage, lastActiveTime, turnCount, charCount } = item;
  const title = session.title || t("history.main_timeline");
  const preview = lastMessage?.content?.trim();

  return (
    <article
      className={`relative rounded-2xl border transition-colors ${
        active
          ? "border-primary/55 bg-primary/[0.06]"
          : "border-border/70 bg-card hover:border-border"
      }`}
    >
      <div className="flex items-stretch gap-1 p-1.5">
        <button
          type="button"
          onClick={onOpen}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring ${
            compact ? "min-h-16 py-2" : "min-h-[76px] py-2.5"
          }`}
        >
          <SessionAvatar character={character} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {title}
              </span>
              {active && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <Check className="size-3" aria-hidden="true" />
                  {t("history.active")}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{character?.name || t("history.removed_char")}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">
                {new Date(lastActiveTime).toLocaleString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground/75">
              {preview || t("history.turns_chars", {
                turnCount,
                charCount: formatCount(charCount),
              })}
            </span>
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="my-auto size-11 shrink-0 text-muted-foreground"
          aria-label={`${t("history.more_actions")}: ${title}`}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          {menuOpen ? <X className="size-4" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </div>

      {menuOpen && (
        <div className="mx-2 flex items-center gap-1 border-t border-border/60 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10 flex-1 justify-center text-xs"
            onClick={onRename}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("history.rename")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10 flex-1 justify-center text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("history.delete")}
          </Button>
        </div>
      )}
    </article>
  );
}

export default function SessionDirectory({
  sessions,
  characters,
  activeSessionId,
  view,
  onViewChange,
  onOpen,
  onRename,
  onDelete,
  compact = false,
}: SessionDirectoryProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const items = useMemo(() => {
    const characterMap = new Map(characters.map((character) => [character.id, character]));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sessions
      .map((session) => resolveSessionItem(session, characterMap.get(session.characterId)))
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.session.title,
          item.character?.name,
          item.lastMessage?.content,
        ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => right.lastActiveTime - left.lastActiveTime);
  }, [characters, query, sessions]);

  const groups = useMemo<CharacterSessionGroup[]>(() => {
    const grouped = new Map<string, CharacterSessionGroup>();
    for (const item of items) {
      const id = item.session.characterId || "unknown";
      const current = grouped.get(id);
      if (current) {
        current.items.push(item);
        current.lastActiveTime = Math.max(current.lastActiveTime, item.lastActiveTime);
      } else {
        grouped.set(id, {
          id,
          name: item.character?.name || t("history.removed_char"),
          avatar: item.character?.avatar,
          items: [item],
          lastActiveTime: item.lastActiveTime,
        });
      }
    }
    return [...grouped.values()].sort((left, right) => right.lastActiveTime - left.lastActiveTime);
  }, [items, t]);

  const renderRow = (item: SessionDirectoryItem) => (
    <SessionRow
      key={item.session.id}
      item={item}
      active={item.session.id === activeSessionId}
      menuOpen={openMenuId === item.session.id}
      compact={compact}
      onOpen={() => onOpen(item.session)}
      onToggleMenu={() => setOpenMenuId((current) => current === item.session.id ? null : item.session.id)}
      onRename={() => {
        setOpenMenuId(null);
        void onRename(item.session);
      }}
      onDelete={() => {
        setOpenMenuId(null);
        void onDelete(item.session);
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 pb-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("history.search_placeholder")}
            aria-label={t("history.search_placeholder")}
            className="h-11 w-full rounded-xl border border-border bg-muted/35 pl-9 pr-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label={t("history.clear_search")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </label>

        {onViewChange && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/45 p-1" aria-label={t("history.view_label")}>
            <button
              type="button"
              aria-pressed={view === "recent"}
              onClick={() => onViewChange("recent")}
              className={`min-h-10 rounded-lg px-3 text-xs font-medium transition-colors ${
                view === "recent" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t("history.sort_by_time")}
            </button>
            <button
              type="button"
              aria-pressed={view === "character"}
              onClick={() => onViewChange("character")}
              className={`min-h-10 rounded-lg px-3 text-xs font-medium transition-colors ${
                view === "character" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t("history.sort_by_char")}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center text-muted-foreground">
          {query ? <Search className="mb-3 size-8 opacity-45" /> : <MessageSquare className="mb-3 size-8 opacity-45" />}
          <p className="text-sm font-medium">{query ? t("history.search_empty") : t("history.empty")}</p>
          {!query && <p className="mt-1 text-xs opacity-75">{t("history.empty_tip")}</p>}
        </div>
      ) : view === "recent" ? (
        <div className="space-y-2">{items.map(renderRow)}</div>
      ) : (
        <div className="space-y-2.5">
          {groups.map((group) => {
            const expanded = expandedGroups[group.id] ?? true;
            return (
              <section key={group.id} className="overflow-hidden rounded-2xl border border-border/70 bg-card/55">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedGroups((current) => ({ ...current, [group.id]: !expanded }))}
                  className="flex min-h-14 w-full items-center gap-3 px-3 text-left outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <SessionAvatar character={group.items[0]?.character} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{group.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t("history.sessions_count", { count: group.items.length })}
                    </span>
                  </span>
                  {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-border/60 bg-background/35 p-2">
                    {group.items.map(renderRow)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
