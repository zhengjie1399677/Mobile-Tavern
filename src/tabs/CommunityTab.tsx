import React from "react";
import {
  CalendarDays,
  Cloud,
  Download,
  FileJson2,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
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
import { buildCommunityUrl } from "../domain/community/config";
import { getCommunityIdentity } from "../domain/community/identity";
import { formatCommunityTimestamp } from "../domain/community/presentation";
import { generateCharacterPngBlob } from "../utils/characterPngExporter";
import { parseCharacterFile } from "../utils/cardParser";
import type { CharacterCard } from "../types";
import { CommunityCardDetail } from "../components/community/CommunityCardDetail";

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
    showCustomConfirm,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    characters: state.characters,
    loadCharacterById: state.loadCharacterById,
    saveCharacter: state.saveCharacter,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
  }));
  const { language, t } = useTranslation();
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
  const [uploadDescription, setUploadDescription] = React.useState("");
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [downloadingId, setDownloadingId] = React.useState<string>();
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [error, setError] = React.useState<string>();
  const [detailCard, setDetailCard] = React.useState<CommunityCardSummary>();

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
    setUploadProgress(0);
    try {
      const character = await loadCharacterById(selectedCharacterId);
      if (!character) throw new Error(t("community.character_missing"));
      const blob = await generateCharacterPngBlob(character);
      const uploaded = await uploadCommunityCard({
        blob,
        fileName: `${character.name.replace(/\s+/g, "_")}.png`,
        title: character.name,
        description: uploadDescription.trim(),
        identity,
        onProgress: setUploadProgress,
      });
      setCards((previous) => [uploaded, ...previous]);
      setUploadDescription("");
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
      setUploadProgress(0);
    }
  };

  const handleDownload = async (card: CommunityCardSummary) => {
    if (downloadingId) return;
    setDownloadingId(card.id);
    setDownloadProgress(0);
    try {
      const file = await fetchCommunityCardFile(card, identity, setDownloadProgress);
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
            ? {
                ...item,
                downloadCount: item.downloadCount + 1,
                lastDownloadedAt: Math.floor(Date.now() / 1000),
              }
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
      setDownloadProgress(0);
    }
  };

  return (
    <div className="min-h-screen space-y-4 px-4 pb-6 pt-2">
      <header className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/20 via-card to-violet-500/10 px-4 py-4 shadow-sm">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("community.title")}
          </h1>
          <p className="mt-1 max-w-[15rem] text-xs leading-relaxed text-muted-foreground">
            {t("community.subtitle")}
          </p>
        </div>
        <div className="flex max-w-[42%] items-center gap-1.5 rounded-full border border-primary/25 bg-background/65 px-2.5 py-1.5 text-xs text-primary shadow-sm backdrop-blur">
          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{identity.name}</span>
        </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
        <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Upload className="h-3.5 w-3.5" />
          </span>
          <span>{t("community.share_title")}</span>
        </div>
        <div className="flex gap-2">
          <select
            value={selectedCharacterId}
            onChange={(event) => setSelectedCharacterId(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-input px-3 text-xs text-foreground outline-none focus:border-primary"
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
            className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-50"
          >
            {uploading
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              : <Upload className="h-3.5 w-3.5" />}
            {t("community.upload")}
          </button>
        </div>
        <textarea
          value={uploadDescription}
          onChange={(event) => setUploadDescription(event.target.value.slice(0, 1000))}
          rows={2}
          placeholder="角色卡介绍（选填）"
          className="mt-2.5 w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="mt-1 flex justify-end text-[10px] text-muted-foreground">
          {uploadDescription.length}/1000
        </div>
        {uploading && (
          <div className="mt-2" aria-label={`上传进度 ${uploadProgress}%`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              上传中 {uploadProgress}%
            </p>
          </div>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t("community.identity_hint", {
            user: identity.name,
            uuid: identity.uuid.slice(0, 8),
          })}
        </p>
      </section>

      <form
        className="sticky top-0 z-10 flex gap-2 rounded-xl bg-background/85 py-1.5 backdrop-blur-md"
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
            className="h-10 w-full rounded-xl border border-border bg-input pl-8 pr-3 text-xs text-foreground shadow-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadCards(search)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-primary"
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

      <section className="grid grid-cols-2 gap-3">
        {!loading && cards.length === 0 && (
          <div className="col-span-2 rounded-2xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
            {t("community.empty")}
          </div>
        )}
        {cards.map((card, index) => (
          <article
            key={card.id}
            role="button"
            tabIndex={0}
            onClick={() => setDetailCard(card)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setDetailCard(card);
            }}
            className={`group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-transform active:scale-[0.99] ${
              index === 0 ? "col-span-2" : ""
            }`}
          >
            <div className={`relative overflow-hidden bg-gradient-to-br from-primary/25 via-violet-500/15 to-amber-400/15 ${
              index === 0 ? "h-48" : "h-32"
            }`}>
              {card.mimeType === "image/png" ? (
                <img
                  src={buildCommunityUrl(card.downloadUrl)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <FileJson2 className="h-12 w-12 text-primary/55" aria-hidden="true" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <h2 className={`truncate font-bold text-white drop-shadow ${
                  index === 0 ? "text-lg" : "text-sm"
                }`}>
                  {card.title}
                </h2>
              </div>
              {index === 0 && (
                <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">
                  {t("community.featured")}
                </span>
              )}
            </div>

            <div className="p-3">
              <p className={`text-[11px] leading-relaxed text-muted-foreground ${
                index === 0 ? "line-clamp-2" : "line-clamp-3 min-h-[3rem]"
              }`}>
                {card.description || t("community.no_description")}
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <UserRound className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">{card.uploaderName}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{formatFileSize(card.fileSize)}</span>
              </div>
              <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <span>{t("community.uploaded_at", {
                    time: formatCommunityTimestamp(card.createdAt, language),
                  })}</span>
                </div>
                {card.lastDownloadedAt && (
                  <div className="flex items-center gap-1.5">
                    <Download className="h-3 w-3 shrink-0" />
                    <span>{t("community.last_downloaded_at", {
                      time: formatCommunityTimestamp(card.lastDownloadedAt, language),
                    })}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <Cloud className="h-3 w-3 shrink-0" />
                  {t("community.download_count", { count: String(card.downloadCount) })}
                </span>
              <button
                type="button"
                disabled={Boolean(downloadingId)}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDownload(card);
                }}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-50"
              >
                {downloadingId === card.id
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                {t("community.download")}
              </button>
              </div>
              {downloadingId === card.id && (
                <div className="mt-2" aria-label={`下载进度 ${downloadProgress}%`}>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[9px] text-muted-foreground">
                    {downloadProgress}%
                  </p>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
      {detailCard && (
        <CommunityCardDetail
          card={detailCard}
          identity={identity}
          language={language}
          onClose={() => setDetailCard(undefined)}
          onCardDeleted={(cardId) => {
            setCards((previous) => previous.filter((card) => card.id !== cardId));
          }}
          confirmAction={showCustomConfirm}
          showAlert={showCustomAlert}
        />
      )}
    </div>
  );
}
