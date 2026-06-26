import React from "react";
import { ArrowRight, User } from "lucide-react";
import { CharacterCard } from "../../types";

export interface CharacterWorldbookListProps {
  characters: CharacterCard[];
  onSelectCharacter: (char: CharacterCard) => void;
  onToggleCharacterWorldbookGlobal: (char: CharacterCard) => Promise<void>;
}

/**
 * 角色专属设定集名录视图。
 *
 * 对应原 GlobalWorldbookTab 中 `activeHostId === "list"` 分支：
 * 渲染所有角色卡片，每张卡片展示头像 / 名称 / 全局开关 / 条目计数与进入箭头。
 */
export default function CharacterWorldbookList({
  characters,
  onSelectCharacter,
  onToggleCharacterWorldbookGlobal,
}: CharacterWorldbookListProps) {
  return (
    <div className="space-y-4 animate-fadeIn select-none">
      {/* 角色专属设定集分区标题 */}
      <div className="flex items-center justify-between px-1 border-b border-border/40 pb-2.5">
        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-foreground/70" />
          👤 角色专属设定集 (Character Bound Worldbooks)
        </span>
        <span className="bg-muted/20 text-foreground/80 border border-border/50 px-2 py-0.5 rounded text-[10px] font-mono font-semibold">
          共 {characters.length} 个角色
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3.5">
        {/* 角色本地文件夹卡片 */}
        {characters.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-border/80 rounded-2xl bg-muted/5 text-xs text-muted-foreground">
            📭
            暂未检索到有效的角色宿体。请到「宿体配置」面板创建一个角色卡，即可解锁对应的专属世界书回路！
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
                      isGlobal ? "border-primary/40" : "border-border/50"
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
                      <User
                        className={`w-5 h-5 ${isGlobal ? "text-primary" : "text-foreground/70"}`}
                      />
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
                        ? "🌎 设定集已设为【全局共享】"
                        : "🔒 设定集仅限该【角色专属】"}
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
                      {isGlobal ? "🌎 全局" : "👤 专属"}
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
