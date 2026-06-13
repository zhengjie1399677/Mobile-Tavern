import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import {
  X,
  Sparkles,
  Book,
  Hash,
  ChevronUp,
  ChevronDown,
  Edit2,
  Trash2,
} from "lucide-react";
import { CharacterCard, LorebookEntry } from "../types";

export default function CharacterEditModal() {
  const {
    charModalOpen,
    setCharModalOpen,
    editingChar,
    setEditingChar,
    activeLoreTab,
    setActiveLoreTab,
    editingLoreEntry,
    setEditingLoreEntry,
    expandedLoreIds,
    setExpandedLoreIds,
    showCustomConfirm,
    showCustomAlert,
    handleSaveCharacter,
    handleSaveLoreEntry,
    setActiveTab,
  } = useContext(AppContext);

  if (!charModalOpen || !editingChar) return null;

  const renderModalLoreForm = () => {
    if (!editingLoreEntry) return null;
    return (
      <div className="space-y-3 text-xs bg-muted/20 p-3 rounded-lg border border-border">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
              标题或备注 *
            </label>
            <input
              type="text"
              placeholder="例如: 契约魔力, 隐秘圣所"
              value={editingLoreEntry.comment || ""}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  comment: e.target.value,
                })
              }
              className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
              检测关键词 (逗号隔离)
            </label>
            <input
              type="text"
              placeholder="魔力, 契约"
              value={
                editingLoreEntry.keys
                  ? Array.isArray(editingLoreEntry.keys)
                    ? editingLoreEntry.keys.join(",")
                    : (editingLoreEntry.keys as unknown as string)
                  : ""
              }
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  keys: e.target.value as any,
                })
              }
              className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
            设定集具体叙述内容 *
          </label>
          <textarea
            placeholder="描述具体的记忆事实段落..."
            rows={6}
            value={editingLoreEntry.content || ""}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                content: e.target.value,
              })
            }
            className="w-full bg-input border border-border rounded p-2 text-foreground text-sm leading-relaxed outline-none focus:border-primary resize-y font-medium"
          />
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 p-1.5 bg-muted/20 border border-border/20 rounded">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!editingLoreEntry.useRegex}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  useRegex: e.target.checked,
                })
              }
              className="accent-primary"
            />
            <span>正则</span>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!editingLoreEntry.addMemo}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  addMemo: e.target.checked,
                })
              }
              className="accent-primary"
            />
            <span>带标题备忘</span>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!editingLoreEntry.constant}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  constant: e.target.checked,
                })
              }
              className="accent-primary"
            />
            <span>常驻</span>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-rose-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!editingLoreEntry.disabled}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  disabled: e.target.checked,
                })
              }
              className="accent-primary"
            />
            <span className="font-semibold">禁用本词</span>
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          <div>
            <label className="block text-muted-foreground mb-0.5">
              位置 (Position)
            </label>
            <select
              value={editingLoreEntry.position || "after_char_def"}
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  position: e.target.value as any,
                })
              }
              className="w-full bg-input border border-border rounded p-1 text-foreground"
            >
              <option value="after_char_def">📌角色定义后</option>
              <option value="before_char_def">📌角色定义前</option>
              <option value="top">📌页面顶部</option>
              <option value="before_last_mes">💬最新消息上</option>
              <option value="in_chat">💬历史回溯中(按深度)</option>
            </select>
          </div>
          <div>
            <label className="block text-muted-foreground mb-0.5">
              深度 (Depth)
            </label>
            <input
              type="number"
              value={
                editingLoreEntry.depth !== undefined
                  ? editingLoreEntry.depth
                  : 4
              }
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  depth: Number(e.target.value),
                })
              }
              className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
            />
          </div>
          <div>
            <label className="block text-muted-foreground mb-0.5">
              权重 (Order)
            </label>
            <input
              type="number"
              value={
                editingLoreEntry.order !== undefined
                  ? editingLoreEntry.order
                  : 100
              }
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  order: Number(e.target.value),
                })
              }
              className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
            />
          </div>
          <div>
            <label className="block text-muted-foreground mb-0.5">
              概率 (%)
            </label>
            <input
              type="number"
              value={
                editingLoreEntry.probability !== undefined
                  ? editingLoreEntry.probability
                  : 100
              }
              onChange={(e) =>
                setEditingLoreEntry({
                  ...editingLoreEntry,
                  probability: Number(e.target.value),
                })
              }
              className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
            />
          </div>
        </div>

        <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
          <button
            onClick={() => setEditingLoreEntry(null)}
            type="button"
            className="bg-muted px-3 py-1 text-muted-foreground hover:text-foreground rounded text-[11px] font-semibold transition"
          >
            取消
          </button>
          <button
            onClick={handleSaveLoreEntry}
            disabled={!editingLoreEntry.content?.trim()}
            type="button"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-3.5 py-1 rounded text-[11px] transition shadow-sm"
          >
            保存此专属词
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-30 flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4">
      <div className="bg-background border-t sm:border border-border max-h-[92%] sm:max-h-[85%] w-full sm:max-w-3xl overflow-y-auto rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        {/* Modal sticky titles */}
        <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <h3 className="font-bold text-foreground text-sm">
            {editingChar.id?.startsWith("char_ST_")
              ? "编辑 SillyTavern 兼容卡片库"
              : "重新打造 AI 灵魂容器设定"}
          </h3>
          <button
            onClick={() => {
              setCharModalOpen(false);
              setEditingChar(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub content tab for Detail Config vs Attached Worldbook */}
        <div className="flex border-b border-border/80 bg-input px-3">
          <button
            onClick={() => setActiveLoreTab("detail")}
            className={`py-2 px-3 text-xs font-semibold ${
              activeLoreTab === "detail"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            1. 设子性格与基本项
          </button>
          <button
            onClick={() => setActiveLoreTab("lore")}
            className={`py-2 px-3 text-xs font-semibold ${
              activeLoreTab === "lore"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            2. 绑定专属角色世界书 ({editingChar.lorebookEntries?.length || 0})
          </button>
        </div>

        {/* Tab: main character metadata configs */}
        {activeLoreTab === "detail" && (
          <div className="p-4 space-y-3.5 text-xs">
            <div>
              <label className="block text-muted-foreground mb-1 font-bold">
                角色名称 *
              </label>
              <input
                type="text"
                placeholder="如: 艾莉娅"
                value={editingChar.name || ""}
                onChange={(e) =>
                  setEditingChar({ ...editingChar, name: e.target.value })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                形象设计 URL (支持 base64 或者在线图片)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="data:image/png;base64,... 或 http://..."
                  value={editingChar.avatar || ""}
                  onChange={(e) =>
                    setEditingChar({
                      ...editingChar,
                      avatar: e.target.value,
                    })
                  }
                  className="flex-1 bg-input border border-border rounded p-2 text-foreground outline-none text-xs truncate"
                />
                <label className="bg-muted text-muted-foreground px-3 rounded flex items-center justify-center cursor-pointer border border-border">
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setEditingChar({
                            ...editingChar,
                            avatar: reader.result as string,
                          });
                        };
                        reader.readAsDataURL(file);
                      };
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                专属聊天背景图片 (支持 base64 或在线图片，优先渲染)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="未设置（将使用全局背景或默认主题底色）"
                  value={editingChar.visualSettings?.backgroundImageUrl || ""}
                  onChange={(e) =>
                    setEditingChar({
                      ...editingChar,
                      visualSettings: {
                        ...(editingChar.visualSettings || {}),
                        backgroundImageUrl: e.target.value,
                      },
                    })
                  }
                  className="flex-1 bg-input border border-border rounded p-2 text-foreground outline-none text-xs truncate"
                />
                <label className="bg-muted text-muted-foreground px-3 rounded flex items-center justify-center cursor-pointer border border-border shrink-0 select-none">
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setEditingChar({
                            ...editingChar,
                            visualSettings: {
                              ...(editingChar.visualSettings || {}),
                              backgroundImageUrl: reader.result as string,
                            },
                          });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
                {editingChar.visualSettings?.backgroundImageUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingChar({
                        ...editingChar,
                        visualSettings: {
                          ...(editingChar.visualSettings || {}),
                          backgroundImageUrl: "",
                        },
                      })
                    }
                    className="bg-rose-950/20 text-red-400 px-3 rounded border border-rose-900/35 hover:bg-rose-950/45 transition shrink-0"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                人设描述 (Description/Persona)
              </label>
              <textarea
                placeholder="角色的详细描述、性格或背景设定..."
                rows={12}
                value={editingChar.description || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    description: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                性格词条细化 (Personality Description)
              </label>
              <input
                type="text"
                placeholder="角色的核心性格特征"
                value={editingChar.personality || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    personality: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                当前剧本故事场景设定 (Scenario Context)
              </label>
              <input
                type="text"
                placeholder="当前的故事场景 and 环境设定"
                value={editingChar.scenario || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    scenario: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                开场问候语 * (First message/Greeting)
              </label>
              <textarea
                placeholder="角色出场的第一句话"
                rows={12}
                value={editingChar.first_mes || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    first_mes: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                对白例句款式组 (Dialogue Examples)
              </label>
              <textarea
                placeholder="<user>: 你是谁？\n<char>: 我是..."
                rows={10}
                value={editingChar.mes_example || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    mes_example: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y font-mono"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-1">
                自定义系统提示约束 (System Instruction constraint Override)
              </label>
              <input
                type="text"
                placeholder="可选的系统级别提示词覆盖约定"
                value={editingChar.system_prompt || ""}
                onChange={(e) =>
                  setEditingChar({
                    ...editingChar,
                    system_prompt: e.target.value,
                  })
                }
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs hover:border-primary transition"
              />
            </div>
          </div>
        )}

        {/* Tab: Character-bound lorebook items details entry */}
        {activeLoreTab === "lore" && (
          <div className="p-4 space-y-4 text-xs animate-fadeIn">
            {/* Visual upgrade Callout Banner */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5 shadow-sm text-foreground">
              <div className="flex items-center gap-1.5 font-bold text-primary text-xs">
                <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                设定词条编辑现已全面升级
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed font-light">
                系统现已支持强大的「内联同位(In-place)编辑」。您除了可以在这里直接进行在位内联修改，也可以点击下方链接直接跳转底部的独立「世界书」选项卡进行统一多维筛选及全局对调。
              </p>
              <button
                onClick={() => {
                  setCharModalOpen(false);
                  setEditingChar(null);
                  setEditingLoreEntry(null);
                  setActiveTab("global-worldbook");
                }}
                type="button"
                className="text-[10.5px] text-primary hover:underline font-bold flex items-center gap-1 mt-1 font-mono transition"
              >
                🌐 点击直接转至底栏『世界书』· 独立多维控制台 ➡
              </button>
            </div>

            {/* Inline creator toggle button */}
            {(!editingLoreEntry ||
              !editingLoreEntry.id?.startsWith("new_temp_")) && (
              <button
                onClick={() => {
                  setEditingLoreEntry({
                    id:
                      "new_temp_" +
                      Math.random().toString(36).substring(2, 9),
                    keys: [],
                    content: "",
                    comment: "",
                    constant: false,
                    disabled: false,
                    useRegex: false,
                    addMemo: false,
                    position: "after_char_def",
                    depth: 4,
                    order: 100,
                    probability: 100,
                  });
                }}
                type="button"
                className="w-full py-2 bg-muted/20 border border-dashed border-border hover:border-primary text-muted-foreground hover:text-primary rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition"
              >
                ➕ 手工为此宿体增设一条专属设定 (Inline Creator)
              </button>
            )}

            {/* Inline Creation Card Block at the top of list */}
            {editingLoreEntry &&
              editingLoreEntry.id?.startsWith("new_temp_") && (
                <div className="bg-card p-3 rounded-lg border border-primary/40 space-y-3 shadow animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-border/60 pb-1 text-xs">
                    <span className="font-bold text-primary">
                      ✨ 为此角色快速增建专属词条
                    </span>
                    <button
                      onClick={() => setEditingLoreEntry(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {renderModalLoreForm()}
                </div>
              )}

            {/* Bound Lore Entry list */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-1">
                <span className="font-bold text-foreground flex items-center gap-1.5">
                  <Book className="w-3.5 h-3.5" /> 本角色附属专属知识词条
                  ({editingChar.lorebookEntries?.length || 0} 项)
                </span>
              </div>

              {editingChar.lorebookEntries?.map((entry, idx) => {
                const entryKey = entry.id || `lore-${idx}`;
                const isExpanded = !!expandedLoreIds[entryKey];
                const isEditingThis =
                  editingLoreEntry && editingLoreEntry.id === entry.id;
                const entryName =
                  entry.comment ||
                  (entry.keys && entry.keys.length > 0
                    ? entry.keys.slice(0, 3).join(", ")
                    : "") ||
                  "未命名设定词条";

                return (
                  <div
                    key={entryKey}
                    className={`bg-card rounded-xl border text-xs transition-all duration-200 ${
                      entry.disabled
                        ? "border-dashed border-red-900/10 bg-red-950/2 opacity-60"
                        : isEditingThis
                          ? "border-primary ring-1 ring-primary/40 shadow-sm"
                          : isExpanded
                            ? "border-primary/40 text-foreground bg-muted/5"
                            : "border-border/80 hover:border-border"
                    }`}
                  >
                    {/* Compact Header */}
                    <div
                      onClick={() =>
                        setExpandedLoreIds((prev: any) => ({
                          ...prev,
                          [entryKey]: !prev[entryKey],
                        }))
                      }
                      className="p-3 flex items-center justify-between cursor-pointer select-none gap-2"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-muted-foreground shrink-0 text-sm text-primary/70">
                          <Hash className="w-4 h-4" />
                        </span>
                        <span className="font-semibold text-foreground truncate max-w-[180px] md:max-w-[320px]">
                          {entryName}
                        </span>

                        {/* Short indicators/badges */}
                        <div className="flex items-center gap-1 shrink-0 scale-90">
                          {entry.constant && (
                            <span className="bg-emerald-950/25 text-emerald-400 border border-emerald-900/15 px-1 py-0.2 rounded text-[9px]">
                              常驻
                            </span>
                          )}
                          {entry.disabled && (
                            <span className="bg-rose-950/25 text-rose-400 border border-rose-900/15 px-1 py-0.2 rounded text-[9px]">
                              已禁用
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-muted-foreground shrink-0 text-[10px]">
                        {entry.keys &&
                          entry.keys.length > 0 &&
                          `(${entry.keys.length}个触发词)`}
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </div>

                    {/* Collapsible Content */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 pt-1 border-t border-border/40 space-y-3 animate-fadeIn text-xs">
                        {!isEditingThis ? (
                          <>
                            {/* Meta row details */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/20 p-2 rounded text-[10px] text-muted-foreground font-mono">
                              <div>
                                <span className="text-muted-foreground/75">
                                  触发词:{" "}
                                </span>
                                <span className="text-foreground font-semibold">
                                  {entry.keys && entry.keys.length > 0
                                    ? entry.keys.join(", ")
                                    : "(无)"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">
                                  位置:{" "}
                                </span>
                                <span className="text-foreground font-semibold">
                                  {entry.position === "after_char_def"
                                    ? "📌角色后"
                                    : entry.position === "before_char_def"
                                      ? "📌角色前"
                                      : "📌顶部"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">
                                  深度 / 权重:{" "}
                                </span>
                                <span className="text-foreground font-semibold">
                                  {entry.depth !== undefined ? entry.depth : 4}{" "}
                                  / {entry.order !== undefined ? entry.order : 100}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">
                                  概率 / 正则:{" "}
                                </span>
                                <span className="text-foreground font-semibold">
                                  {entry.probability !== undefined
                                    ? entry.probability
                                    : 100}
                                  % / {entry.useRegex ? "是" : "否"}
                                </span>
                              </div>
                            </div>

                            {/* Content description view */}
                            <div className="space-y-1">
                              <span className="block text-[10px] text-muted-foreground font-medium">
                                设定叙述内容 (Prompt):
                              </span>
                              <p
                                className={`font-light leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-2 border border-border/30 text-[11px] ${
                                  entry.disabled
                                    ? "line-through text-muted-foreground/50"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {entry.content}
                              </p>
                            </div>

                            {/* Bottom actions row */}
                            <div className="flex items-center justify-between pt-1 border-t border-border/30">
                              <span className="text-[10px] text-muted-foreground">
                                {entry.addMemo ? "⭐ 带标题备忘" : ""}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingLoreEntry({ ...entry });
                                  }}
                                  type="button"
                                  className="text-[11px] bg-primary/15 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/25 px-2.5 py-1 rounded-md flex items-center gap-1 font-semibold transition"
                                >
                                  <Edit2 className="w-3 h-3" /> 编辑此词 (Inline)
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const ok = await showCustomConfirm(
                                      "确定要擦除该条专属词条吗？"
                                    );
                                    if (ok) {
                                      const next = (
                                        editingChar.lorebookEntries || []
                                      ).filter((g) => g.id !== entry.id);
                                      setEditingChar({
                                        ...editingChar,
                                        lorebookEntries: next,
                                      });
                                    }
                                  }}
                                  type="button"
                                  className="text-[11px] bg-rose-950/20 hover:bg-rose-950/45 text-red-400 border border-thin border-rose-900/35 px-2.5 py-1 rounded-md flex items-center gap-1 transition"
                                >
                                  <Trash2 className="w-3 h-3" /> 擦除
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          /* Active inline editor inside local list card item */
                          <div className="space-y-3 pt-1.5 animate-fadeIn">
                            {renderModalLoreForm()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(!editingChar.lorebookEntries ||
                editingChar.lorebookEntries.length === 0) && (
                <div className="text-center py-8 text-muted-foreground border border-dashed border-border/80 rounded-xl bg-muted/5 italic">
                  本宿体卡尚未独立编制任何专属设定。请点击上方按钮进行增设，或使用底部「世界书公立频道」。
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal final saving operations */}
        <div className="p-4 pb-[calc(1rem+max(var(--safe-area-bottom),16px))] bg-input/80 border-t border-border gap-2.5 flex items-center justify-end sticky bottom-0 z-10">
          <button
            onClick={() => {
              setCharModalOpen(false);
              setEditingChar(null);
            }}
            className="bg-muted text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg text-xs font-semibold"
          >
            放弃修改
          </button>
          <button
            onClick={handleSaveCharacter}
            className="bg-primary hover:bg-primary text-primary-foreground px-5 py-2 rounded-lg text-xs font-bold"
          >
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
}
