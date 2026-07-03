import React, { useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import CharacterDetailDrawer from "../components/CharacterDetailDrawer";
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
} from "lucide-react";

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
  const [selectedDetailChar, setSelectedDetailChar] = React.useState<CharacterCard | null>(null);
  const [actionMenuChar, setActionMenuChar] = React.useState<CharacterCard | null>(null);
  return (
    <div className="px-4 pb-4 pt-1.5 space-y-4 relative min-h-screen">
      <div className="flex items-center justify-between border-b border-border pb-3 pt-1">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5">
            Mobile Tavern{" "}
            <span className="text-[11px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">
              Lite
            </span>
          </h1>
          <p className="text-xs text-muted-foreground font-light mt-0.5">
            面向移动端的轻量角色扮演前端
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer bg-card active:scale-[0.98] text-muted-foreground p-2 rounded-lg border border-border transition flex items-center justify-center title='导入SillyTavern角色卡'">
            <FileUp className="w-4 h-4" />
            <input
              type="file"
              onChange={handleImportCardFile}
              accept=".png,.json"
              className="hidden"
            />
          </label>
          <button
            onClick={handleAddNewCharacter}
            className="bg-primary hover:bg-primary text-primary-foreground p-2 rounded-lg transition-all font-medium flex items-center justify-center"
            title="手动创造新角色卡"
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
                className="w-16 h-20 rounded-2xl overflow-hidden bg-muted/30 border border-border/40 flex items-center justify-center text-muted-foreground relative shrink-0"
              >
                {char.avatar ? (
                  <img
                    src={char.avatar}
                    alt={char.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-serif text-primary font-bold">
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
                        title="更多操作"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1.5 leading-relaxed font-light">
                    {char.description || char.personality || "暂无信息说明..."}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-1.5">
                  <span className="text-[10px] bg-primary/10 border border-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1 font-medium select-none">
                    <RefreshCw className="w-2.5 h-2.5" /> {charSessList.length} 分支
                  </span>
                </div>
              </div>
            </div>
          );
        })}


        {characters.length === 0 && (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl flex flex-col items-center justify-center">
            <Bot className="w-10 h-10 stroke-[1.2] mb-2 text-muted-foreground" />
            <p className="text-sm">本地数据库空空如也</p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
              上传现有的 SillyTavern 兼容 PNG
              写实角色卡或点击右上角按钮手工创造一个新世界。
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
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-muted flex items-center justify-center shrink-0 border border-border">
                {actionMenuChar.avatar ? (
                  <img src={actionMenuChar.avatar} alt={actionMenuChar.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-primary">{actionMenuChar.name[0]}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-foreground truncate">{actionMenuChar.name}</h3>
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">选择你对该角色的操作</p>
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
                <span>查看人设档案</span>
              </button>

              <button
                onClick={() => {
                  handleEditCharacter(actionMenuChar);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <Edit2 className="w-4 h-4 text-muted-foreground" />
                <span>编辑角色人设</span>
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
                <span>进入世界书子模块</span>
              </button>

              <button
                onClick={async () => {
                  setActionMenuChar(null);
                  const ok = await showCustomConfirm("确定导出 JSON 角色卡？");
                  if (ok) handleExportCharacterJSON(actionMenuChar);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span>导出为 JSON 文件</span>
              </button>

              <button
                onClick={() => {
                  handleExportCharacterPNG(actionMenuChar);
                  setActionMenuChar(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted active:bg-muted/70 rounded-xl transition text-left"
              >
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <span>导出为 SillyTavern PNG 角色卡</span>
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
                <span>删除该角色卡</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
