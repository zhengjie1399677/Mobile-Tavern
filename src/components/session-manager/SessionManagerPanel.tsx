import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopyCheck,
  Heart,
  History,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import type {
  ISessionManagementService,
} from "../../application/serviceContracts";
import { KernelServices } from "../../application/serviceContracts";
import type {
  FavoriteSessionBackupEntry,
  SessionDirectoryCategory,
  SessionDirectoryEntry,
  SessionDirectoryQuery,
  SessionDirectorySnapshot,
} from "../../domain/session-management";
import { useTranslation } from "../../contexts/LanguageContext";
import { useKernel } from "../../contexts/KernelContext";
import type { ChatSession } from "../../types";
import {
  BatchBar,
  FavoriteRow,
  FilterSelect,
  SessionDetail,
  SessionSections,
  rangeOptions,
  type DetailTarget,
} from "./SessionDirectoryViews";

const EMPTY_SNAPSHOT: SessionDirectorySnapshot = {
  active: [],
  favorites: [],
  archived: [],
  pageInfo: {
    active: { hasMore: false },
    favorite: { hasMore: false },
    archived: { hasMore: false },
  },
  characters: [],
};

interface SessionManagerPanelProps {
  activeSessionId?: string | null;
  fixedCharacterId?: string;
  isSending: boolean;
  onOpenSession: (session: ChatSession) => void;
  onRenameSession: (session: ChatSession) => Promise<void>;
  onOpenUniverse: (session: ChatSession) => void;
  onDataChanged: () => Promise<void> | void;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showAlert: (message: string, title?: string) => Promise<void>;
}

export default function SessionManagerPanel({
  activeSessionId,
  fixedCharacterId,
  isSending,
  onOpenSession,
  onRenameSession,
  onOpenUniverse,
  onDataChanged,
  showConfirm,
  showAlert,
}: SessionManagerPanelProps) {
  const { t } = useTranslation();
  const kernel = useKernel();
  const service = useMemo(
    () => kernel.getService<ISessionManagementService<ChatSession>>(KernelServices.SessionManagement),
    [kernel],
  );
  const [category, setCategory] = useState<SessionDirectoryCategory>("active");
  const [snapshot, setSnapshot] = useState<SessionDirectorySnapshot>(EMPTY_SNAPSHOT);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [characterId, setCharacterId] = useState(fixedCharacterId || "");
  const [sort, setSort] = useState<NonNullable<SessionDirectoryQuery["sort"]>>("updated_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createdRange, setCreatedRange] = useState("");
  const [updatedRange, setUpdatedRange] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async (
    cursor?: SessionDirectorySnapshot["pageInfo"][SessionDirectoryCategory]["cursor"],
    append = false,
  ) => {
    const generation = ++loadGenerationRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const next = await service.queryDirectory({
        category,
        pageSize: 24,
        cursor,
        search,
        characterId: characterId || undefined,
        createdAfter: getRangeStart(createdRange),
        updatedAfter: getRangeStart(updatedRange),
        hasBranch: branchFilter === "" ? undefined : branchFilter === "yes",
        backupStatus: backupStatus === "" ? undefined : backupStatus as "current" | "outdated",
        sort,
      });
      if (generation !== loadGenerationRef.current) return;
      setSnapshot((current) => append ? mergeDirectoryPage(current, next, category) : next);
    } catch (error: unknown) {
      if (generation !== loadGenerationRef.current) return;
      await showAlert(t("session_manager.load_failed", { error: getErrorMessage(error) }));
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [backupStatus, branchFilter, category, characterId, createdRange, search, service, showAlert, sort, t, updatedRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeEntries = category === "active"
    ? snapshot.active
    : category === "archived"
      ? snapshot.archived
      : snapshot.favorites;
  const currentEntryIds = category === "favorite"
    ? snapshot.favorites.map((entry) => entry.metadata.id)
    : (category === "active" ? snapshot.active : snapshot.archived).map((entry) => entry.session.id);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const allSelected = currentEntryIds.length > 0 && currentEntryIds.every((id) => selectedIds.has(id));
  const characterOptions = useMemo(
    () => snapshot.characters.map(({ id, name }) => [id, name] as const)
      .sort((left, right) => left[1].localeCompare(right[1])),
    [snapshot.characters],
  );

  const mutate = async (operation: () => Promise<void>) => {
    if (mutating) return;
    setMutating(true);
    try {
      await operation();
      await Promise.all([load(), Promise.resolve(onDataChanged())]);
      setSelected(new Set());
      setOpenMenuId(null);
    } catch (error: unknown) {
      await showAlert(t("session_manager.operation_failed", { error: getErrorMessage(error) }));
    } finally {
      setMutating(false);
    }
  };

  const ensureIdle = async (): Promise<boolean> => {
    if (!isSending) return true;
    await showAlert(t("session_manager.busy_switch_warning"));
    return false;
  };

  const openSessionSafely = async (session: ChatSession): Promise<void> => {
    if (!await ensureIdle()) return;
    onOpenSession(session);
  };

  const openUniverseSafely = async (session: ChatSession): Promise<void> => {
    if (!await ensureIdle()) return;
    onOpenUniverse(session);
  };

  const handleFavoriteRestore = async (entry: FavoriteSessionBackupEntry): Promise<void> => {
    if (!await ensureIdle()) return;
    await mutate(async () => {
      const session = await service.restoreFavoriteBackup(entry.metadata.id);
      onOpenSession(session);
    });
  };

  const selectCategory = (next: SessionDirectoryCategory) => {
    setCategory(next);
    setManage(false);
    setSelected(new Set());
    setOpenMenuId(null);
    setDetail(null);
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleArchive = async (entry: SessionDirectoryEntry) => {
    if (!await ensureIdle()) return;
    if (!await showConfirm(t("session_manager.archive_confirm"), t("session_manager.archive"))) return;
    await mutate(() => service.archiveSession(entry.session.id));
  };

  const handleDelete = async (entry: SessionDirectoryEntry) => {
    if (!await ensureIdle()) return;
    if (!await showConfirm(
      t("session_manager.delete_permanent_confirm"),
      t("session_manager.delete_permanent"),
    )) return;
    await mutate(async () => {
      if (entry.session.lifecycle !== "archived") {
        await service.archiveSession(entry.session.id);
      }
      await service.permanentlyDeleteArchivedSession(entry.session.id);
    });
  };

  const handleRemoveFavorite = async (entry: FavoriteSessionBackupEntry) => {
    if (!await showConfirm(
      t("session_manager.remove_favorite_confirm"),
      t("session_manager.remove_favorite"),
    )) return;
    await mutate(() => service.removeFavoriteBackup(entry.metadata.id));
  };

  if (detail) {
    return (
      <SessionDetail
        target={detail}
        mutating={mutating}
        onBack={() => setDetail(null)}
        onContinue={() => {
          const session = detail.kind === "session" ? detail.entry.session : detail.entry.sourceSession;
          if (session) void openSessionSafely(session);
        }}
        onUniverse={() => {
          const session = detail.kind === "session" ? detail.entry.session : detail.entry.sourceSession;
          if (session) void openUniverseSafely(session);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/70 px-3 pb-2.5 pt-1 space-y-2">
        {fixedCharacterId ? (
          /* 聊天内分支管理模式：精简单行工具栏 */
          searchOpen ? (
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("session_manager.search_placeholder")}
                aria-label={t("session_manager.search_placeholder")}
                className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-8 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
              />
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => { setSearch(""); setSearchOpen(false); }}
                className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </label>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-medium truncate">
                {t("session_manager.result_count", { count: activeEntries.length })}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-28 sm:w-32">
                  <Select
                    value={sort}
                    onValueChange={(val) => setSort((val ?? "updated_desc") as NonNullable<SessionDirectoryQuery["sort"]>)}
                  >
                    <SelectTrigger
                      aria-label={t("session_manager.sort")}
                      className="h-7.5 w-full rounded-lg border-border/80 bg-background/90 px-2 text-xs text-foreground"
                    >
                      <SelectValue>
                        {sort === "created_asc" ? t("session_manager.sort_created") : sort === "title_asc" ? t("session_manager.sort_title") : sort === "turns_desc" ? t("session_manager.sort_turns") : t("session_manager.sort_updated")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end" className="border border-border bg-popover p-1 shadow-2xl">
                      <SelectItem value="updated_desc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_updated")}</SelectItem>
                      <SelectItem value="created_asc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_created")}</SelectItem>
                      <SelectItem value="title_asc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_title")}</SelectItem>
                      <SelectItem value="turns_desc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_turns")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7.5"
                  aria-label={t("session_manager.search")}
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="size-3.5" />
                </Button>
                <Button
                  variant={manage ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7.5 px-2 text-xs"
                  onClick={() => { setManage((value) => !value); setSelected(new Set()); }}
                >
                  <CopyCheck className="size-3.5" />
                  <span className="hidden sm:inline">{manage ? t("common.cancel") : t("session_manager.manage")}</span>
                </Button>
                <Button
                  type="button"
                  variant={filtersOpen ? "secondary" : "outline"}
                  size="icon"
                  className="size-7.5"
                  aria-label={t("session_manager.filters")}
                  onClick={() => setFiltersOpen((value) => !value)}
                >
                  <SlidersHorizontal className="size-3.5" />
                </Button>
              </div>
            </div>
          )
        ) : (
          /* 全局主会话管理器模式 */
          <>
            <div className="flex items-center justify-between gap-2">
              {searchOpen ? (
                <label className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("session_manager.search_placeholder")}
                    aria-label={t("session_manager.search_placeholder")}
                    className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-8 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    onClick={() => { setSearch(""); setSearchOpen(false); }}
                    className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-3.5" />
                  </button>
                </label>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground font-medium">
                    {t("session_manager.result_count", { count: activeEntries.length })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7.5 px-2 text-xs" onClick={() => setSearchOpen(true)}>
                      <Search className="size-3.5" />
                      <span>{t("session_manager.search")}</span>
                    </Button>
                    <Button
                      variant={manage ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7.5 px-2 text-xs"
                      onClick={() => { setManage((value) => !value); setSelected(new Set()); }}
                    >
                      <CopyCheck className="size-3.5" />
                      <span>{manage ? t("common.cancel") : t("session_manager.manage")}</span>
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/30 p-0.5" role="tablist" aria-label={t("session_manager.categories")}>
              {(["active", "favorite", "archived"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={category === item}
                  onClick={() => selectCategory(item)}
                  className={`h-7.5 rounded-md px-2 text-xs font-medium transition-all ${
                    category === item ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`session_manager.category_${item}`)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <Select
                  value={characterId || "__all__"}
                  onValueChange={(val) => setCharacterId(val === "__all__" ? "" : String(val ?? ""))}
                >
                  <SelectTrigger
                    aria-label={t("session_manager.filter_character")}
                    className="h-7.5 w-full rounded-lg border-border/80 bg-background/90 px-2 text-xs text-foreground"
                  >
                    <SelectValue>
                      {characterId ? (characterOptions.find(([id]) => id === characterId)?.[1] || t("session_manager.all_characters")) : t("session_manager.all_characters")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" className="max-h-56 overflow-y-auto border border-border bg-popover p-1 shadow-2xl">
                    <SelectItem value="__all__" className="min-h-7.5 px-2 text-xs font-medium">
                      {t("session_manager.all_characters")}
                    </SelectItem>
                    {characterOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id} className="min-h-7.5 px-2 text-xs font-medium">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Select
                  value={sort}
                  onValueChange={(val) => setSort((val ?? "updated_desc") as NonNullable<SessionDirectoryQuery["sort"]>)}
                >
                  <SelectTrigger
                    aria-label={t("session_manager.sort")}
                    className="h-7.5 w-full rounded-lg border-border/80 bg-background/90 px-2 text-xs text-foreground"
                  >
                    <SelectValue>
                      {sort === "created_asc" ? t("session_manager.sort_created") : sort === "title_asc" ? t("session_manager.sort_title") : sort === "turns_desc" ? t("session_manager.sort_turns") : t("session_manager.sort_updated")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" className="border border-border bg-popover p-1 shadow-2xl">
                    <SelectItem value="updated_desc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_updated")}</SelectItem>
                    <SelectItem value="created_asc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_created")}</SelectItem>
                    <SelectItem value="title_asc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_title")}</SelectItem>
                    <SelectItem value="turns_desc" className="min-h-7.5 px-2 text-xs font-medium">{t("session_manager.sort_turns")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={filtersOpen ? "secondary" : "outline"}
                size="icon"
                className="size-7.5 shrink-0"
                aria-label={t("session_manager.filters")}
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            </div>
          </>
        )}

        {filtersOpen && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-muted/20 p-2">
            <FilterSelect
              label={t("session_manager.filter_created")}
              value={createdRange}
              onChange={setCreatedRange}
              options={rangeOptions(t)}
            />
            <FilterSelect
              label={t("session_manager.filter_updated")}
              value={updatedRange}
              onChange={setUpdatedRange}
              options={rangeOptions(t)}
            />
            <FilterSelect
              label={t("session_manager.filter_branch")}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[
                ["", t("session_manager.filter_any")],
                ["yes", t("session_manager.filter_has_branch")],
                ["no", t("session_manager.filter_no_branch")],
              ]}
            />
            <FilterSelect
              label={t("session_manager.filter_backup")}
              value={backupStatus}
              onChange={setBackupStatus}
              options={[
                ["", t("session_manager.filter_any")],
                ["current", t("session_manager.status_current")],
                ["outdated", t("session_manager.status_outdated")],
              ]}
            />
          </div>
        )}

        {manage && activeEntries.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(allSelected
              ? new Set()
              : new Set(currentEntryIds))}
            className="mt-2 flex min-h-10 items-center gap-2 text-sm text-muted-foreground"
          >
            <Checkbox checked={allSelected} />
            {allSelected ? t("session_manager.clear_selection") : t("session_manager.select_all_results")}
          </button>
        )}
      </div>

      <div className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <LoaderCircle className="mr-2 size-5 animate-spin" />
            {t("common.loading")}
          </div>
        ) : activeEntries.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center text-muted-foreground">
            {category === "favorite" ? <Heart className="mb-3 size-8 opacity-45" /> : <History className="mb-3 size-8 opacity-45" />}
            <p className="text-sm font-medium">{t(`session_manager.empty_${category}`)}</p>
          </div>
        ) : category === "favorite" ? (
          <div className="space-y-2">
            {snapshot.favorites.map((entry) => (
              <FavoriteRow
                key={entry.metadata.id}
                entry={entry}
                manage={manage}
                selected={selected.has(entry.metadata.id)}
                menuOpen={openMenuId === entry.metadata.id}
                disabled={mutating}
                onSelect={() => toggleSelected(entry.metadata.id)}
                onToggleMenu={() => setOpenMenuId((id) => id === entry.metadata.id ? null : entry.metadata.id)}
                onOpen={() => { if (entry.sourceSession) void openSessionSafely(entry.sourceSession); }}
                onUpdate={() => void ensureIdle().then((idle) => {
                  if (idle) void mutate(() => service.updateFavoriteBackup(entry.metadata.id).then(() => undefined));
                })}
                onRestore={() => void handleFavoriteRestore(entry)}
                onDetails={() => setDetail({ kind: "favorite", entry })}
                onRemove={() => void handleRemoveFavorite(entry)}
              />
            ))}
          </div>
        ) : (
          <SessionSections
            entries={category === "active" ? snapshot.active : snapshot.archived}
            activeSessionId={activeSessionId}
            category={category}
            manage={manage}
            selected={selected}
            openMenuId={openMenuId}
            disabled={mutating}
            onSelect={toggleSelected}
            onToggleMenu={(id) => setOpenMenuId((current) => current === id ? null : id)}
            onOpen={(session) => void openSessionSafely(session)}
            onRename={(entry) => void mutate(() => onRenameSession(entry.session))}
            onFavorite={(entry) => void ensureIdle().then((idle) => {
              if (idle) void mutate(() => service.favoriteSession(entry.session.id).then(() => undefined));
            })}
            onUpdateFavorite={(entry) => {
              const favorite = entry.favorite;
              if (favorite) void ensureIdle().then((idle) => {
                if (idle) void mutate(() => service.updateFavoriteBackup(favorite.metadata.id).then(() => undefined));
              });
            }}
            onDetails={(entry) => setDetail({ kind: "session", entry })}
            onUniverse={(entry) => void openUniverseSafely(entry.session)}
            onArchive={(entry) => void handleArchive(entry)}
            onRestore={(entry) => void mutate(() => service.restoreSession(entry.session.id))}
            onDelete={(entry) => void handleDelete(entry)}
          />
        )}
        {!loading && snapshot.pageInfo[category].hasMore && (
          <div className="flex justify-center py-3">
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore || mutating}
              onClick={() => void load(snapshot.pageInfo[category].cursor, true)}
            >
              {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
              {t("history.load_more")}
            </Button>
          </div>
        )}
      </div>

      {manage && selected.size > 0 && (
        <BatchBar
          category={category}
          count={selected.size}
          disabled={mutating}
          onPrimary={() => void (async () => {
            if (!await ensureIdle()) return;
            await mutate(async () => {
            if (category === "active") {
              for (const id of selected) await service.favoriteSession(id);
            } else if (category === "favorite") {
              for (const id of selected) {
                const entry = snapshot.favorites.find((item) => item.metadata.id === id);
                if (entry?.sourceSession) await service.updateFavoriteBackup(id);
              }
            } else {
              for (const id of selected) await service.restoreSession(id);
            }
            });
          })()}
          onSecondary={() => void (async () => {
            if (category !== "favorite" && !await ensureIdle()) return;
            const confirmationKey = category === "active"
              ? "session_manager.batch_archive_confirm"
              : category === "favorite"
                ? "session_manager.batch_remove_favorite_confirm"
                : "session_manager.batch_delete_confirm";
            if (!await showConfirm(t(confirmationKey))) return;
            await mutate(async () => {
              if (category === "active") {
                for (const id of selected) await service.archiveSession(id);
              } else if (category === "favorite") {
                for (const id of selected) await service.removeFavoriteBackup(id);
              } else {
                for (const id of selected) await service.permanentlyDeleteArchivedSession(id);
              }
            });
          })()}
        />
      )}
    </div>
  );
}

function mergeDirectoryPage(
  current: SessionDirectorySnapshot,
  next: SessionDirectorySnapshot,
  category: SessionDirectoryCategory,
): SessionDirectorySnapshot {
  if (category === "favorite") {
    const byId = new Map(current.favorites.map((entry) => [entry.metadata.id, entry]));
    for (const entry of next.favorites) byId.set(entry.metadata.id, entry);
    return {
      ...current,
      favorites: [...byId.values()],
      pageInfo: { ...current.pageInfo, favorite: next.pageInfo.favorite },
      characters: next.characters,
    };
  }
  const byId = new Map(current[category].map((entry) => [entry.session.id, entry]));
  for (const entry of next[category]) byId.set(entry.session.id, entry);
  return {
    ...current,
    [category]: [...byId.values()],
    pageInfo: { ...current.pageInfo, [category]: next.pageInfo[category] },
    characters: next.characters,
  };
}

function getRangeStart(value: string): number | undefined {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
