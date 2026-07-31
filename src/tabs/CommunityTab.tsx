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
import { formatCommunityFileSize, formatCommunityTimestamp } from "../domain/community/presentation";
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
    <div className="px-4 pb-4 pt-1.5 space-y-4">
      {/* Header - 与其他标签页统一样式 */}
      <div className="flex min-h-12 items-center justify-between border-b border-border pb-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-base font-bold tracking-tight text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("community.title")}
          </h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground font-light">
            {t("community.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 用户标识 */}
          <div className="flex h-8 items-center gap-1 rounded-lg border border-primary/20 bg-background/65 px-2.5 text-[11px] text-primary shrink-0">
            <UserRound className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[80px] font-medium">{identity.name}</span>
          </div>
          {/* 小入口分享按钮 */}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="flex h-8 items-center gap-1 rounded-lg bg-primary/10 border border-primary/30 px-3 text-[11px] font-semibold text-primary shadow-sm hover:bg-primary/20 active:scale-95 transition-all shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>分享</span>
          </button>
        </div>
      </div>

      {/* 搜索栏 + 刷新 */}
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
            className="h-9 w-full rounded-lg border border-border bg-input pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadCards(search)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-primary active:scale-95 transition"
          aria-label={t("community.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 上传/分享弹窗 (Modal) */}
      {uploadOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          {/* 点击外部关闭 */}
          <div className="absolute inset-0" onClick={() => setUploadOpen(false)} />
          {/* 弹窗主体 */}
          <div className="relative w-full max-w-sm glass-panel rounded-2xl shadow-2xl overflow-hidden z-10 p-5 space-y-4 animate-in zoom-in-95 duration-200">
            {/* 弹窗 Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-primary" />
                <span>分享角色卡</span>
              </h3>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all"
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
                  <label className="text-[10px] text-muted-foreground font-semibold">选择本地角色</label>
                  <select
                    value={selectedCharacterId}
                    onChange={(event) => setSelectedCharacterId(event.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-input px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition shadow-inner"
                    aria-label={t("community.select_character")}
                  >
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 角色名称编辑 */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-semibold">角色名称</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(event) => setUploadTitle(event.target.value)}
                  placeholder="请输入角色名称"
                  className="h-9 w-full rounded-xl border border-border bg-input px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition shadow-inner"
                />
              </div>

              {/* 描述编辑域 */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-semibold">角色介绍（选填）</label>
                <textarea
                  value={uploadDescription}
                  onChange={(event) => setUploadDescription(event.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="介绍角色卡的性格、背景设定或特色对白..."
                  className="w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition shadow-inner"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
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
                className="flex-1 h-9 rounded-xl border border-border bg-card text-xs text-foreground font-bold active:scale-95 transition-all"
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
                className="flex-1 h-9 rounded-xl bg-primary text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 transition-all"
              >
                {uploading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>确认发布</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {t("community.load_failed", { error })}
        </div>
      )}

      {/* 角色卡列表网格 - 统一为双列 */}
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
                if (event.key === "Enter" || event.key === " ") setDetailCard(card);
              }}
              className="group overflow-hidden rounded-xl border border-border/60 bg-card/65 shadow-sm hover:border-primary/30 transition-all duration-300 spring-press-effect flex flex-col h-full"
            >
              {/* 卡片封面区域 */}
              <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-primary/10 via-violet-500/5 to-amber-500/5 border-b border-border/40 shrink-0">
                {isPng ? (
                  <img
                    src={buildCommunityUrl(card.downloadUrl)}
                    alt={card.title}
                    loading="lazy"
                    className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <FileJson2 className="h-12 w-12 text-primary/30" aria-hidden="true" />
                  </div>
                )}
                {/* 格式角标 */}
                <div className="absolute top-2 left-2 flex items-center gap-1 text-[8px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-black/60 text-white border border-white/10 backdrop-blur-md">
                  {isPng ? "PNG" : "JSON"}
                </div>
                
                {/* 底部文字遮罩层 */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 pt-6">
                  <h2 className="text-xs font-bold text-white tracking-wide truncate drop-shadow-md">
                    {card.title}
                  </h2>
                </div>
              </div>

              {/* 卡片内容主体 */}
              <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                <p className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/80 min-h-[2.4rem] font-light">
                  {card.description || t("community.no_description")}
                </p>

                {/* 底部作者与数据行 */}
                <div className="space-y-1.5 border-t border-border/30 pt-2 text-[9px] text-muted-foreground/75">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1 truncate font-medium text-foreground/90">
                      <UserRound className="h-2.5 w-2.5 shrink-0 text-primary" />
                      <span className="truncate max-w-[70px]">{card.uploaderName}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-0.5">
                      <Download className="h-2.5 w-2.5 text-muted-foreground" />
                      {card.downloadCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[8px] opacity-80">
                    <span>
                      {t("community.uploaded_at", { time: formatCommunityTimestamp(card.createdAt, language) })}
                    </span>
                  </div>
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

