import React from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import CharacterDetailDrawer from "../components/CharacterDetailDrawer";
import LocalCardScanner from "../components/LocalCardScanner";
import { CharacterCard } from "../types";
import type { ICharacterService } from "../application/serviceContracts";
import {
  Bot,
  Image as ImageIcon,
  Plus,
  Trash2,
  Edit2,
  FileUp,
  FileText,
  RefreshCw,
  Book,
  MoreHorizontal,
  FolderSearch,
  Gamepad2,
  LayoutList,
  Grid3X3,
  Columns2,
  History,
  Sparkles,
  UsersRound,
  LoaderCircle,
} from "lucide-react";
import { getAvatarGradientClass } from "../utils/avatarUtils";
import { listBuiltinPluginCards } from "../infrastructure/plugins/builtinPlugins";
import {
  readCharacterLayout,
  saveCharacterLayout,
  type CharacterLayout,
} from "./characterLayout";
import { preloadChatTab } from "../composition/mainTabLoaders";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";

export default function CharactersTab() {
  const {
    characters,
    sessionCountsByCharacter,
    totalSessionCount,
    areSessionCountsReady,
    activeCharId,
    showCustomConfirm,
    selectCharacter,
    handleAddNewCharacter,
    handleEditCharacter,
    handleDeleteCharacter,
    handleImportCardFile,
    handleExportCharacterJSON,
    handleExportCharacterPNG,
    setActiveTab,
    setActiveWorldbookHostId,
    loadCharacterById,
    getKernelService,
  } = useUnifiedApp(state => ({
    characters: state.characters,
    sessionCountsByCharacter: state.sessionCountsByCharacter,
    totalSessionCount: state.totalSessionCount,
    areSessionCountsReady: state.areSessionCountsReady,
    activeCharId: state.activeCharId,
    showCustomConfirm: state.showCustomConfirm,
    selectCharacter: state.selectCharacter,
    handleAddNewCharacter: state.handleAddNewCharacter,
    handleEditCharacter: state.handleEditCharacter,
    handleDeleteCharacter: state.handleDeleteCharacter,
    handleImportCardFile: state.handleImportCardFile,
    handleExportCharacterJSON: state.handleExportCharacterJSON,
    handleExportCharacterPNG: state.handleExportCharacterPNG,
    setActiveTab: state.setActiveTab,
    setActiveWorldbookHostId: state.setActiveWorldbookHostId,
    loadCharacterById: state.loadCharacterById,
    getKernelService: state.getKernelService,
  }));
  const { t } = useTranslation();
  const [selectedDetailChar, setSelectedDetailChar] = React.useState<CharacterCard | null>(null);
  const [actionMenuChar, setActionMenuChar] = React.useState<CharacterCard | null>(null);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [openingCharacterId, setOpeningCharacterId] = React.useState<string | null>(null);
  const openingCharacterIdRef = React.useRef<string | null>(null);
  useMobileBackHandler(!!actionMenuChar, () => {
    setActionMenuChar(null);
    return true;
  }, 850);
  const [characterLayout, setCharacterLayout] = React.useState<CharacterLayout>(() => {
    try {
      return readCharacterLayout(window.localStorage);
    } catch {
      return "list";
    }
  });
  const changeCharacterLayout = React.useCallback((layout: CharacterLayout) => {
    setCharacterLayout(layout);
    try {
      saveCharacterLayout(window.localStorage, layout);
    } catch {
      // WebView 隐私模式可能禁用 localStorage；本次会话内的布局切换仍然有效。
    }
  }, []);
  // 插件型角色卡：异步加载内置插件并映射为虚拟角色卡，与普通角色卡合并展示。
  const [pluginCards, setPluginCards] = React.useState<CharacterCard[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    listBuiltinPluginCards()
      .then((cards) => { if (!cancelled) setPluginCards(cards); })
      .catch((err) => console.warn("[CharactersTab] Failed to load plugin cards:", err));
    return () => { cancelled = true; };
  }, []);
  const displayCharacters = React.useMemo(
    () => [...characters, ...pluginCards],
    [characters, pluginCards]
  );
  const openCharacter = React.useCallback(async (characterId: string) => {
    if (openingCharacterIdRef.current) return;
    openingCharacterIdRef.current = characterId;
    setOpeningCharacterId(characterId);
    try {
      void preloadChatTab().catch((error: unknown) => {
        console.warn("[CharactersTab] Failed to preload chat view:", error);
      });
      await selectCharacter(characterId);
    } catch (error: unknown) {
      console.error("[CharactersTab] Failed to enter character chat:", error);
    } finally {
      if (openingCharacterIdRef.current === characterId) {
        openingCharacterIdRef.current = null;
      }
      setOpeningCharacterId((current) => current === characterId ? null : current);
    }
  }, [selectCharacter]);

  const handleOpenPureAgent = React.useCallback(async () => {
    const existingChar = characters.find((c) => c.id === "base-agent-builtin");
    if (existingChar) {
      await openCharacter(existingChar.id);
      return;
    }
    const pureChar: CharacterCard = {
      id: "base-agent-builtin",
      name: "通用 AI 助手",
      description: "纯净的通用 AI 助手，无角色人设、无预设模板，直连大模型问答。",
      personality: "",
      scenario: "",
      first_mes: "你好！我是通用 AI 助手，请问有什么可以帮你的？",
      mes_example: "",
      creator_notes: "Built-in Base Profile Agent",
      system_prompt: "",
      post_history_instructions: "",
      tags: ["Base", "Agent", "纯净"],
      creator: "Mobile Tavern",
      character_version: "1.0.0",
      alternate_greetings: [],
      extensions: {
        profileId: "mobile-tavern.base",
      },
    };
    try {
      const characterService = getKernelService<ICharacterService<CharacterCard>>("character");
      if (characterService) {
        await characterService.saveCharacter(pureChar);
      }
    } catch (e) {
      console.warn("[CharactersTab] Auto-persist base-agent-builtin card fallback:", e);
    }
    try {
      await openCharacter(pureChar.id);
    } catch (err) {
      console.error("[CharactersTab] Failed to select Base Agent character:", err);
    }
  }, [characters, getKernelService, openCharacter]);

  return (
    <div className="relative min-h-screen space-y-3.5 px-4 pb-4 pt-2.5">
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/15 via-card to-card p-4 shadow-[0_14px_35px_-24px_var(--primary)]">
        <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
        <Sparkles className="pointer-events-none absolute right-4 top-4 h-12 w-12 text-primary/10" aria-hidden="true" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 pt-0.5">
            <h1 className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-foreground">
              <span className="truncate">Mobile Tavern</span>
              <span className="rounded-md border border-primary/20 bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] text-primary">
                Lite
              </span>
            </h1>
            <p className="mt-1 max-w-[190px] text-xs font-light leading-relaxed text-muted-foreground">
              {t("characters_tab.subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setScannerOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-foreground active:scale-[0.96]"
              title={t("characters_tab.scan_title")}
            >
              <FolderSearch className="h-4 w-4" />
            </button>
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-foreground active:scale-[0.96]" title={t("characters_tab.import_title")}>
              <FileUp className="h-4 w-4" />
              <input
                type="file"
                onChange={handleImportCardFile}
                accept=".png,.webp,.json,.txt,.bin,image/png,image/webp,application/json"
                className="hidden"
              />
            </label>
            <button
              onClick={handleAddNewCharacter}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary font-medium text-primary-foreground shadow-[0_8px_20px_-10px_var(--primary)] transition-colors hover:bg-primary/90 active:scale-[0.96]"
              title={t("characters_tab.create_title")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/85 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-none text-foreground">{displayCharacters.length}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{t("nav.characters")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/85 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-none text-foreground">
                {areSessionCountsReady ? totalSessionCount : "…"}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{t("nav.chat-history")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 纯净 AI 助手 (Base Agent) 专属入口卡片 */}
      <button
        type="button"
        onClick={handleOpenPureAgent}
        className="group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/5 to-card p-3.5 text-left shadow-sm transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Bot className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-bold text-foreground truncate">通用 AI 助手</h2>
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                Base Agent
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">
              无角色人设 / 无预设提示词，直连大模型问答与代码辅助
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center h-8 px-3 rounded-lg bg-primary/15 text-primary text-xs font-semibold group-hover:bg-primary group-hover:text-primary-foreground transition-all">
          开启对话
        </div>
      </button>

      <div className="flex items-center justify-between rounded-xl border border-border/50 bg-card/70 px-2 py-1.5 shadow-sm" role="group" aria-label={t("characters_tab.layout_group")}>
        <span className="pl-1.5 text-xs font-medium text-muted-foreground">{t("characters_tab.layout_group")}</span>
        <div className="flex items-center gap-1">
          {([
            ["list", LayoutList, "characters_tab.layout_list"],
            ["shelf", Grid3X3, "characters_tab.layout_shelf"],
            ["showcase", Columns2, "characters_tab.layout_showcase"],
          ] as const).map(([layout, Icon, labelKey]) => (
            <button
              key={layout}
              type="button"
              onClick={() => changeCharacterLayout(layout)}
              aria-pressed={characterLayout === layout}
              title={t(labelKey)}
              className={`flex size-11 items-center justify-center rounded-lg border transition-colors active:scale-95 ${
                characterLayout === layout
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* List Cards */}
      <div className={
        characterLayout === "list"
          ? "space-y-2.5"
          : characterLayout === "shelf"
            ? "grid grid-cols-3 gap-2"
            : "grid grid-cols-2 gap-3"
      }>
      {/* characters array is pre-sorted by last chat time via useMemo in LegacyAppContextProvider */}
        {displayCharacters.map((char, index) => {
          const isPluginCard = !!char.extensions?.mt_plugin;
          const branchCount = sessionCountsByCharacter[char.id] ?? 0;
          const isActive = activeCharId === char.id;
          const isOpening = openingCharacterId === char.id;

          return (
            <div
              key={char.id}
              onClick={() => { void openCharacter(char.id); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                void openCharacter(char.id);
              }}
              role="button"
              tabIndex={0}
              aria-busy={isOpening}
              style={{ "--card-index": Math.min(index, 6) } as React.CSSProperties}
              className={`mobile-list-item relative flex h-auto cursor-pointer select-none rounded-xl border border-border/50 bg-gradient-to-br from-card to-muted/20 spring-press-effect outline-none focus-visible:ring-2 focus-visible:ring-ring ${index < 8 ? "animate-card-fade-in" : ""} ${
                characterLayout === "list"
                  ? "items-center gap-3 min-h-[96px] p-3"
                  : characterLayout === "shelf"
                    ? "flex-col items-stretch gap-1.5 p-1.5 min-h-[150px]"
                    : "flex-col items-stretch gap-2 p-2 min-h-[220px]"
              } ${
                isActive
                  ? "border-primary/50 ring-1 ring-primary/20 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_30px_-8px_rgba(255,255,255,0.06)] bg-primary/[0.03]"
                  : "shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_10px_25px_-5px_rgba(255,255,255,0.03)] hover:-translate-y-0.5"
              }`}
            >
              {isOpening && (
                <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-xl bg-card/85 text-xs font-semibold text-primary">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  正在进入…
                </div>
              )}
              {/* 插件型角色卡互动角标 */}
              {isPluginCard && (
                <div className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] opacity-60 text-muted-foreground bg-muted/40 px-1 py-0.5 rounded select-none">
                  <Gamepad2 className="w-2 h-2" />
                  <span>{t("characters_tab.interactive_badge")}</span>
                </div>
              )}
              {/* Character Avatar Grid */}
              <div 
                className={`${
                  characterLayout === "list"
                    ? "w-14 h-[72px] shrink-0"
                    : "w-full aspect-[3/4]"
                } rounded-xl overflow-hidden border border-border/40 flex items-center justify-center relative ${
                  char.avatar ? "bg-muted/30" : getAvatarGradientClass(char.name)
                }`}
              >
                {char.avatar ? (
                  <img
                    src={char.avatar}
                    alt={char.name}
                    loading={index < 4 ? "eager" : "lazy"}
                    decoding="async"
                    fetchPriority={index < 2 ? "high" : "auto"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-serif font-bold">
                    {char.name[0]}
                  </span>
                )}
                {/* 绝对定位的立体浮雕高光层：确保叠在不透明图片上方渲染 */}
                <div className="avatar-highlight-overlay" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className={`font-bold text-foreground truncate flex-1 ${characterLayout === "shelf" ? "text-xs" : "text-sm"}`}>
                      {char.name}
                    </h2>
                    {!isPluginCard && (
                      <div
                        className={characterLayout === "list" ? "flex gap-1" : "absolute right-2 top-2 z-10 flex gap-1"}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setActionMenuChar(char)}
                          className="text-muted-foreground hover:text-primary size-11 bg-background/90 rounded-lg hover:bg-muted transition-colors active:scale-95 flex items-center justify-center shrink-0 shadow-sm"
                          title={t("characters_tab.more_title")}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className={`${characterLayout === "shelf" ? "hidden" : "line-clamp-2"} text-xs text-muted-foreground mt-1 leading-snug font-light`}>
                    {char.description || char.personality || t("characters_tab.no_description")}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-1.5">
                  <span className="max-w-full truncate text-[10px] bg-primary/10 border border-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1 font-medium select-none">
                    <RefreshCw className={`h-2.5 w-2.5 ${areSessionCountsReady ? "" : "animate-spin"}`} /> {t("characters_tab.branch_count", { count: areSessionCountsReady ? String(branchCount) : "…" })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}


        {displayCharacters.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl flex flex-col items-center justify-center">
            <Bot className="w-10 h-10 stroke-[1.2] mb-2 text-muted-foreground" />
            <p className="text-sm">{t("characters_tab.empty_title")}</p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
              {t("characters_tab.empty_desc")}
            </p>
          </div>
        )}
      </div>
      <CharacterDetailDrawer
        isOpen={!!selectedDetailChar}
        character={selectedDetailChar}
        onClose={() => setSelectedDetailChar(null)}
      />

      {/* 底部操作抽屉 (BottomSheet) */}
      {actionMenuChar && (
        <Dialog open onOpenChange={(open) => { if (!open) setActionMenuChar(null); }}>
          <DialogContent
            showCloseButton={false}
            style={{ paddingBottom: `calc(16px + env(safe-area-inset-bottom))` }}
            className="!top-auto !bottom-0 !translate-y-0 z-[900] flex w-full max-w-lg flex-col gap-0 rounded-t-3xl rounded-b-none border-x-0 border-b-0 border-t border-border/50 bg-background p-0 shadow-2xl data-open:slide-in-from-bottom sm:!top-1/2 sm:!bottom-auto sm:!-translate-y-1/2 sm:rounded-3xl sm:border"
          >
            <DialogTitle className="sr-only">{actionMenuChar.name}</DialogTitle>
            {/* 顶部手柄装饰 */}
            <div className="flex justify-center py-2.5">
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" aria-hidden="true" />
            </div>

            {/* 角色基本信息预览 */}
            <div className="px-5 pb-4 border-b border-border/40 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border border-border ${
                actionMenuChar.avatar ? "bg-muted" : getAvatarGradientClass(actionMenuChar.name)
              }`}>
                {actionMenuChar.avatar ? (
                  <img src={actionMenuChar.avatar} alt={actionMenuChar.name} decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold">{actionMenuChar.name[0]}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground truncate">{actionMenuChar.name}</p>
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t("characters_tab.action_subtitle")}</p>
              </div>
            </div>

            {/* 功能选项列表 */}
            <div className="p-3 space-y-1">
              <button
                onClick={async () => {
                  const loaded = await loadCharacterById(actionMenuChar.id);
                  if (loaded) setSelectedDetailChar(loaded);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Bot className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.view_profile")}</span>
              </button>

              <button
                onClick={async () => {
                  const loaded = await loadCharacterById(actionMenuChar.id);
                  if (loaded) handleEditCharacter(loaded);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Edit2 className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.edit_character")}</span>
              </button>

              <button
                onClick={async () => {
                  await loadCharacterById(actionMenuChar.id);
                  setActiveWorldbookHostId(actionMenuChar.id);
                  setActiveTab("global-worldbook");
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Book className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.go_worldbook")}</span>
              </button>

              <button
                onClick={async () => {
                  setActionMenuChar(null);
                  const ok = await showCustomConfirm(t("characters_tab.confirm_export_json"));
                  if (ok) {
                    const loaded = await loadCharacterById(actionMenuChar.id);
                    if (loaded) handleExportCharacterJSON(loaded);
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.export_json")}</span>
              </button>

              <button
                onClick={async () => {
                  const loaded = await loadCharacterById(actionMenuChar.id);
                  if (loaded) handleExportCharacterPNG(loaded);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.export_png")}</span>
              </button>

              <div className="h-px bg-border/40 my-1" />

              <button
                onClick={(e) => {
                  handleDeleteCharacter(actionMenuChar.id, e);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-rose-500/10 active:bg-rose-500/20 rounded-xl transition font-medium text-left"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
                <span>{t("characters_tab.delete_char")}</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <LocalCardScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
