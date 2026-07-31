import React from "react";
import {
  Download,
  FileImage,
  FileJson2,
  FileUp,
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
import { formatCommunityFileSize } from "../domain/community/presentation";
import { generateCharacterPngBlob } from "../utils/characterPngExporter";
import { parseCharacterFile } from "../utils/cardParser";
import type { CharacterCard } from "../types";
import { CommunityCardDetail } from "../components/community/CommunityCardDetail";

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

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [cards, setCards] = React.useState<CommunityCardSummary[]>([]);
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [uploadSource, setUploadSource] = React.useState<"existing" | "local" | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = React.useState(
    characters[0]?.id || "",
  );
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

  const doUpload = async (blob: Blob, fileName: string, title: string) => {
    if (uploading) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const uploaded = await uploadCommunityCard({
        blob,
        fileName,
        title,
        description: uploadDescription.trim(),
        identity,
        onProgress: setUploadProgress,
      });
      setCards((previous) => [uploaded, ...previous]);
      setUploadDescription("");
      setUploadSource(null);
      await showCustomAlert(
        t("community.upload_success", { name: title, user: identity.name }),
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

  const handleUploadExisting = async () => {
    if (!selectedCharacterId) return;
    const character = await loadCharacterById(selectedCharacterId);
    if (!character) {
      await showCustomAlert(t("community.character_missing"));
      return;
    }
    const blob = await generateCharacterPngBlob(character);
    await doUpload(blob, `${character.name.replace(/\s+/g, "_")}.png`, character.name);
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "png" && ext !== "json") {
      await showCustomAlert(t("community.invalid_file_format"));
      return;
    }
    const title = file.name.replace(/\.(png|json)$/i, "");
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    await doUpload(blob, file.name, title);
    // Reset file input so the same file can be re-selected
    event.target.value = "";
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
    <div className="px-4 pb-4 pt-1.5 space-y-3">
      {/* Header - 与其他标签页统一样式 */}
      <div className="min-h-12 flex items-center border-b border-border pb-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 text-base font-bold tracking-tight text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("community.title")}
          </h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground font-light">
            {t("community.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-background/65 px-2.5 py-1 text-[10px] text-primary">
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[80px]">{identity.name}</span>
        </div>
      </div>

      {/* 搜索栏 + 分享按钮 同一行 */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadCards(search);
            }}
            placeholder={t("community.search_placeholder")}
            className="h-9 w-full rounded-lg border border-border bg-input pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadCards(search)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-primary"
          aria-label={t("community.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => setUploadSource(uploadSource ? null : "existing")}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground shadow-sm active:scale-95"
        >
          <Upload className="h-3.5 w-3.5" />
          分享
        </button>
      </div>

      {/* 上传面板 */}
      {uploadSource && (
        <div className="rounded-xl border border-border/70 bg-card/80 p-3 shadow-sm space-y-2.5 animate-fadeIn">
          {/* 来源选择 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUploadSource("existing")}
              className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-medium transition ${
                uploadSource === "existing"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <FileImage className="mx-auto mb-0.5 h-4 w-4" />
              已有角色卡
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadSource("local");
                handleFilePick();
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-medium transition ${
                uploadSource === "local"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <FileUp className="mx-auto mb-0.5 h-4 w-4" />
              本地文件
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.json"
              className="hidden"
              onChange={(event) => void handleLocalFile(event)}
            />
          </div>

          {/* 已有角色卡选择器 */}
          {uploadSource === "existing" && (
            <div className="flex gap-2">
              <select
                value={selectedCharacterId}
                onChange={(event) => setSelectedCharacterId(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground outline-none focus:border-primary"
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
                onClick={() => void handleUploadExisting()}
                className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground active:scale-95 disabled:opacity-50"
              >
                {uploading
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <Upload className="h-3.5 w-3.5" />}
                {t("community.upload")}
              </button>
            </div>
          )}

          {/* 本地文件已选择 */}
          {uploadSource === "local" && (
            <p className="text-[10px] text-muted-foreground text-center">
              选择文件后自动上传
            </p>
          )}

          <textarea
            value={uploadDescription}
            onChange={(event) => setUploadDescription(event.target.value.slice(0, 1000))}
            rows={2}
            placeholder="角色卡介绍（选填）"
            className="w-full resize-none rounded-lg border border-border bg-input px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {t("community.identity_hint", {
                user: identity.name,
                uuid: identity.uuid.slice(0, 8),
              })}
            </span>
            <span>{uploadDescription.length}/1000</span>
          </div>
          {uploading && (
            <div aria-label={`上传进度 ${uploadProgress}%`}>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
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
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          {t("community.load_failed", { error })}
        </div>
      )}

      {/* 角色卡网格 */}
      <section className="grid grid-cols-2 gap-2.5">
        {!loading && cards.length === 0 && (
          <div className="col-span-2 rounded-2xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
            {t("community.empty")}
          </div>
        )}
        {cards.map((card) => {
          const isPng = card.mimeType === "image/png";
          return (
            <article
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailCard(card)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setDetailCard(card);
              }}
              className="group overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-transform active:scale-[0.99]"
            >
              <div className="relative h-28 overflow-hidden bg-gradient-to-br from-primary/20 via-violet-500/10 to-amber-400/10">
                {isPng ? (
                  <img
                    src={buildCommunityUrl(card.downloadUrl)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <FileJson2 className="h-10 w-10 text-primary/40" aria-hidden="true" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-2.5">
                  <h2 className="truncate text-sm font-bold text-white drop-shadow">
                    {card.title}
                  </h2>
                </div>
              </div>

              <div className="p-2.5">
                <p className="line-clamp-1 text-[10px] leading-relaxed text-muted-foreground min-h-[1.2rem]">
                  {card.description || t("community.no_description")}
                </p>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <UserRound className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate">{card.uploaderName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{formatCommunityFileSize(card.fileSize)}</span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-muted-foreground">
                    <Download className="h-3 w-3 shrink-0" />
                    {card.downloadCount}
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(downloadingId)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownload(card);
                    }}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary px-2 text-[10px] font-semibold text-primary-foreground shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    {downloadingId === card.id
                      ? <LoaderCircle className="h-3 w-3 animate-spin" />
                      : <Download className="h-3 w-3" />}
                    {t("community.download")}
                  </button>
                </div>
                {downloadingId === card.id && (
                  <div className="mt-1.5" aria-label={`下载进度 ${downloadProgress}%`}>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-[9px] text-muted-foreground">
                      {downloadProgress}%
                    </p>
                  </div>
                )}
              </div>
            </article>
          );
        })}
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
          onDownload={(card) => {
            void handleDownload(card);
          }}
          downloading={Boolean(downloadingId)}
        />
      )}
    </div>
  );
}
