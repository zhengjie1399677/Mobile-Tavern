import React, { useMemo } from "react";
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
  Network,
  Pencil,
  Trash2,
  UserRound,
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
  FavoriteSessionBackupEntry,
  SessionDirectoryCategory,
  SessionDirectoryEntry,
} from "../../domain/session-management";
import { useTranslation } from "../../contexts/LanguageContext";
import type { ChatSession } from "../../types";
import { getAvatarGradientClass } from "../../utils/avatarUtils";

export type DetailTarget = { kind: "session"; entry: SessionDirectoryEntry }
  | { kind: "favorite"; entry: FavoriteSessionBackupEntry };

export function SessionSections(props: {
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

export function FavoriteRow(props: {
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

export function SessionDetail({ target, mutating, onBack, onContinue, onUniverse }: {
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

export function BatchBar({ category, count, disabled, onPrimary, onSecondary }: { category: SessionDirectoryCategory; count: number; disabled: boolean; onPrimary: () => void; onSecondary: () => void }) {
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

export function FilterSelect({ label, value, options, onChange }: {
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
        <SelectContent align="start" className="border border-border bg-popover p-1 shadow-2xl">
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

export function rangeOptions(t: (key: string, params?: Record<string, string | number>) => string): Array<readonly [string, string]> {
  return [
    ["", t("session_manager.filter_any")],
    ["7", t("session_manager.filter_last_7_days")],
    ["30", t("session_manager.filter_last_30_days")],
  ];
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

function formatRuntimeProfile(session: ChatSession): string {
  const snapshot = session.compositionSnapshot;
  return snapshot ? `${snapshot.profileId} v${snapshot.profileVersion}` : "—";
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
