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
}

export interface SessionDirectoryQuery {
  search?: string;
  characterId?: string;
  createdAfter?: number;
  updatedAfter?: number;
  hasBranch?: boolean;
  backupStatus?: Exclude<FavoriteBackupStatus, "source_missing">;
  sort?: "updated_desc" | "created_asc" | "title_asc" | "turns_desc";
}
