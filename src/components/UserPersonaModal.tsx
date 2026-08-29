import React, { useState } from "react";
import { User, Plus, Edit2, Trash2, Check, X, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useTranslation } from "../contexts/LanguageContext";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { compressImage } from "../utils/imageCompressor";
import type { UserPersona, UserSettings } from "../types";

interface UserPersonaModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  updateSettings: (updater: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  switchUserPersona: (id: string) => void;
  showCustomConfirm: (message: string) => Promise<boolean>;
  showCustomAlert: (message: string, title?: string) => Promise<void> | void;
  hasActiveConversation: boolean;
}

export default function UserPersonaModal({
  isOpen,
  onClose,
  settings,
  updateSettings,
  switchUserPersona,
  showCustomConfirm,
  showCustomAlert,
  hasActiveConversation,
}: UserPersonaModalProps) {
  const { t } = useTranslation();
  const [editingPersona, setEditingPersona] = useState<Partial<UserPersona> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useMobileBackHandler(isOpen, () => {
    if (editingPersona || isCreating) {
      setEditingPersona(null);
      setIsCreating(false);
      return true;
    }
    onClose();
    return true;
  }, 920);

  if (!isOpen) return null;

  const personas = settings.userPersonas || [];
  const activeId = settings.activePersonaId || personas[0]?.id || "default-persona";

  const handleSelectPersona = async (personaId: string) => {
    if (personaId === activeId) {
      onClose();
      return;
    }
    if (hasActiveConversation) {
      const confirmed = await showCustomConfirm(
        t("persona.switch_mid_chat_warning", {
          defaultValue: "当前会话已产生对话记录。中途切换玩家人设可能导致模型对玩家身份、语气及上下文产生错乱，是否确认切换？",
        }),
      );
      if (!confirmed) return;
    }
    switchUserPersona(personaId);
    onClose();
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setEditingPersona({
      id: "persona-" + Math.random().toString(36).substring(2, 9),
      name: "",
      description: "",
      avatar: "",
    });
  };

  const handleStartEdit = (persona: UserPersona) => {
    setIsCreating(false);
    setEditingPersona({ ...persona });
  };

  const handleDelete = async (persona: UserPersona) => {
    if (personas.length <= 1) {
      void showCustomAlert(t("persona.at_least_one", { defaultValue: "必须保留至少一个玩家人设！" }));
      return;
    }
    const confirmed = await showCustomConfirm(
      t("persona.delete_confirm", {
        name: persona.name || t("persona.unnamed"),
        defaultValue: `确定删除人设 "${persona.name || t("persona.unnamed")}" 吗？`,
      }),
    );
    if (!confirmed) return;

    updateSettings((prev) => {
      const prevPersonas = prev.userPersonas || [];
      const nextPersonas = prevPersonas.filter((p) => p.id !== persona.id);
      const isDeletingActive = prev.activePersonaId === persona.id;
      const nextActive = isDeletingActive ? nextPersonas[0] : null;

      return {
        ...prev,
        userPersonas: nextPersonas,
        ...(nextActive ? {
          activePersonaId: nextActive.id,
          userName: nextActive.name || "",
          userAvatar: nextActive.avatar || "",
          userInfo: nextActive.description || "",
        } : {}),
      };
    });
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPersona) return;
    const name = editingPersona.name?.trim();
    if (!name) {
      void showCustomAlert(t("persona.name_required", { defaultValue: "请输入玩家人设名称！" }));
      return;
    }

    const payload: UserPersona = {
      id: editingPersona.id || ("persona-" + Math.random().toString(36).substring(2, 9)),
      name,
      description: editingPersona.description?.trim() || "",
      avatar: editingPersona.avatar || "",
    };

    if (isCreating) {
      updateSettings((prev) => {
        const prevPersonas = prev.userPersonas || [];
        return {
          ...prev,
          userPersonas: [...prevPersonas, payload],
          activePersonaId: payload.id,
          userName: payload.name,
          userAvatar: payload.avatar || "",
          userInfo: payload.description || "",
        };
      });
    } else {
      updateSettings((prev) => {
        const prevPersonas = prev.userPersonas || [];
        const nextPersonas = prevPersonas.map((p) => (p.id === payload.id ? payload : p));
        const isCurrentActive = prev.activePersonaId === payload.id;
        return {
          ...prev,
          userPersonas: nextPersonas,
          ...(isCurrentActive ? {
            userName: payload.name,
            userAvatar: payload.avatar || "",
            userInfo: payload.description || "",
          } : {}),
        };
      });
    }

    setEditingPersona(null);
    setIsCreating(false);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="z-[999] flex h-[min(88dvh,600px)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden border-border bg-background p-0 text-foreground shadow-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-3">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <User className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm font-semibold">
                  {editingPersona
                    ? isCreating
                      ? t("persona.modal_create_title")
                      : t("persona.modal_edit_title")
                    : t("persona.modal_title")}
                </DialogTitle>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {editingPersona
                    ? t("persona.modal_edit_subtitle")
                    : t("persona.modal_subtitle")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3">
          {editingPersona ? (
            <form onSubmit={handleSaveForm} className="space-y-3.5 animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                  {editingPersona.avatar ? (
                    <img src={editingPersona.avatar} alt="Avatar" loading="lazy" decoding="async" className="size-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground">
                      {editingPersona.name?.[0] || "?"}
                    </span>
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {t("persona.avatar_label")}
                  </label>
                  <div className="flex gap-2">
                    <label className="flex h-7 items-center gap-1 rounded-lg border border-border bg-muted/50 px-2.5 text-xs text-foreground cursor-pointer hover:bg-muted">
                      <Upload className="size-3" />
                      <span>{t("persona.upload_avatar")}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 5 * 1024 * 1024) {
                              void showCustomAlert(t("persona.avatar_too_large"));
                              return;
                            }
                            compressImage(file, 256, 256, 0.8, "image/png")
                              .then((base64) => {
                                setEditingPersona((prev) => prev ? { ...prev, avatar: base64 } : prev);
                              })
                              .catch((err: unknown) => {
                                void showCustomAlert(t("persona.avatar_failed") + String(err));
                              });
                          }
                        }}
                      />
                    </label>
                    {editingPersona.avatar && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => setEditingPersona((prev) => prev ? { ...prev, avatar: "" } : prev)}
                      >
                        {t("persona.remove_avatar")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">
                  {t("persona.name_label")} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingPersona.name || ""}
                  onChange={(e) => setEditingPersona((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                  placeholder={t("persona.name_placeholder_new")}
                  className="h-8.5 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">
                  {t("persona.desc_label")}
                </label>
                <textarea
                  rows={4}
                  value={editingPersona.description || ""}
                  onChange={(e) => setEditingPersona((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                  placeholder={t("persona.desc_placeholder_new")}
                  className="w-full resize-y rounded-lg border border-border bg-input p-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/20 min-h-[96px]"
                />
                <p className="text-[10px] text-muted-foreground">{t("persona.desc_hint")}</p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setEditingPersona(null);
                    setIsCreating(false);
                  }}
                >
                  {t("dialog.cancel")}
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs">
                  {t("persona.save_apply")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("persona.existing_count", { count: personas.length })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 text-primary border-primary/30 bg-primary/5 hover:bg-primary/10"
                  onClick={handleStartCreate}
                >
                  <Plus className="size-3" />
                  <span>{t("persona.create_new")}</span>
                </Button>
              </div>

              <div className="space-y-1.5">
                {personas.map((persona) => {
                  const isActive = persona.id === activeId;
                  return (
                    <article
                      key={persona.id}
                      className={`flex items-start gap-2.5 rounded-xl border p-2.5 transition-colors ${
                        isActive
                          ? "border-primary/50 bg-primary/[0.06]"
                          : "border-border/70 bg-card hover:border-border"
                      }`}
                    >
                      <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted">
                        {persona.avatar ? (
                          <img src={persona.avatar} alt={persona.name} loading="lazy" decoding="async" className="size-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-muted-foreground">
                            {persona.name?.[0] || "?"}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <strong className="truncate text-xs font-semibold text-foreground">
                            {persona.name || t("persona.unnamed")}
                          </strong>
                          {isActive && (
                            <span className="flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                              <Check className="size-2.5" />
                              {t("persona.active_badge")}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground leading-relaxed">
                          {persona.description || t("persona.no_description")}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 self-center">
                        {!isActive && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => void handleSelectPersona(persona.id)}
                          >
                            {t("persona.use")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          title={t("persona.edit_action")}
                          onClick={() => handleStartEdit(persona)}
                        >
                          <Edit2 className="size-3.5" />
                        </Button>
                        {personas.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                            title={t("persona.delete_action")}
                            onClick={() => void handleDelete(persona)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
