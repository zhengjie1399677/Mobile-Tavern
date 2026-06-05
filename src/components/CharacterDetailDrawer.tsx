import React, { useState, useContext } from "react";
import { AppContext } from "../AppContext";
import { CharacterCard, LorebookEntry } from "../types";
import FormattedText from "./FormattedText";
import {
  X,
  User,
  MessageSquare,
  BookOpen,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Tag,
  Calendar,
  Sparkles,
} from "lucide-react";

interface CharacterDetailDrawerProps {
  isOpen: boolean;
  character: CharacterCard | null;
  onClose: () => void;
}

export default function CharacterDetailDrawer({
  isOpen,
  character,
  onClose,
}: CharacterDetailDrawerProps) {
  const {
    saveCharacter,
    setCharacters,
    showCustomAlert,
    settings,
  } = useContext(AppContext);

  const userName = settings?.userName || "user";

  const [activeTab, setActiveTab] = useState<"persona" | "dialogue" | "lore">("persona");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [activeGreetingIdx, setActiveGreetingIdx] = useState<number>(-1); // -1 is the default first_mes
  const [loreSearch, setLoreSearch] = useState("");
  const [expandedLoreIds, setExpandedLoreIds] = useState<Record<string, boolean>>({});

  if (!isOpen || !character) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleSetPrimaryGreeting = async (greetingText: string) => {
    try {
      const updatedChar: CharacterCard = {
        ...character,
        first_mes: greetingText,
      };
      await saveCharacter(updatedChar);
      setCharacters((prev: CharacterCard[]) =>
        prev.map((c) => (c.id === updatedChar.id ? updatedChar : c))
      );
      showCustomAlert(`开场白已更新成功！`);
    } catch (e: any) {
      showCustomAlert(`设置开场白出错: ${e.message}`);
    }
  };

  const toggleLoreExpand = (id: string) => {
    setExpandedLoreIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter lorebook entries based on search query
  const loreEntries = character.lorebookEntries || [];
  const filteredLore = loreEntries.filter((entry) => {
    if (!loreSearch.trim()) return true;
    const search = loreSearch.toLowerCase();
    const matchesContent = entry.content.toLowerCase().includes(search);
    const matchesKeys = entry.keys.some((k) => k.toLowerCase().includes(search));
    const matchesComment = (entry.comment || "").toLowerCase().includes(search);
    return matchesContent || matchesKeys || matchesComment;
  });

  const tagsList = character.tags || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
      {/* Dark overlay with backdrop blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Glassmorphic drawer sliding up */}
      <div className="w-full max-w-lg bg-background/95 backdrop-blur-lg border-t border-border/50 rounded-t-3xl shadow-2xl z-10 flex flex-col max-h-[85vh] pb-[var(--safe-area-bottom)] transition-transform animate-in slide-in-from-bottom duration-300">
        
        {/* Header decoration bar */}
        <div className="flex justify-center py-2.5">
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full cursor-pointer" onClick={onClose} />
        </div>

        {/* Drawer Header */}
        <div className="px-5 pb-4 border-b border-border/40 relative">
          <button
            onClick={onClose}
            className="absolute top-1 right-5 text-muted-foreground hover:text-foreground p-1.5 rounded-full hover:bg-muted transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex gap-4 items-center">
            {/* Avatar image or text */}
            <div className="w-16 h-16 rounded-2xl bg-muted overflow-hidden flex-shrink-0 border border-border flex items-center justify-center text-muted-foreground shadow-md">
              {character.avatar ? (
                <img
                  src={character.avatar}
                  alt={character.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl font-serif text-primary font-bold">
                  {character.name[0]}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-foreground truncate flex items-center gap-2">
                {character.name}
                {character.character_version && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono font-medium">
                    v{character.character_version}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1 font-light">
                <User className="w-3 h-3 flex-shrink-0" />
                {character.creator ? `创作者: @${character.creator}` : "系统预置 / 未知创作者"}
              </p>

              {/* Tags Horizontal Scroll */}
              {tagsList.length > 0 && (
                <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar py-0.5">
                  {tagsList.map((tag, idx) => (
                    <span
                      key={idx}
                      className="bg-primary/5 hover:bg-primary/15 text-primary text-[10px] px-2 py-0.5 rounded-full border border-primary/10 flex items-center gap-0.5 flex-shrink-0 transition-colors"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex border-b border-border/40 bg-muted/20 px-3 py-1.5 justify-around text-sm font-medium">
          <button
            onClick={() => setActiveTab("persona")}
            className={`flex items-center gap-1.5 py-1.5 px-4 rounded-lg transition-all ${
              activeTab === "persona"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            人设档案
          </button>
          <button
            onClick={() => setActiveTab("dialogue")}
            className={`flex items-center gap-1.5 py-1.5 px-4 rounded-lg transition-all ${
              activeTab === "dialogue"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            对话剧本
          </button>
          <button
            onClick={() => setActiveTab("lore")}
            className={`flex items-center gap-1.5 py-1.5 px-4 rounded-lg transition-all ${
              activeTab === "lore"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            世界设定 ({loreEntries.length})
          </button>
        </div>

        {/* Drawer Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          
          {/* TAB 1: PERSONA */}
          {activeTab === "persona" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* Personality */}
              <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-2 shadow-sm">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  性格特征 (Personality)
                </h3>
                <div className="text-sm text-foreground bg-muted/30 rounded-xl p-3 border border-border/20">
                  <FormattedText
                    text={character.personality || "暂无特别性格设定..."}
                    charName={character.name}
                    userName={userName}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-2 shadow-sm">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-primary" />
                  外貌特征与生平描述 (Description)
                </h3>
                <div className="text-sm text-foreground bg-muted/30 rounded-xl p-3 border border-border/20 max-h-64 overflow-y-auto no-scrollbar">
                  <FormattedText
                    text={character.description || "暂无背景故事说明..."}
                    charName={character.name}
                    userName={userName}
                  />
                </div>
              </div>

              {/* Creator notes */}
              {character.creator_notes && (
                <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 space-y-2 shadow-sm">
                  <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    创作者特别备忘 (Creator Notes)
                  </h3>
                  <div className="text-xs text-muted-foreground/90 bg-background/50 rounded-xl p-3 border border-primary/5 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto no-scrollbar">
                    {character.creator_notes}
                  </div>
                </div>
              )}

              {/* Scenario */}
              {character.scenario && (
                <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-2 shadow-sm">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    背景剧本与舞台场景 (Scenario)
                  </h3>
                  <div className="text-sm text-foreground bg-muted/30 rounded-xl p-3 border border-border/20 italic font-light text-[13px]">
                    <FormattedText
                      text={character.scenario}
                      charName={character.name}
                      userName={userName}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DIALOGUE & ALTERNATE GREETINGS */}
          {activeTab === "dialogue" && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Alternate Greetings Selection Slider Header */}
              {(character.alternate_greetings && character.alternate_greetings.length > 0) && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    选择开场剧情场景 ({character.alternate_greetings.length + 1} 条可选)
                  </h4>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                    {/* Default Option */}
                    <button
                      onClick={() => setActiveGreetingIdx(-1)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border flex-shrink-0 transition-all ${
                        activeGreetingIdx === -1
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-card text-muted-foreground border-border/50 hover:bg-muted"
                      }`}
                    >
                      默认开场场景
                    </button>
                    {/* Alternate Options */}
                    {character.alternate_greetings.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveGreetingIdx(idx)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border flex-shrink-0 transition-all ${
                          activeGreetingIdx === idx
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-card text-muted-foreground border-border/50 hover:bg-muted"
                        }`}
                      >
                        开场分支 {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Greeting Bubble Card */}
              {(() => {
                const currentText =
                  activeGreetingIdx === -1
                    ? character.first_mes
                    : character.alternate_greetings?.[activeGreetingIdx] || "";
                
                const isCurrentFirst = currentText === character.first_mes;

                return (
                  <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-4 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-center border-b border-border/40 pb-2">
                      <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
                        {activeGreetingIdx === -1 ? "默认剧情开端" : `备选场景分支 ${activeGreetingIdx + 1}`}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {/* Copy Button */}
                        <button
                          onClick={() => handleCopy(currentText, "greeting")}
                          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition"
                          title="复制整段文本"
                        >
                          {copiedText === "greeting" ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {/* Set Default Button */}
                        {!isCurrentFirst && (
                          <button
                            onClick={() => handleSetPrimaryGreeting(currentText)}
                            className="bg-primary/15 text-primary text-[10px] px-2 py-1 rounded hover:bg-primary hover:text-primary-foreground font-bold transition-all active:scale-[0.97]"
                            title="将此条开场白永久设为主场景首句"
                          >
                            设为主开端
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="bg-muted/40 rounded-2xl p-3 border border-border/20 text-sm max-h-80 overflow-y-auto no-scrollbar font-sans">
                      <FormattedText
                        text={currentText || "（暂无开场白设定）"}
                        charName={character.name}
                        userName={userName}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Dialogue Examples */}
              {character.mes_example && (
                <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-2 shadow-sm">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                    <span>对话参考范例 (Dialogue Examples)</span>
                    <button
                      onClick={() => handleCopy(character.mes_example || "", "examples")}
                      className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition"
                    >
                      {copiedText === "examples" ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </h3>
                  <div className="text-xs text-muted-foreground bg-muted/20 rounded-xl p-3 border border-border/20 max-h-60 overflow-y-auto no-scrollbar font-mono leading-relaxed">
                    <FormattedText
                      text={character.mes_example}
                      charName={character.name}
                      userName={userName}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: WORLD LOREBOOK */}
          {activeTab === "lore" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* Search filter in worldbook entries */}
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜索关键词、触发词或设定描述..."
                  value={loreSearch}
                  onChange={(e) => setLoreSearch(e.target.value)}
                  className="w-full text-xs pl-9 pr-4 py-2 bg-muted/40 border border-border/50 rounded-xl outline-none focus:border-primary/50 transition"
                />
                {loreSearch && (
                  <button
                    onClick={() => setLoreSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    清除
                  </button>
                )}
              </div>

              {/* Lorebook list */}
              <div className="space-y-2.5">
                {filteredLore.map((entry) => {
                  const isExpanded = !!expandedLoreIds[entry.id];
                  return (
                    <div
                      key={entry.id}
                      className={`bg-card rounded-xl border transition-all p-3 space-y-2 shadow-sm ${
                        isExpanded ? "border-primary/40 bg-muted/10" : "border-border/50 hover:bg-muted/10"
                      }`}
                    >
                      {/* Lore Header (Interactive summary bar) */}
                      <div
                        className="flex items-start justify-between gap-3 cursor-pointer select-none"
                        onClick={() => toggleLoreExpand(entry.id)}
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          {/* Keys / Trigger word badges */}
                          <div className="flex gap-1.5 flex-wrap">
                            {entry.keys.map((key, kIdx) => (
                              <span
                                key={kIdx}
                                className="bg-primary/5 text-primary text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border border-primary/10"
                              >
                                {key}
                              </span>
                            ))}
                            {entry.constant && (
                              <span className="bg-green-500/10 text-green-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-green-500/10">
                                常驻常亮
                              </span>
                            )}
                            {!entry.enabled && (
                              <span className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0.5 rounded font-medium border border-border">
                                已停用
                              </span>
                            )}
                          </div>
                          {/* Entry description/comment */}
                          <p className="text-xs text-muted-foreground truncate font-light leading-relaxed">
                            {entry.comment || entry.content.substring(0, 50) + "..."}
                          </p>
                        </div>
                        <div className="text-muted-foreground/80 flex-shrink-0 flex items-center gap-1.5 pt-0.5">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </div>

                      {/* Lore Body (Collapsible detailed drawer) */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-border/40 space-y-2.5 animate-in slide-in-from-top-1 duration-200">
                          {/* Technical placement info badges */}
                          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground bg-muted/40 p-2 rounded-lg font-mono">
                            <span className="bg-muted/80 px-1.5 py-0.5 rounded">
                              优先级: {entry.order || 100}
                            </span>
                            <span className="bg-muted/80 px-1.5 py-0.5 rounded">
                              概率: {entry.probability || 100}%
                            </span>
                            <span className="bg-muted/80 px-1.5 py-0.5 rounded">
                              深度: {entry.depth || 4}
                            </span>
                            <span className="bg-muted/80 px-1.5 py-0.5 rounded">
                              位置: {entry.position || "after_char_def"}
                            </span>
                          </div>

                          {/* The Content itself */}
                          <div className="text-xs text-foreground bg-muted/20 p-2.5 border border-border/20 rounded-lg max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans">
                            {entry.content}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredLore.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                    {loreEntries.length === 0
                      ? "该角色卡未嵌入任何内置世界设定书词条。"
                      : "未搜索到匹配此关键词的设定词条。"}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
