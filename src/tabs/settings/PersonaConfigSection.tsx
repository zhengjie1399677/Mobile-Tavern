import { Plus, Trash2, UserCheck } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { compressImage } from "../../utils/imageCompressor";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";

export type PersonaConfigSectionProps = Pick<UnifiedAppContextProps,
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
  return (
    <Card className="glass-panel shadow-sm">
      <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
        <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
          <UserCheck className="w-4 h-4 text-primary" /> {t("persona.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3 px-3 pb-3 space-y-3">
        {/* 活跃人设管理栏 */}
        <div className="space-y-1 pb-2 border-b border-border/30 mb-2 animate-in fade-in duration-300">
          <label className="text-[10px] font-bold text-muted-foreground flex justify-between">
            <span>{t("persona.active")}</span>
          </label>
          <div className="flex gap-2">
            <div
              key={`${settings.activePersonaId || "default-persona"}-${settings.userName || ""}`}
              className="flex-1 min-w-0"
            >
              <Select
                value={settings.activePersonaId || "default-persona"}
                onValueChange={(val) => switchUserPersona(val)}
              >
                <SelectTrigger aria-label={t("persona.active")} className="w-full text-xs h-9 bg-input/50 font-semibold">
                  <SelectValue placeholder={t("persona.select_placeholder")}>
                    👤 {settings.userPersonas?.find(p => p.id === (settings.activePersonaId || "default-persona"))?.name || t("persona.select_placeholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(settings.userPersonas || []).map((pers) => (
                    <SelectItem
                      key={pers.id}
                      value={pers.id}
                      className="text-xs font-semibold"
                    >
                      👤 {pers.name || t("persona.unnamed")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <button
              type="button"
              onClick={addUserPersona}
              className="h-9 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
              title={t("persona.create")}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("persona.create")}</span>
            </button>

            <button
              type="button"
              onClick={() => deleteUserPersona(settings.activePersonaId || "")}
              disabled={(settings.userPersonas || []).length <= 1}
              className="h-9 px-3 bg-rose-950/15 border border-rose-900/35 hover:bg-rose-950/35 text-red-400 disabled:opacity-40 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 active:scale-95 shrink-0"
              title={t("persona.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t("persona.delete")}</span>
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground">
            {t("persona.name")}
          </label>
          <Input
            value={settings.userName}
            onChange={(e) =>
              updateSettings({ ...settings, userName: e.target.value })
            }
            className="h-9 text-xs bg-input/50"
            placeholder={t("persona.name_placeholder")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground">
            {t("persona.avatar")}
          </label>
          <div className="flex gap-2">
            <div className="w-9 h-9 rounded-full bg-muted border border-border flex-shrink-0 overflow-hidden flex items-center justify-center">
              {settings.userAvatar ? (
                <img src={settings.userAvatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCheck className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
            <Input
              value={settings.userAvatar || ""}
              onChange={(e) =>
                updateSettings({ ...settings, userAvatar: e.target.value })
              }
              className="h-9 text-xs bg-input/50 flex-1 truncate"
              placeholder={t("persona.avatar_placeholder")}
            />
            <label className="bg-muted text-muted-foreground text-xs px-3 rounded flex items-center justify-center cursor-pointer border border-border select-none shrink-0">
              {t("persona.upload")}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                      showCustomAlert("⚠️ Upload failed: Image size cannot exceed 5MB!");
                      return;
                    }
                    compressImage(file, 400, 400, 0.8, "image/png")
                      .then((base64) => {
                        updateSettings({ ...settings, userAvatar: base64 });
                      })
                      .catch((err) => {
                        showCustomAlert("⚠️ Compression failed: " + err.message);
                      });
                  }
                }}
              />
            </label>
            {settings.userAvatar && (
              <button
                type="button"
                onClick={() => updateSettings({ ...settings, userAvatar: "" })}
                className="bg-rose-950/20 text-red-400 px-3 rounded border border-rose-900/35 hover:bg-rose-950/45 text-xs transition shrink-0"
              >
                {t("persona.clear")}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground">
            {t("persona.desc")}
          </label>
          <Textarea
            value={settings.userInfo || ""}
            onChange={(e) =>
              updateSettings({ ...settings, userInfo: e.target.value })
            }
            className="text-sm bg-input/50 min-h-[140px]"
            placeholder={t("persona.desc_placeholder")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
