import React from "react";
import {
  Cloud,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  Upload,
  UserRound,
} from "lucide-react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import {
  fetchCommunityCardFile,
  listCommunityCards,
  type CommunityCardSummary,
  uploadCommunityCard,
} from "../domain/community/api";
import { getCommunityIdentity } from "../domain/community/identity";
import { generateCharacterPngBlob } from "../utils/characterPngExporter";
import { parseCharacterFile } from "../utils/cardParser";
import type { CharacterCard } from "../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CommunityTab() {
  const {
    settings,
    characters,
    loadCharacterById,
    saveCharacter,
    showCustomAlert,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    characters: state.characters,
    loadCharacterById: state.loadCharacterById,
    saveCharacter: state.saveCharacter,
    showCustomAlert: state.showCustomAlert,
  }));
  const { t } = useTranslation();
  const activePersona = settings.userPersonas?.find(
    (persona) => persona.id === settings.activePersonaId,
  );
  const currentUserName = activePersona?.name || settings.userName || "user";
  const identity = React.useMemo(
    () => getCommunityIdentity(currentUserName),
    [currentUserName],
  );

  const [cards, setCards] = React.useState<CommunityCardSummary[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = React.useState(
    characters[0]?.id || "",
  );
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [downloadingId, setDownloadingId] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (!selectedCharacterId && characters[0]?.id) {
      setSelectedCharacterId(characters[0].id);
    }
  }, [characters, selectedCharacterId]);

  const loadCards = React.useCallback(async (query = search) => {
    setLoading(true);
    setError(undefined);
    try {
      setCards(await listCommunityCards(query));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listCommunityCards("", controller.signal)
      .then(setCards)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const handleUpload = async () => {
    if (!selectedCharacterId || uploading) return;
    setUploading(true);
    try {
      const character = await loadCharacterById(selectedCharacterId);
      if (!character) throw new Error(t("community.character_missing"));
      const blob = await generateCharacterPngBlob(character);
      const uploaded = await uploadCommunityCard({
        blob,
        fileName: `${character.name.replace(/\s+/g, "_")}.png`,
        title: character.name,
        description: character.description || character.personality || "",
        identity,
      });
      setCards((previous) => [uploaded, ...previous]);
      await showCustomAlert(
        t("community.upload_success", { name: character.name, user: identity.name }),
      );
    } catch (uploadError) {
      await showCustomAlert(
        t("community.upload_failed", {
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
        }),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (card: CommunityCardSummary) => {
    if (downloadingId) return;
    setDownloadingId(card.id);
    try {
      const file = await fetchCommunityCardFile(card, identity);
      const parsed = await parseCharacterFile(file);
      const importedCharacter: CharacterCard = {
        id: `char_community_${crypto.randomUUID?.() || Date.now()}`,
        name: parsed.name || card.title,
        avatar: parsed.avatar || "",
        description: parsed.description || "",
        personality: parsed.personality || "",
        scenario: parsed.scenario || "",
        first_mes: parsed.first_mes || "",
        mes_example: parsed.mes_example || "",
        system_prompt: parsed.system_prompt || "",
        post_history_instructions: parsed.post_history_instructions || "",
        alternate_greetings: parsed.alternate_greetings || [],
        lorebookEntries: parsed.lorebookEntries || [],
        isWorldbookGlobal: false,
        creator: parsed.creator || card.uploaderName,
        creator_notes: parsed.creator_notes || "",
        tags: parsed.tags || [],
        character_version: parsed.character_version || "1.0.0",
        extensions: {
          ...(parsed.extensions || {}),
          mt_community_source: {
            cardId: card.id,
            uploaderName: card.uploaderName,
            downloadedByName: identity.name,
            downloadedByUuid: identity.uuid,
            downloadedAt: Date.now(),
          },
        },
        visualSettings: parsed.visualSettings,
      };
      await saveCharacter(importedCharacter);
      setCards((previous) =>
        previous.map((item) =>
          item.id === card.id
            ? { ...item, downloadCount: item.downloadCount + 1 }
            : item,
        ),
      );
      await showCustomAlert(
        t("community.download_success", {
          name: importedCharacter.name,
          user: identity.name,
        }),
      );
    } catch (downloadError) {
      await showCustomAlert(
        t("community.download_failed", {
          error: downloadError instanceof Error
            ? downloadError.message
            : String(downloadError),
        }),
      );
    } finally {
      setDownloadingId(undefined);
    }
  };

  return (
    <div className="min-h-screen space-y-3 px-4 pb-4 pt-1.5">
      <header className="flex min-h-12 items-center justify-between border-b border-border pb-2">
        <div>
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Cloud className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("community.title")}
          </h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t("community.subtitle")}
          </p>
        </div>
        <div className="flex max-w-[45%] items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{identity.name}</span>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold text-foreground">
          {t("community.share_title")}
        </div>
        <div className="flex gap-2">
          <select
            value={selectedCharacterId}
            onChange={(event) => setSelectedCharacterId(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground"
            aria-label={t("community.select_character")}
          >
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedCharacterId || uploading}
            onClick={handleUpload}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {uploading
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              : <Upload className="h-3.5 w-3.5" />}
            {t("community.upload")}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t("community.identity_hint", {
            user: identity.name,
            uuid: identity.uuid.slice(0, 8),
          })}
        </p>
      </section>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void loadCards(search);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("community.search_placeholder")}
            className="h-9 w-full rounded-lg border border-border bg-input pl-8 pr-2 text-xs text-foreground outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadCards(search)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground"
          aria-label={t("community.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {t("community.load_failed", { error })}
        </div>
      )}

      <section className="space-y-2">
        {!loading && cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            {t("community.empty")}
          </div>
        )}
        {cards.map((card) => (
          <article
            key={card.id}
            className="rounded-xl border border-border/70 bg-card p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {card.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {card.description || t("community.no_description")}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>{t("community.shared_by", { user: card.uploaderName })}</span>
                  <span>{formatFileSize(card.fileSize)}</span>
                  <span>{t("community.download_count", { count: String(card.downloadCount) })}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(downloadingId)}
                onClick={() => void handleDownload(card)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-xs font-semibold text-primary disabled:opacity-50"
              >
                {downloadingId === card.id
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                {t("community.download")}
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
