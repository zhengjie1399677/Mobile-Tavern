import type { AgentJournalEvent } from "../agents/contracts";
import type { AttachmentBackupRecord } from "../attachments/types";
import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../../application/services/memory/types";
import type { CharacterCard, ChatSession } from "../../types";

export type SessionDirectoryCategory = "active" | "favorite" | "archived";
export type FavoriteBackupStatus = "current" | "outdated" | "source_missing";
export type SessionDirectorySort = "updated_desc" | "created_desc" | "created_asc" | "title_asc" | "turns_desc";

export interface SessionDirectoryCursor {
  category?: SessionDirectoryCategory;
  sort: SessionDirectorySort;
  value: number | string;
  createdAt: number;
  id: string;
}

export interface SessionDirectoryPageInfo {
  cursor?: SessionDirectoryCursor;
  hasMore: boolean;
}

export interface FavoriteSessionBackupMetadata {
  id: string;
  versionId: string;
  sourceSessionId?: string;
  sourceRevision: number;
  sourceUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  title: string;
  characterName: string;
  integrityHash: string;
  messageCount: number;
}

export interface FavoriteSessionBackupPayload {
  version: 1;
  session: ChatSession;
  character: CharacterCard;
  memoryDictEntries: MemoryDictEntry[];
  memoryFragments: MemoryFragment[];
  memoryFacts: TemporalFact[];
  attachments: AttachmentBackupRecord[];
  agentJournal: AgentJournalEvent[];
}

export interface FavoriteSessionBackupEntry {
  metadata: FavoriteSessionBackupMetadata;
  status: FavoriteBackupStatus;
  sourceSession?: ChatSession;
  newMessageCount: number;
}

export interface SessionDirectoryEntry {
  session: ChatSession;
  characterName: string;
  characterAvatar?: string;
  favorite?: FavoriteSessionBackupEntry;
  branchCount: number;
}

export interface SessionDirectorySnapshot {
  active: SessionDirectoryEntry[];
  favorites: FavoriteSessionBackupEntry[];
  archived: SessionDirectoryEntry[];
  pageInfo: Record<SessionDirectoryCategory, SessionDirectoryPageInfo>;
  characters: ReadonlyArray<{ id: string; name: string }>;
}

export interface SessionDirectoryQuery {
  category?: SessionDirectoryCategory;
  pageSize?: number;
  cursor?: SessionDirectoryCursor;
  search?: string;
  characterId?: string;
  createdAfter?: number;
  updatedAfter?: number;
  hasBranch?: boolean;
  backupStatus?: Exclude<FavoriteBackupStatus, "source_missing">;
  sort?: SessionDirectorySort;
}
