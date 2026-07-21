import React, { useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import CharacterDetailDrawer from "../components/CharacterDetailDrawer";
import LocalCardScanner from "../components/LocalCardScanner";
import { CharacterCard } from "../types";
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
} from "lucide-react";
import { getAvatarGradientClass } from "../utils/avatarUtils";

export default function CharactersTab() {
  const {
    characters,
    sessions,
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
  } = useUnifiedApp(state => ({
    characters: state.characters,
    sessions: state.sessions,
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
  }));
  const { t } = useTranslation();
  const [selectedDetailChar, setSelectedDetailChar] = React.useState<CharacterCard | null>(null);
  const [actionMenuChar, setActionMenuChar] = React.useState<CharacterCard | null>(null);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  return (
    <div className="px-4 pb-4 pt-1.5 space-y-4 relative min-h-screen">
      <div className="flex min-h-12 items-center justify-between border-b border-border pb-2">
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground flex items-center gap-1.5">
            Mobile Tavern{" "}
            <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">
              Lite
            </span>
          </h1>
          <p className="text-[10px] text-muted-foreground font-light mt-0.5">
            {t("characters_tab.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScannerOpen(true)}
            className="bg-card active:scale-[0.98] text-muted-foreground p-2 rounded-lg border border-border transition flex items-center justify-center"
            title={t("characters_tab.scan_title")}
          >
            <FolderSearch className="w-4 h-4" />
          </button>
          <label className="cursor-pointer bg-card active:scale-[0.98] text-muted-foreground p-2 rounded-lg border border-border transition flex items-center justify-center" title={t("characters_tab.import_title")}>
            <FileUp className="w-4 h-4" />
            <input
              type="file"
              onChange={handleImportCardFile}
              accept=".png,.webp,.json,.txt,.bin,image/png,image/webp,application/json"
              className="hidden"
            />
          </label>
          <button
            onClick={handleAddNewCharacter}
            className="bg-primary hover:bg-primary text-primary-foreground p-2 rounded-lg transition-all font-medium flex items-center justify-center"
            title={t("characters_tab.create_title")}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List Cards */}
      <div className="space-y-3">
      {/* characters array is pre-sorted by last chat time via useMemo in LegacyAppContextProvider */}
        {characters.map((char, index) => {
          const charSessList = sessions.filter(
            (s) => s.characterId === char.id,
          );
          const isActive = activeCharId === char.id;

          return (
            <div
              key={char.id}
              onClick={() => selectCharacter(char.id)}
              style={{ "--card-index": index } as React.CSSProperties}
              className={`bg-card rounded-2xl border border-border/40 spring-press-effect animate-card-fade-in p-3.5 relative cursor-pointer flex items-center gap-3.5 min-h-[112px] h-auto select-none ${
                isActive
                  ? "border-primary/50 ring-1 ring-primary/20 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_30px_-8px_rgba(255,255,255,0.06)] bg-primary/[0.03]"
                  : "shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_10px_25px_-5px_rgba(255,255,255,0.03)] hover:-translate-y-0.5"
              }`}
            >
              {/* Character Avatar Grid */}
              <div 
                className={`w-16 h-20 rounded-2xl overflow-hidden border border-border/40 flex items-center justify-center relative shrink-0 ${
                  char.avatar ? "bg-muted/30" : getAvatarGradientClass(char.name)
                }`}
              >
                {char.avatar ? (
                  <img
                    src={char.avatar}
                    alt={char.name}
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
                    <h2 className="font-bold text-foreground text-sm truncate flex-1">
                      {char.name}
                    </h2>
                    <div
                      className="flex gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => setActionMenuChar(char)}
                        className="text-muted-foreground hover:text-primary p-1 bg-muted/40 rounded-lg hover:bg-muted transition active:scale-95 flex items-center justify-center"
                        title={t("characters_tab.more_title")}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1.5 leading-relaxed font-light">
                    {char.description || char.personality || t("characters_tab.no_description")}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-1.5">
                  <span className="text-[10px] bg-primary/10 border border-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1 font-medium select-none">
                    <RefreshCw className="w-2.5 h-2.5" /> {t("characters_tab.branch_count", { count: String(charSessList.length) })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}


        {characters.length === 0 && (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl flex flex-col items-center justify-center">
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
        <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
          {/* 半透明遮罩层 */}
          <div
            className="absolute inset-0 bg-black/55 transition-opacity"
            onClick={() => setActionMenuChar(null)}
          />
          {/* 抽屉面板 */}
          <div
            style={{ paddingBottom: `calc(16px + env(safe-area-inset-bottom))` }}
            className="w-full max-w-lg bg-background border-t border-border/50 rounded-t-3xl shadow-2xl z-10 flex flex-col transition-transform animate-in slide-in-from-bottom duration-200"
          >
            {/* 顶部手柄装饰 */}
            <div className="flex justify-center py-2.5">
              <div
                className="w-12 h-1.5 bg-muted-foreground/30 rounded-full cursor-pointer"
                onClick={() => setActionMenuChar(null)}
              />
            </div>

            {/* 角色基本信息预览 */}
            <div className="px-5 pb-4 border-b border-border/40 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border border-border ${
                actionMenuChar.avatar ? "bg-muted" : getAvatarGradientClass(actionMenuChar.name)
              }`}>
                {actionMenuChar.avatar ? (
                  <img src={actionMenuChar.avatar} alt={actionMenuChar.name} className="w-full h-full object-cover" />
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
                onClick={() => {
                  setSelectedDetailChar(actionMenuChar);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Bot className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.view_profile")}</span>
              </button>

              <button
                onClick={() => {
                  handleEditCharacter(actionMenuChar);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Edit2 className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.edit_character")}</span>
              </button>

              <button
                onClick={() => {
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
                  if (ok) handleExportCharacterJSON(actionMenuChar);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span>{t("characters_tab.export_json")}</span>
              </button>

              <button
                onClick={() => {
                  handleExportCharacterPNG(actionMenuChar);
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
          </div>
        </div>
      )}

      <LocalCardScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
