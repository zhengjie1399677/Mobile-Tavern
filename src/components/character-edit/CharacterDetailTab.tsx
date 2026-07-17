import { CharacterCard } from "../../types";
import { compressImage } from "../../utils/imageCompressor";
import { useTranslation } from "../../contexts/LanguageContext";

export interface CharacterDetailTabProps {
  editingChar: Partial<CharacterCard>;
  setEditingChar: (char: Partial<CharacterCard> | null) => void;
  showCustomAlert: (msg: string) => void;
}

export default function CharacterDetailTab({
  editingChar,
  setEditingChar,
  showCustomAlert,
}: CharacterDetailTabProps) {
  const { t } = useTranslation();
  return (
    <div className="p-4 space-y-3.5 text-xs">
      <div>
        <label className="block text-muted-foreground mb-1 font-bold">
          {t("char_detail_tab.label_name")}
        </label>
        <input
          type="text"
          placeholder={t("char_detail_tab.placeholder_name")}
          value={editingChar.name || ""}
          onChange={(e) =>
            setEditingChar({ ...editingChar, name: e.target.value })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          {t("char_detail_tab.label_avatar")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t("char_detail_tab.placeholder_avatar")}
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
            {t("char_detail_tab.upload")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 5 * 1024 * 1024) {
                    showCustomAlert(t("char_detail_tab.avatar_too_large"));
                    return;
                  }
                  compressImage(file, 400, 400, 0.8, "image/png")
                    .then((base64) => {
                      setEditingChar({
                        ...editingChar,
                        avatar: base64,
                      });
                    })
                    .catch((err) => {
                      showCustomAlert(t("char_detail_tab.compress_failed", { error: err.message }));
                    });
                };
              }}
            />
          </label>
        </div>
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          {t("char_detail_tab.label_bg")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t("char_detail_tab.placeholder_bg")}
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
            {t("char_detail_tab.upload")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 5 * 1024 * 1024) {
                    showCustomAlert(t("char_detail_tab.bg_too_large"));
                    return;
                  }
                  compressImage(file, 1080, 1920, 0.75, "image/jpeg")
                    .then((base64) => {
                      setEditingChar({
                        ...editingChar,
                        visualSettings: {
                          ...(editingChar.visualSettings || {}),
                          backgroundImageUrl: base64,
                        },
                      });
                    })
                    .catch((err) => {
                      showCustomAlert(t("char_detail_tab.compress_failed", { error: err.message }));
                    });
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
              {t("char_detail_tab.clear")}
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          {t("char_detail_tab.label_asterisk")}
        </label>
        <select
          value={
            editingChar.visualSettings?.enableAsteriskFormatting === undefined
              ? "inherit"
              : editingChar.visualSettings.enableAsteriskFormatting
              ? "true"
              : "false"
          }
          onChange={(e) => {
            const val = e.target.value;
            const updatedVisualSettings = {
              ...(editingChar.visualSettings || {}),
            };
            if (val === "inherit") {
              delete updatedVisualSettings.enableAsteriskFormatting;
            } else {
              updatedVisualSettings.enableAsteriskFormatting = val === "true";
            }
            setEditingChar({
              ...editingChar,
              visualSettings: updatedVisualSettings,
            });
          }}
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        >
          <option value="inherit">{t("char_detail_tab.asterisk_inherit")}</option>
          <option value="true">{t("char_detail_tab.asterisk_enable")}</option>
          <option value="false">{t("char_detail_tab.asterisk_disable")}</option>
        </select>
      </div>


      <div>
        <label className="block text-muted-foreground mb-1">
          {t("char_detail_tab.label_description")}
        </label>
        <textarea
          placeholder={t("char_detail_tab.placeholder_description")}
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
          {t("char_detail_tab.label_personality")}
        </label>
        <input
          type="text"
          placeholder={t("char_detail_tab.placeholder_personality")}
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
          {t("char_detail_tab.label_scenario")}
        </label>
        <input
          type="text"
          placeholder={t("char_detail_tab.placeholder_scenario")}
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
          {t("char_detail_tab.label_first_mes")}
        </label>
        <textarea
          placeholder={t("char_detail_tab.placeholder_first_mes")}
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
          {t("char_detail_tab.label_mes_example")}
        </label>
        <textarea
          placeholder={t("char_detail_tab.placeholder_mes_example")}
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
          {t("char_detail_tab.label_system_prompt")}
        </label>
        <input
          type="text"
          placeholder={t("char_detail_tab.placeholder_system_prompt")}
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
  );
}
