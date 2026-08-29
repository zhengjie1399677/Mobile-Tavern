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
  X,
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
import {
  isCharacterCardFileSizeAllowed,
  parseCharacterFile,
} from "../utils/cardParser";
import type { CharacterCard } from "../types";
import { CommunityCardDetail } from "../components/community/CommunityCardDetail";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

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
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadSource, setUploadSource] = React.useState<"existing" | "local" | null>("existing");
  const [selectedCharacterId, setSelectedCharacterId] = React.useState(
    characters[0]?.id || "",
  );
  const [uploadTitle, setUploadTitle] = React.useState("");
  const [uploadDescription, setUploadDescription] = React.useState("");
  const [localFileInfo, setLocalFileInfo] = React.useState<{
    blob: Blob;
    fileName: string;
    name: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [downloadingId, setDownloadingId] = React.useState<string>();
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [error, setError] = React.useState<string>();
  const [detailCard, setDetailCard] = React.useState<CommunityCardSummary>();

  useMobileBackHandler(uploadOpen, () => {
    setUploadOpen(false);
    return true;
  }, 850);

  React.useEffect(() => {
    if (!selectedCharacterId && characters[0]?.id) {
      setSelectedCharacterId(characters[0].id);
    }
  }, [characters, selectedCharacterId]);

  // Sync selected character's name to uploadTitle when it changes
  React.useEffect(() => {
    if (uploadSource === "existing" && selectedCharacterId) {
      const char = characters.find((c) => c.id === selectedCharacterId);
      if (char) {
        setUploadTitle(char.name);
        setUploadDescription(char.description || char.personality || "");
      }
    }
  }, [selectedCharacterId, uploadSource, characters]);

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
    if (!isCharacterCardFileSizeAllowed(blob.size)) {
      await showCustomAlert("角色卡文件必须小于等于 20 MB");
      return;
    }
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
      setUploadTitle("");
      setLocalFileInfo(null);
      setUploadOpen(false);
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

  const handleConfirmUpload = async () => {
    if (!uploadTitle.trim()) {
      await showCustomAlert("请输入角色名称");
      return;
    }

    if (uploadSource === "existing") {
      if (!selectedCharacterId) return;
      const character = await loadCharacterById(selectedCharacterId);
      if (!character) {
        await showCustomAlert(t("community.character_missing"));
        return;
      }
      const blob = await generateCharacterPngBlob(character);
      await doUpload(
        blob,
        `${character.name.replace(/\s+/g, "_")}.png`,
        uploadTitle.trim(),
      );
    } else {
      if (!localFileInfo) {
        await showCustomAlert("请先选择本地文件");
        return;
      }
      await doUpload(
        localFileInfo.blob,
        localFileInfo.fileName,
        uploadTitle.trim(),
      );
    }
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleLocalFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "png" && ext !== "json") {
      await showCustomAlert(t("community.invalid_file_format"));
      return;
    }
    if (!isCharacterCardFileSizeAllowed(file.size)) {
      await showCustomAlert("角色卡文件必须小于等于 20 MB");
      event.target.value = "";
      return;
    }
    const title = file.name.replace(/\.(png|json)$/i, "");
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    
    // Parse character description if possible
    let description = "";
    try {
      const parsed = await parseCharacterFile(
        new File([blob], file.name, { type: file.type }),
      );
      if (parsed.description) {
        description = parsed.description;
      } else if (parsed.personality) {
        description = parsed.personality;
      }
    } catch (e) {
      console.warn("Failed to pre-parse description from local file:", e);
    }

    setLocalFileInfo({
      blob,
      fileName: file.name,
      name: file.name,
    });
    setUploadTitle(title);
    setUploadDescription(description);
    
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
    <div className="space-y-4 px-4 pb-5 pt-2">
      <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/12 via-card/90 to-violet-500/10 p-3.5 shadow-sm">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-foreground">
                {t("community.title")}
              </h1>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {t("community.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 text-[11px] text-foreground shadow-sm backdrop-blur-sm">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[48px] truncate font-medium">{identity.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/15 transition-opacity hover:opacity-90 active:scale-95"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>分享</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/70 p-1.5 shadow-sm backdrop-blur-sm">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary/70" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadCards(search);
            }}
            placeholder={t("community.search_placeholder")}
            className="h-11 w-full rounded-xl border-0 bg-transparent pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadCards(search)}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:text-primary active:scale-95"
          aria-label={t("community.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 上传/分享弹窗 (Modal) */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[120] bg-black/60 backdrop-blur-sm"
          className="z-[120] w-full max-w-sm gap-0 overflow-hidden rounded-2xl bg-background/95 p-5 shadow-2xl"
        >
            {/* 弹窗 Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <DialogTitle className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <Upload className="w-4 h-4 text-primary" />
                <span>分享角色卡</span>
              </DialogTitle>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                aria-label="关闭分享角色卡"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 来源选择 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setUploadSource("existing");
                  setLocalFileInfo(null);
                  if (characters[0]?.id) {
                    setSelectedCharacterId(characters[0].id);
                  }
                }}
                className={`flex-1 rounded-xl border py-2.5 text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all tap-scale ${
                  uploadSource === "existing"
                    ? "border-primary bg-primary/10 text-primary shadow-[0_0_12px_rgba(var(--primary),0.2)]"
                    : "border-border bg-card/45 text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <FileImage className="h-4.5 w-4.5" />
                <span>已有角色卡</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUploadSource("local");
                  handleFilePick();
                }}
                className={`flex-1 rounded-xl border py-2.5 text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all tap-scale ${
                  uploadSource === "local"
                    ? "border-primary bg-primary/10 text-primary shadow-[0_0_12px_rgba(var(--primary),0.2)]"
                    : "border-border bg-card/45 text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <FileUp className="h-4.5 w-4.5" />
                <span>本地文件</span>
              </button>
            </div>

            {/* 隐藏的文件输入 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.json"
              className="hidden"
              onChange={(event) => void handleLocalFileSelect(event)}
            />

            {/* 本地文件选择反馈 */}
            {uploadSource === "local" && localFileInfo && (
              <div className="text-center bg-primary/5 border border-primary/20 rounded-xl p-2.5 text-xs text-primary font-medium flex items-center justify-center gap-1.5 animate-fadeIn">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[200px]">{localFileInfo.fileName}</span>
              </div>
            )}

            {/* 表单输入区 */}
            <div className="space-y-3.5">
              {/* 已有角色选择器 */}
              {uploadSource === "existing" && characters.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-semibold">选择本地角色</label>
                  <select
                    value={selectedCharacterId}
                    onChange={(event) => setSelectedCharacterId(event.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-input px-3 text-xs text-foreground shadow-inner outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                    aria-label={t("community.select_character")}
                  >
                    {characters.map((character) => (
                      <option className="bg-card text-foreground" key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 角色名称编辑 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-semibold">角色名称</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(event) => setUploadTitle(event.target.value)}
                  placeholder="请输入角色名称"
                  className="h-11 w-full rounded-xl border border-border bg-input px-3 text-xs text-foreground shadow-inner outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
              </div>

              {/* 描述编辑域 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-semibold">角色介绍（选填）</label>
                <textarea
                  value={uploadDescription}
                  onChange={(event) => setUploadDescription(event.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="介绍角色卡的性格、背景设定或特色对白..."
                  className="w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition shadow-inner"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("community.identity_hint", {
                    user: identity.name,
                    uuid: identity.uuid.slice(0, 8),
                  })}
                </span>
                <span>{uploadDescription.length}/1000</span>
              </div>
            </div>

            {/* 上传进度 */}
            {uploading && (
              <div aria-label={`上传进度 ${uploadProgress}%`} className="space-y-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-right text-[10px] text-muted-foreground font-medium">
                  上传中 {uploadProgress}%
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="h-11 flex-1 rounded-xl border border-border bg-card text-xs font-bold text-foreground transition-colors active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  uploading ||
                  (uploadSource === "existing" && !selectedCharacterId) ||
                  (uploadSource === "local" && !localFileInfo) ||
                  !uploadTitle.trim()
                }
                onClick={() => void handleConfirmUpload()}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-md transition-opacity active:scale-95 disabled:opacity-50"
              >
                {uploading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>确认发布</span>
              </button>
            </div>
        </DialogContent>
      </Dialog>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {t("community.load_failed", { error })}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3.5">
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
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setDetailCard(card);
              }}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm outline-none transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring spring-press-effect"
            >
              <div
                data-testid="community-card-cover"
                className="relative aspect-[4/5] w-full shrink-0 overflow-hidden border-b border-border/35 bg-gradient-to-br from-primary/12 via-muted/35 to-violet-500/10 p-2.5"
              >
                {isPng ? (
                  <img
                    src={buildCommunityUrl(card.thumbnailUrl || card.downloadUrl)}
                    alt={card.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full rounded-xl bg-background/35 object-contain shadow-inner"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-border/40 bg-background/35 shadow-inner">
                    <FileJson2 className="h-12 w-12 text-primary/35" aria-hidden="true" />
                  </div>
                )}
                <div className="absolute left-4 top-4 flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white backdrop-blur-md">
                  {isPng ? "PNG" : "JSON"}
                </div>
                <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[8px] font-semibold text-white backdrop-blur-md">
                  <Download className="h-2.5 w-2.5" />
                  {card.downloadCount}
                </div>
              </div>

              <div className="flex flex-1 flex-col p-3">
                <h2 className="truncate text-xs font-bold tracking-wide text-foreground">
                  {card.title}
                </h2>
                <p className="mt-1.5 line-clamp-2 min-h-[2.4rem] text-xs leading-relaxed text-muted-foreground">
                  {card.description || t("community.no_description")}
                </p>

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/35 pt-2.5 text-[9px] text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                      {card.uploaderName.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="truncate font-medium text-foreground/85">{card.uploaderName}</span>
                  </div>
                  <span className="shrink-0 text-[8px] opacity-80">
                    {t("community.uploaded_at", { time: formatCommunityTimestamp(card.createdAt, language) })}
                  </span>
                </div>
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
          downloadProgress={downloadingId === detailCard.id ? downloadProgress : undefined}
        />
      )}
    </div>
  );
}

