import React, { useRef } from "react";
import { ArrowRight, User, BookOpen } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import { CharacterCard, CustomWorldbook } from "../../types";
import { getAvatarGradientClass } from "../../utils/avatarUtils";

export interface CharacterWorldbookListProps {
  characters: CharacterCard[];
  customWorldbooks: Record<string, CustomWorldbook>;
  onSelectCharacter: (char: CharacterCard) => void;
  onSelectHost: (id: string) => void;
  onToggleCharacterWorldbookGlobal: (char: CharacterCard) => Promise<void>;
  onCreateCustomWorldbook: () => Promise<void>;
  onDeleteCustomWorldbook: (id: string, name: string) => Promise<void>;
}

/**
 * 设定集名录视图。
 *
 * 渲染：
 * 1. 混合自定义独立设定集列表与角色专属列表在同一个列表中
 * 2. 独立设定集支持长按删除，界面上无任何垃圾桶等额外按钮，保持页面布局不变
 */
export default function CharacterWorldbookList({
  characters,
  customWorldbooks,
  onSelectCharacter,
  onSelectHost,
  onToggleCharacterWorldbookGlobal,
  onDeleteCustomWorldbook,
}: CharacterWorldbookListProps) {
  const { t } = useTranslation();
  const customList = Object.values(customWorldbooks || {});

  // 长按自定义 hook
  const useLongPress = (callback: () => void, ms = 600) => {
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isLongPressActive = useRef(false);

    const start = (e: React.MouseEvent | React.TouchEvent) => {
      // 避免二次触发
      isLongPressActive.current = false;
      timerRef.current = setTimeout(() => {
        isLongPressActive.current = true;
        callback();
      }, ms);
    };

    const stop = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (isLongPressActive.current) {
        // 延迟重置，确保浏览器合成的 click 事件可以被拦截
        setTimeout(() => {
          isLongPressActive.current = false;
        }, 100);
      }
    };

    return {
      onMouseDown: start,
      onMouseUp: stop,
      onMouseLeave: stop,
      onTouchStart: start,
      onTouchEnd: stop,
      isLongPressActive,
    };
  };

  return (
    <div className="space-y-4 animate-fadeIn select-none">
      {/* 角色专属设定集分区标题 */}
      <div className="flex items-center justify-between px-1 border-b border-border/40 pb-2.5">
        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-foreground/70" />
          {t("worldbook.list_header")}
        </span>
        <span className="bg-muted/20 text-foreground/80 border border-border/50 px-2 py-0.5 rounded text-[10px] font-mono font-semibold">
          {t("worldbook.list_count", { count: String(characters.length + customList.length) })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3.5">
        {/* 自定义独立设定集卡片 */}
        {customList.map((wb) => {
          const entryCount = wb.entries?.length || 0;
          
          const longPressHandlers = useLongPress(() => {
            onDeleteCustomWorldbook(wb.id, wb.name);
          }, 600);

          const handleCardClick = (e: React.MouseEvent) => {
            if (longPressHandlers.isLongPressActive.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onSelectHost(wb.id);
          };

          return (
            <div
              key={wb.id}
              onMouseDown={longPressHandlers.onMouseDown}
              onMouseUp={longPressHandlers.onMouseUp}
              onMouseLeave={longPressHandlers.onMouseLeave}
              onTouchStart={longPressHandlers.onTouchStart}
              onTouchEnd={longPressHandlers.onTouchEnd}
              onClick={handleCardClick}
              className="w-full text-left p-4 rounded-2xl border border-border/80 bg-muted/30 hover:bg-muted/60 hover:border-border transition-all duration-200 shadow-sm cursor-pointer flex items-center justify-between group active:scale-[0.99] animate-fadeIn"
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-border/50 bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-indigo-500" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate text-foreground">
                    {wb.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-light mt-0.5">
                    {t("worldbook.custom_tip")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 ml-1">
                  <span className="font-mono font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-sm bg-muted-foreground text-background">
                    {entryCount}
                  </span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-foreground/50" />
                </div>
              </div>
            </div>
          );
        })}

        {/* 角色卡片 */}
        {characters.length === 0 && customList.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-border/80 rounded-2xl bg-muted/5 text-xs text-muted-foreground">
            {t("worldbook.no_characters")}
          </div>
        ) : (
          characters.map((char) => {
            const entryCount = char.lorebookEntries?.length || 0;
            const isGlobal = !!char.isWorldbookGlobal;
            return (
              <div
                key={char.id}
                onClick={() => onSelectCharacter(char)}
                className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 shadow-sm cursor-pointer flex items-center justify-between group active:scale-[0.99] animate-fadeIn ${
                  isGlobal
                    ? "border-primary/60 bg-primary/5 hover:bg-primary/10 hover:border-primary/80"
                    : "border-border/80 bg-muted/30 hover:bg-muted/60 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full overflow-hidden border flex items-center justify-center shrink-0 ${
                      char.avatar ? (isGlobal ? "border-primary/40 bg-muted" : "border-border/50 bg-muted") : getAvatarGradientClass(char.name)
                    }`}
                  >
                    {char.avatar ? (
                      <img
                        src={char.avatar}
                        alt={char.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="text-sm font-bold">
                        {char.name[0]}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-bold truncate ${isGlobal ? "text-primary font-extrabold" : "text-foreground"}`}
                    >
                      {char.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-light mt-0.5">
                      {isGlobal
                        ? t("worldbook.char_tip_global")
                        : t("worldbook.char_tip_local")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* 角色级世界书全局开关（滑块） */}
                  <div
                    className="flex items-center gap-1.5 bg-muted/20 px-2 py-1 rounded-xl border border-border/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] text-muted-foreground font-semibold">
                      {isGlobal ? t("worldbook.switch_global") : t("worldbook.switch_local")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isGlobal}
                      onClick={() => onToggleCharacterWorldbookGlobal(char)}
                      className={`relative inline-flex h-4.5 w-8.5 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isGlobal
                          ? "bg-primary shadow-sm shadow-primary/30"
                          : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                          isGlobal ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 ml-1">
                    <span
                      className={`font-mono font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-sm ${
                        isGlobal
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted-foreground text-background"
                      }`}
                    >
                      {entryCount}
                    </span>
                    <ArrowRight
                      className={`w-4 h-4 group-hover:translate-x-1 transition-transform ${
                        isGlobal ? "text-primary/70" : "text-foreground/50"
                      }`}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
