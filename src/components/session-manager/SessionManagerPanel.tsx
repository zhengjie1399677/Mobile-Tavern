import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  CircleAlert,
  Clock3,
  CopyCheck,
  Ellipsis,
  Heart,
  History,
  LoaderCircle,
  Network,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
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
import { getAvatarGradientClass } from "../../utils/avatarUtils";

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

type DetailTarget = { kind: "session"; entry: SessionDirectoryEntry }
  | { kind: "favorite"; entry: FavoriteSessionBackupEntry };

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
                    <SelectContent align="end" className="z-[999] border border-border bg-popover p-1 shadow-2xl">
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
                  <SelectContent align="start" className="z-[999] max-h-56 overflow-y-auto border border-border bg-popover p-1 shadow-2xl">
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
                  <SelectContent align="start" className="z-[999] border border-border bg-popover p-1 shadow-2xl">
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

function SessionSections(props: {
  entries: SessionDirectoryEntry[];
  activeSessionId?: string | null;
  category: "active" | "archived";
  manage: boolean;
  selected: Set<string>;
  openMenuId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onOpen: (session: ChatSession) => void;
  onRename: (entry: SessionDirectoryEntry) => void;
  onFavorite: (entry: SessionDirectoryEntry) => void;
  onUpdateFavorite: (entry: SessionDirectoryEntry) => void;
  onDetails: (entry: SessionDirectoryEntry) => void;
  onUniverse: (entry: SessionDirectoryEntry) => void;
  onArchive: (entry: SessionDirectoryEntry) => void;
  onRestore: (entry: SessionDirectoryEntry) => void;
  onDelete: (entry: SessionDirectoryEntry) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupEntries(props.entries), [props.entries]);
  return (
    <div className="space-y-3.5">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{t(`session_manager.group_${group.label}`)}</h3>
          <div className="space-y-1.5">
            {group.entries.map((entry) => (
              <SessionRow
                key={entry.session.id}
                entry={entry}
                active={entry.session.id === props.activeSessionId}
                category={props.category}
                manage={props.manage}
                selected={props.selected.has(entry.session.id)}
                menuOpen={props.openMenuId === entry.session.id}
                disabled={props.disabled}
                onSelect={() => props.onSelect(entry.session.id)}
                onToggleMenu={() => props.onToggleMenu(entry.session.id)}
                onOpen={() => props.category === "active" ? props.onOpen(entry.session) : props.onDetails(entry)}
                onRename={() => props.onRename(entry)}
                onFavorite={() => props.onFavorite(entry)}
                onUpdateFavorite={() => props.onUpdateFavorite(entry)}
                onDetails={() => props.onDetails(entry)}
                onUniverse={() => props.onUniverse(entry)}
                onArchive={() => props.onArchive(entry)}
                onRestore={() => props.onRestore(entry)}
                onDelete={() => props.onDelete(entry)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SessionRow(props: {
  entry: SessionDirectoryEntry;
  active: boolean;
  category: "active" | "archived";
  manage: boolean;
  selected: boolean;
  menuOpen: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleMenu: () => void;
  onOpen: () => void;
  onRename: () => void;
  onFavorite: () => void;
  onUpdateFavorite: () => void;
  onDetails: () => void;
  onUniverse: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { entry } = props;
  const session = entry.session;
  const status = entry.favorite?.status;
  return (
    <article className={`rounded-xl border ${props.active ? "border-primary/50 bg-primary/[0.05]" : "border-border/70 bg-card"}`}>
      <div className="flex min-h-[64px] items-center gap-2.5 p-2">
        {props.manage && <Checkbox checked={props.selected} onCheckedChange={props.onSelect} aria-label={session.title} />}
        <button type="button" onClick={props.manage ? props.onSelect : props.onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <SessionAvatar name={entry.characterName} avatar={entry.characterAvatar} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <strong className="truncate text-xs font-semibold leading-tight text-foreground">{session.title || t("history.main_timeline")}</strong>
              {props.active && <span className="shrink-0 text-[9px] font-medium text-primary">{t("history.active")}</span>}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground leading-tight">{entry.characterName} · {formatTime(session.updatedAt ?? session.createdAt)}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[10.5px] text-muted-foreground/80 leading-tight">
              <span className="truncate">{session.lastMessagePreview || t("history.turns", { count: session.turnCount ?? 0 })}</span>
              {status && <BackupBadge status={status} />}
            </span>
          </span>
        </button>
        {!props.manage && (
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`${t("history.more_actions")}: ${session.title}`} onClick={props.onToggleMenu}>
            {props.menuOpen ? <X className="size-4" /> : <Ellipsis className="size-4" />}
          </Button>
        )}
      </div>
      {props.menuOpen && !props.manage && (
        <div className="grid grid-cols-2 gap-1 border-t border-border/60 p-1.5 sm:grid-cols-3">
          <ActionButton icon={Pencil} label={t("history.rename")} onClick={props.onRename} />
          {props.category === "active" ? (
            <>
              <ActionButton icon={Heart} label={entry.favorite ? t("session_manager.favorite_saved") : t("session_manager.favorite")} onClick={entry.favorite ? props.onDetails : props.onFavorite} />
              {entry.favorite?.status === "outdated" && <ActionButton icon={CopyCheck} label={t("session_manager.update_backup")} onClick={props.onUpdateFavorite} />}
              <ActionButton icon={CircleAlert} label={t("session_manager.details")} onClick={props.onDetails} />
              <ActionButton icon={Network} label={t("session_manager.parallel_universe")} onClick={props.onUniverse} />
              <ActionButton icon={Archive} label={t("session_manager.archive")} onClick={props.onArchive} />
              <ActionButton destructive icon={Trash2} label={t("history.delete")} onClick={props.onDelete} />
            </>
          ) : (
            <>
              <ActionButton icon={ArchiveRestore} label={t("session_manager.restore")} onClick={props.onRestore} />
              <ActionButton icon={CircleAlert} label={t("session_manager.details")} onClick={props.onDetails} />
              <ActionButton destructive icon={Trash2} label={t("session_manager.delete_permanent")} onClick={props.onDelete} />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function FavoriteRow(props: {
  entry: FavoriteSessionBackupEntry;
  manage: boolean;
  selected: boolean;
  menuOpen: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleMenu: () => void;
  onOpen: () => void;
  onUpdate: () => void;
  onRestore: () => void;
  onDetails: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const entry = props.entry;
  return (
    <article className="rounded-xl border border-border/70 bg-card">
      <div className="flex min-h-[64px] items-center gap-2.5 p-2">
        {props.manage && <Checkbox checked={props.selected} onCheckedChange={props.onSelect} aria-label={entry.metadata.title} />}
        <button type="button" disabled={!entry.sourceSession && !props.manage} onClick={props.manage ? props.onSelect : props.onOpen} className="min-w-0 flex-1 rounded-lg px-1 text-left disabled:cursor-default">
          <span className="flex items-center gap-2">
            <strong className="min-w-0 flex-1 truncate text-xs font-semibold leading-tight">{entry.metadata.title}</strong>
            <BackupBadge status={entry.status} />
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground leading-tight">{entry.metadata.characterName} · {t("session_manager.backed_up_at", { time: formatTime(entry.metadata.updatedAt) })}</span>
          {entry.status === "source_missing" && <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{t("session_manager.source_deleted")}</span>}
          {entry.status === "outdated" && <span className="mt-0.5 block text-[10.5px] text-amber-600 dark:text-amber-400">{t("session_manager.backup_outdated_detail")}</span>}
        </button>
        {!props.manage && <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`${t("history.more_actions")}: ${entry.metadata.title}`} onClick={props.onToggleMenu}>{props.menuOpen ? <X className="size-4" /> : <Ellipsis className="size-4" />}</Button>}
      </div>
      {props.menuOpen && !props.manage && (
        <div className="grid grid-cols-2 gap-1 border-t border-border/60 p-1.5 sm:grid-cols-3">
          {entry.sourceSession && <ActionButton icon={History} label={t("session_manager.open_source")} onClick={props.onOpen} />}
          {entry.sourceSession && <ActionButton icon={CopyCheck} label={t("session_manager.update_backup")} onClick={props.onUpdate} />}
          <ActionButton icon={ArchiveRestore} label={t("session_manager.restore_from_backup")} onClick={props.onRestore} />
          <ActionButton icon={CircleAlert} label={t("session_manager.details")} onClick={props.onDetails} />
          <ActionButton destructive icon={Trash2} label={t("session_manager.remove_favorite")} onClick={props.onRemove} />
        </div>
      )}
    </article>
  );
}

function SessionDetail({ target, mutating, onBack, onContinue, onUniverse }: {
  target: DetailTarget;
  mutating: boolean;
  onBack: () => void;
  onContinue: () => void;
  onUniverse: () => void;
}) {
  const { t } = useTranslation();
  const session = target.kind === "session" ? target.entry.session : target.entry.sourceSession;
  const title = target.kind === "session" ? target.entry.session.title : target.entry.metadata.title;
  const characterName = target.kind === "session" ? target.entry.characterName : target.entry.metadata.characterName;
  const createdAt = target.kind === "session" ? target.entry.session.createdAt : target.entry.metadata.createdAt;
  const updatedAt = target.kind === "session"
    ? target.entry.session.updatedAt ?? target.entry.session.createdAt
    : target.entry.metadata.updatedAt;
  const turnCount = target.kind === "session" ? target.entry.session.turnCount ?? 0 : target.entry.metadata.messageCount;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-10 items-center gap-2 border-b border-border/70 px-3">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label={t("common.back")}><ChevronLeft className="size-4.5" /></Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("session_manager.details")}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{characterName}</p>
        <dl className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70 bg-card px-3">
          <DetailRow icon={Clock3} label={t("session_manager.created_at")} value={formatTime(createdAt)} />
          <DetailRow icon={History} label={t("session_manager.updated_at")} value={formatTime(updatedAt)} />
          <DetailRow icon={UserRound} label={t("session_manager.turn_count")} value={String(turnCount)} />
          {target.kind === "session" && <>
            <DetailRow icon={UserRound} label={t("session_manager.char_count")} value={String(target.entry.session.charCount ?? 0)} />
            <DetailRow icon={History} label={t("session_manager.summary_count")} value={String(target.entry.session.summaries?.length ?? 0)} />
            <DetailRow icon={Network} label={t("session_manager.branch_count")} value={String(target.entry.branchCount)} />
            <DetailRow icon={Network} label={t("session_manager.parent_branch")} value={target.entry.session.parentSessionId || t("session_manager.no_parent_branch")} />
            <DetailRow icon={CopyCheck} label={t("session_manager.runtime_profile")} value={formatRuntimeProfile(target.entry.session)} />
            {target.entry.favorite && <DetailRow icon={CopyCheck} label={t("session_manager.backup_status")} value={t(`session_manager.status_${target.entry.favorite.status}`)} />}
          </>}
          {target.kind === "favorite" && <DetailRow icon={CopyCheck} label={t("session_manager.backup_status")} value={t(`session_manager.status_${target.entry.status}`)} />}
        </dl>
        <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
          {session?.lifecycle !== "archived" && <Button size="default" className="h-9 text-xs" disabled={mutating} onClick={onContinue}>{t("session_manager.continue")}</Button>}
          {session?.lifecycle !== "archived" && <Button size="default" variant="outline" className="h-9 text-xs" disabled={mutating} onClick={onUniverse}><Network className="size-3.5" />{t("session_manager.parallel_universe")}</Button>}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return <div className="flex min-h-9 items-center gap-3 py-1.5 text-xs"><Icon className="size-3.5 text-muted-foreground" /><dt className="flex-1 text-muted-foreground">{label}</dt><dd className="text-right">{value}</dd></div>;
}

function ActionButton({ icon: Icon, label, onClick, destructive = false }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; destructive?: boolean }) {
  return <Button type="button" variant="ghost" size="sm" onClick={onClick} className={`h-8 justify-start text-xs ${destructive ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}`}><Icon className="size-3.5" />{label}</Button>;
}

function BatchBar({ category, count, disabled, onPrimary, onSecondary }: { category: SessionDirectoryCategory; count: number; disabled: boolean; onPrimary: () => void; onSecondary: () => void }) {
  const { t } = useTranslation();
  const primary = category === "active" ? "favorite" : category === "favorite" ? "update_backup" : "restore";
  const secondary = category === "active" ? "archive" : category === "favorite" ? "remove_favorite" : "delete_permanent";
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-background p-3">
      <span className="mr-auto text-xs text-muted-foreground">{t("session_manager.selected_count", { count })}</span>
      <Button variant="outline" size="sm" className="h-8 text-xs" disabled={disabled} onClick={onPrimary}>{t(`session_manager.${primary}`)}</Button>
      <Button variant={category === "archived" || category === "favorite" ? "destructive" : "secondary"} size="sm" className="h-8 text-xs" disabled={disabled} onClick={onSecondary}>{t(`session_manager.${secondary}`)}</Button>
    </div>
  );
}

function SessionAvatar({ name, avatar }: { name: string; avatar?: string }) {
  return <span className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 ${avatar ? "bg-muted" : getAvatarGradientClass(name)}`}>{avatar ? <img src={avatar} alt={name} loading="lazy" decoding="async" className="size-full object-cover" /> : <span className="text-xs font-semibold">{name[0] || "?"}</span>}</span>;
}

function BackupBadge({ status }: { status: FavoriteSessionBackupEntry["status"] }) {
  const { t } = useTranslation();
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${status === "outdated" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{t(`session_manager.status_${status}`)}</span>;
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

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  const safeVal = value || "__empty__";
  const selectedLabel = options.find(([optVal]) => (optVal || "__empty__") === safeVal)?.[1] || options[0]?.[1] || "";

  return (
    <div className="min-w-0 text-[11px] text-muted-foreground">
      <span className="mb-0.5 block truncate font-medium">{label}</span>
      <Select
        value={safeVal}
        onValueChange={(val) => onChange(val === "__empty__" ? "" : String(val ?? ""))}
      >
        <SelectTrigger
          aria-label={label}
          className="h-8 w-full rounded-lg border-border/80 bg-background/90 px-2.5 text-xs text-foreground"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="z-[999] border border-border bg-popover p-1 shadow-2xl">
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue || "__empty__"} value={optionValue || "__empty__"} className="min-h-8 px-2.5 text-xs font-medium">
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function rangeOptions(t: (key: string, params?: Record<string, string | number>) => string): Array<readonly [string, string]> {
  return [
    ["", t("session_manager.filter_any")],
    ["7", t("session_manager.filter_last_7_days")],
    ["30", t("session_manager.filter_last_30_days")],
  ];
}

function getRangeStart(value: string): number | undefined {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : undefined;
}

function formatRuntimeProfile(session: ChatSession): string {
  const snapshot = session.compositionSnapshot;
  return snapshot ? `${snapshot.profileId} v${snapshot.profileVersion}` : "—";
}

function groupEntries(entries: SessionDirectoryEntry[]): Array<{ label: "today" | "yesterday" | "week" | "earlier"; entries: SessionDirectoryEntry[] }> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups = new Map<string, SessionDirectoryEntry[]>();
  for (const entry of entries) {
    const time = entry.session.updatedAt ?? entry.session.createdAt;
    const label = time >= today ? "today" : time >= today - day ? "yesterday" : time >= today - 7 * day ? "week" : "earlier";
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return (["today", "yesterday", "week", "earlier"] as const).flatMap((label) => {
    const items = groups.get(label);
    return items?.length ? [{ label, entries: items }] : [];
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
