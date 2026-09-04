import React, { useState } from "react";
import {
  Check,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  User,
  UserCheck,
  X,
  Smile,
  Shirt,
  MessageCircle,
  Briefcase,
} from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import { Card } from "../../../components/ui/card";
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

  const insertScaffolding = (prefix: string) => {
    const prevDesc = currentPersona.description || "";
    const separator = prevDesc.trim().length > 0 ? "\n" : "";
    updateCurrentPersona({ description: `${prevDesc}${separator}${prefix}` });
  };

  const isActive = currentPersona.id === activeId;
  const descriptionLength = (currentPersona.description || "").length;

  return (
    <div className="space-y-3 pb-3">
      {/* 1. 人设列表卡片流与切换区 */}
      <Card className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-md shadow-xs p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-2xs">
              <UserCheck className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-[13px] font-bold text-foreground">我的玩家人设</span>
              <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                {personas.length}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={addUserPersona}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary px-3 text-xs font-bold transition-all active:scale-95 shadow-2xs"
            title={t("persona.create")}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建人设</span>
          </button>
        </div>

        {/* 横向滚动人设卡片栏 */}
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 custom-scrollbar snap-x touch-pan-x">
          {personas.map((persona) => {
            const isPersonaActive = persona.id === activeId;
            const isPersonaSelected = persona.id === currentPersona.id;
            return (
              <button
                key={persona.id}
                type="button"
                onClick={() => handleSelectCard(persona.id)}
                className={`flex flex-col gap-2 p-3 rounded-2xl border transition-all text-left shrink-0 w-44 sm:w-48 snap-start select-none active:scale-[0.98] ${
                  isPersonaActive
                    ? "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30 shadow-xs"
                    : isPersonaSelected
                      ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30 shadow-xs"
                      : "border-border/70 bg-card/60 hover:bg-card/90 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="relative h-10 w-10 rounded-xl bg-muted border border-border/80 overflow-hidden shrink-0 flex items-center justify-center shadow-2xs">
                    {persona.avatar ? (
                      <img src={persona.avatar} alt={persona.name} decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  {isPersonaActive ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      当前生效
                    </span>
                  ) : isPersonaSelected ? (
                    <span className="inline-flex items-center rounded-md bg-primary/20 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      编辑中
                    </span>
                  ) : (
                    <span className="text-[9px] text-muted-foreground/80">点击切换</span>
                  )}
                </div>

                <div className="min-w-0 w-full">
                  <span className="text-xs font-bold text-foreground truncate block">
                    {persona.name || "未命名"}
                  </span>
                  <p className="text-[10px] text-muted-foreground/80 truncate mt-0.5 leading-tight">
                    {persona.description?.trim() || "未填写人设描述"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* 2. 当前选中的人设详情与编辑工作台 */}
      <Card className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-md shadow-xs p-4 space-y-4">
        {/* 编辑卡片顶部标题与状态控制 */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary shrink-0">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <span className="text-xs sm:text-[13px] font-bold text-foreground truncate block">
                编辑人设：{currentPersona.name || "未命名"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isActive ? (
              <button
                type="button"
                onClick={() => handleSetActive(currentPersona.id)}
                className="flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 text-xs font-bold active:scale-95 transition-all shadow-xs"
              >
                <Check className="h-3.5 w-3.5" />
                <span>设为生效</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 shrink-0 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                <Check className="h-3.5 w-3.5" />
                生效中
              </span>
            )}

            {personas.length > 1 && (
              <button
                type="button"
                onClick={() => deleteUserPersona(currentPersona.id)}
                className="flex h-8 items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 px-2.5 text-xs font-semibold active:scale-95 transition-all shadow-2xs"
                title="删除此人设"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>删除</span>
              </button>
            )}
          </div>
        </div>

        {/* 基础信息：头像与名称 */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-foreground flex items-center justify-between">
              <span>玩家头像 (Avatar)</span>
              <span className="text-[10px] text-muted-foreground font-normal">支持 PNG / WebP / JPG 自动优化</span>
            </label>
            <div className="flex items-center gap-3.5 bg-background/50 border border-border/60 rounded-2xl p-2.5">
              <div className="relative h-14 w-14 rounded-2xl bg-muted border border-border/80 shrink-0 overflow-hidden flex items-center justify-center shadow-xs">
                {currentPersona.avatar ? (
                  <img src={currentPersona.avatar} alt="Avatar" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-7 w-7 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <label className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary px-3 text-xs font-bold cursor-pointer transition-all active:scale-95 shadow-2xs">
                    <Upload className="h-3.5 w-3.5" />
                    <span>上传头像</span>
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
                      className="flex h-8 items-center justify-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-2.5 text-xs font-semibold hover:bg-destructive/20 active:scale-95 transition-all shadow-2xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>移除</span>
                    </button>
                  )}
                </div>
                <p className="text-[10.5px] text-muted-foreground leading-tight">
                  用于气泡会话、群聊模式与多智能体交互的玩家标识头像
                </p>
              </div>
            </div>
          </div>

          {/* 名字输入 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-foreground flex items-center justify-between">
              <span>玩家名称 (User Name)</span>
              <span className="text-[10px] text-muted-foreground font-normal">用于系统推断及 {"{{user}}"} 占位符代称</span>
            </label>
            <Input
              value={currentPersona.name || ""}
              onChange={(e) => updateCurrentPersona({ name: e.target.value })}
              className="h-9 text-xs font-semibold rounded-xl bg-background/80 border-border/70 shadow-2xs focus-visible:ring-primary/30"
              placeholder={t("persona.name_placeholder")}
            />
          </div>
        </div>

        {/* 详细人设说明 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>玩家设定与世界观描述 (System Prompt 注入)</span>
            </label>
            <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
              {descriptionLength} 字符
            </span>
          </div>

          {/* 快捷脚手架标签 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground font-semibold">快速模版:</span>
            <button
              type="button"
              onClick={() => insertScaffolding("【身份背景】\n")}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 hover:bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition active:scale-95 shadow-2xs"
            >
              <Briefcase className="h-3 w-3 text-primary" />
              <span>身份背景</span>
            </button>
            <button
              type="button"
              onClick={() => insertScaffolding("【性格习惯】\n")}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 hover:bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition active:scale-95 shadow-2xs"
            >
              <Smile className="h-3 w-3 text-amber-500" />
              <span>性格习惯</span>
            </button>
            <button
              type="button"
              onClick={() => insertScaffolding("【外貌衣着】\n")}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 hover:bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition active:scale-95 shadow-2xs"
            >
              <Shirt className="h-3 w-3 text-sky-500" />
              <span>外貌衣着</span>
            </button>
            <button
              type="button"
              onClick={() => insertScaffolding("【对话口吻】\n")}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 hover:bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition active:scale-95 shadow-2xs"
            >
              <MessageCircle className="h-3 w-3 text-emerald-500" />
              <span>对话口吻</span>
            </button>
          </div>

          <Textarea
            value={currentPersona.description || ""}
            onChange={(e) => updateCurrentPersona({ description: e.target.value })}
            className="text-xs font-sans leading-relaxed bg-background/80 border-border/70 rounded-xl min-h-[160px] p-3 shadow-2xs focus-visible:ring-primary/30"
            placeholder="描述你在与 AI 对话时的身份、性格特点、外貌或喜好。该段信息将作为玩家资料注入 System Prompt，协助模型建立代入感。&#10;例如：&#10;我是名资深探员，性格沉稳内敛，喜欢喝红茶；言简意赅，洞察敏锐。"
          />
        </div>
      </Card>
    </div>
  );
}
