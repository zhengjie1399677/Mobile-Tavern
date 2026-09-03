import { useState } from "react";
import { Check, Plus, Sparkles, Trash2, Upload, User, UserCheck } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { compressImage } from "../../utils/imageCompressor";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import type { UserPersona } from "../../types";

export type PersonaConfigSectionProps = Pick<
  UnifiedAppContextProps,
  | "settings"
  | "updateSettings"
  | "switchUserPersona"
  | "addUserPersona"
  | "deleteUserPersona"
  | "showCustomAlert"
>;

export default function PersonaConfigSection({
  settings,
  updateSettings,
  switchUserPersona,
  addUserPersona,
  deleteUserPersona,
  showCustomAlert,
}: PersonaConfigSectionProps) {
  const { t } = useTranslation();
  const personas: UserPersona[] = settings.userPersonas && settings.userPersonas.length > 0
    ? settings.userPersonas
    : [
        {
          id: settings.activePersonaId || "default-persona",
          name: settings.userName || "User",
          avatar: settings.userAvatar || "",
          description: settings.userInfo || "",
        },
      ];

  const activeId = settings.activePersonaId || personas[0]?.id || "default-persona";
  const [selectedId, setSelectedId] = useState<string>(activeId);

  const currentPersona = personas.find((p) => p.id === selectedId) || personas[0] || {
    id: "default-persona",
    name: "User",
    avatar: "",
    description: "",
  };

  const updateCurrentPersona = (patch: Partial<UserPersona>) => {
    updateSettings((prev) => {
      const currentPersonas = prev.userPersonas && prev.userPersonas.length > 0
        ? prev.userPersonas
        : personas;

      const nextPersonas = currentPersonas.map((item) => {
        if (item.id === currentPersona.id) {
          return { ...item, ...patch };
        }
        return item;
      });

      const isCurrentActive = currentPersona.id === (prev.activePersonaId || "default-persona");

      return {
        ...prev,
        userPersonas: nextPersonas,
        userName: isCurrentActive && patch.name !== undefined ? patch.name : prev.userName,
        userAvatar: isCurrentActive && patch.avatar !== undefined ? patch.avatar : prev.userAvatar,
        userInfo: isCurrentActive && patch.description !== undefined ? patch.description : prev.userInfo,
      };
    });
  };

  const handleSelectCard = (personaId: string) => {
    setSelectedId(personaId);
  };

  const handleSetActive = (personaId: string) => {
    switchUserPersona(personaId);
    setSelectedId(personaId);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      void showCustomAlert("图片文件超过 5MB，请选择更小的图片");
      return;
    }
    compressImage(file, 400, 400, 0.8, "image/png")
      .then((base64) => {
        updateCurrentPersona({ avatar: base64 });
      })
      .catch((err) => {
        void showCustomAlert("图片压缩失败: " + String(err));
      });
  };

  return (
    <section className="space-y-3 pb-2">
      {/* 1. 人设横向卡片流（固定高度，无论多少人物都不会将页面无限拉长） */}
      <div className="surface-card rounded-2xl p-3.5 rim-light space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCheck className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold text-foreground">我的玩家人设列表</span>
            <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
              {personas.length}
            </span>
          </div>
          <button
            type="button"
            onClick={addUserPersona}
            className="flex h-7.5 items-center gap-1 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary px-2.5 text-xs font-bold transition-all active:scale-95 shadow-2xs"
            title={t("persona.create")}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建人设</span>
          </button>
        </div>

        {/* 横向滚动人设卡片栏 */}
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar snap-x touch-pan-x">
          {personas.map((persona) => {
            const isActive = persona.id === activeId;
            const isSelected = persona.id === currentPersona.id;
            return (
              <button
                key={persona.id}
                type="button"
                onClick={() => handleSelectCard(persona.id)}
                className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all text-left shrink-0 w-44 snap-start select-none active:scale-[0.98] ${
                  isSelected
                    ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30 shadow-xs"
                    : "border-border/60 bg-background/50 hover:bg-background/80 hover:border-primary/30"
                }`}
              >
                <div className="relative h-9 w-9 rounded-full bg-muted border border-border/60 overflow-hidden shrink-0 flex items-center justify-center">
                  {persona.avatar ? (
                    <img src={persona.avatar} alt={persona.name} decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background glow-emerald" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground truncate">
                      {persona.name || "未命名"}
                    </span>
                  </div>
                  <div className="mt-0.5">
                    {isActive ? (
                      <span className="inline-flex items-center text-[11px] font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                        当前生效
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground truncate block">
                        {isSelected ? "正在编辑" : "点击编辑"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. 当前选中的人设详情与编辑 */}
      <div className="surface-card rounded-2xl p-4 rim-light space-y-3.5">
        <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-foreground truncate">
              编辑人设：{currentPersona.name || "未命名"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {currentPersona.id !== activeId ? (
              <button
                type="button"
                onClick={() => handleSetActive(currentPersona.id)}
                className="flex h-7.5 items-center gap-1 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-2.5 text-xs font-bold active:scale-95 transition-all shadow-xs"
              >
                <Check className="h-3.5 w-3.5" />
                <span>设为生效</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                生效中
              </span>
            )}
            {personas.length > 1 && (
              <button
                type="button"
                onClick={() => deleteUserPersona(currentPersona.id)}
                className="flex h-7.5 items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 px-2.5 text-xs font-semibold active:scale-95 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>删除</span>
              </button>
            )}
          </div>
        </div>

        {/* 名字输入 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground">
            {t("persona.name")}
          </label>
          <Input
            value={currentPersona.name || ""}
            onChange={(e) => updateCurrentPersona({ name: e.target.value })}
            className="h-9 text-sm rounded-xl bg-background/80 border-border/70"
            placeholder={t("persona.name_placeholder")}
          />
        </div>

        {/* 头像管理 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground">
            {t("persona.avatar")}
          </label>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-muted border border-border/80 shrink-0 overflow-hidden flex items-center justify-center shadow-xs">
              {currentPersona.avatar ? (
                <img src={currentPersona.avatar} alt="Avatar" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <User className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex gap-2">
                <label className="flex h-8.5 items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background/80 px-3 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer transition-all active:scale-95 shadow-2xs">
                  <Upload className="h-3.5 w-3.5" />
                  <span>上传图片</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                </label>
                {currentPersona.avatar && (
                  <button
                    type="button"
                    onClick={() => updateCurrentPersona({ avatar: "" })}
                    className="flex h-8.5 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-3 text-xs font-semibold hover:bg-destructive/20 active:scale-95 transition-all shadow-2xs"
                  >
                    {t("persona.clear")}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                支持 PNG / WebP / JPG，自动优化适配移动端对话气泡
              </p>
            </div>
          </div>
        </div>

        {/* 详细人设说明 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              <span>{t("persona.desc")} (System Prompt 注入)</span>
            </label>
          </div>
          <Textarea
            value={currentPersona.description || ""}
            onChange={(e) => updateCurrentPersona({ description: e.target.value })}
            className="text-sm font-sans leading-relaxed bg-background/80 border-border/70 rounded-xl min-h-[140px]"
            placeholder="描述你在与 AI 对话时的身份、性格特点、外貌或喜好。例如：&#10;'我是名探员，性格沉稳内敛，喜欢喝红茶。'"
          />
        </div>
      </div>
    </section>
  );
}
