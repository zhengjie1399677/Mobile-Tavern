import { Layers3, Plus, Save, Trash2 } from "lucide-react";
import type { PromptComposition } from "../../domain/prompt-composition";
import { createPromptSceneProfile } from "../../domain/prompt-composition";
import { useTranslation } from "../../contexts/LanguageContext";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { PromptComposerButton, PromptComposerSelect } from "./PromptComposerControls";

export default function PromptSceneProfileManager({
  composition,
  onChange,
}: {
  composition: PromptComposition;
  onChange: (composition: PromptComposition) => void;
}) {
  const { t } = useTranslation();
  const { activeSession, setSessionViews, updateSessionMetadata, showCustomPrompt, showCustomConfirm, showCustomAlert } = useUnifiedApp((state) => ({
    activeSession: state.activeSession,
    setSessionViews: state.setSessionViews,
    updateSessionMetadata: state.updateSessionMetadata,
    showCustomPrompt: state.showCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
  }));
  const profiles = composition.sceneProfiles ?? [];
  const activeId = profiles.some((profile) => profile.id === activeSession?.activePromptSceneProfileId)
    ? activeSession?.activePromptSceneProfileId ?? ""
    : "";
  const activeProfile = profiles.find((profile) => profile.id === activeId);

  const selectProfile = async (profileId: string) => {
    if (!activeSession) return;
    const updated = { ...activeSession, activePromptSceneProfileId: profileId || undefined };
    try {
      await updateSessionMetadata(updated.id, { activePromptSceneProfileId: updated.activePromptSceneProfileId });
      setSessionViews((previous) => previous.map((session) => session.id === updated.id ? updated : session));
    } catch {
      await showCustomAlert(t("prompt_composer.scene_save_failed"));
    }
  };

  const createProfile = async () => {
    const name = await showCustomPrompt(t("prompt_composer.scene_name_prompt"), "", t("prompt_composer.scene_create"));
    if (!name?.trim()) return;
    const profile = createPromptSceneProfile(name, composition);
    onChange({ ...composition, sceneProfiles: [...profiles, profile] });
  };

  const overwriteProfile = () => {
    if (!activeProfile) return;
    onChange({
      ...composition,
      sceneProfiles: profiles.map((profile) => profile.id === activeProfile.id
        ? createPromptSceneProfile(profile.name, composition, profile.id)
        : profile),
    });
  };

  const deleteProfile = async () => {
    if (!activeProfile || !await showCustomConfirm(t("prompt_composer.scene_delete_confirm", { name: activeProfile.name }))) return;
    onChange({ ...composition, sceneProfiles: profiles.filter((profile) => profile.id !== activeProfile.id) });
    if (activeSession?.activePromptSceneProfileId === activeProfile.id) await selectProfile("");
  };

  return (
    <section className="space-y-2 rounded-xl bg-background/50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold">
        <Layers3 className="h-4 w-4 text-primary" />
        {t("prompt_composer.scene_profiles")}
        <span className="ml-auto text-[9px] font-normal text-muted-foreground">
          {activeSession ? t("prompt_composer.scene_session_scope") : t("prompt_composer.scene_requires_session")}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <PromptComposerSelect
          value={activeId}
          onValueChange={(value) => void selectProfile(value)}
          disabled={!activeSession}
          ariaLabel={t("prompt_composer.scene_profiles")}
          options={[
            { value: "", label: t("prompt_composer.scene_base") },
            ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
          ]}
        />
        <PromptComposerButton onClick={() => void createProfile()} className="gap-1 px-2.5">
          <Plus className="h-3.5 w-3.5" />{t("prompt_composer.scene_create")}
        </PromptComposerButton>
      </div>
      {activeProfile && (
        <div className="grid grid-cols-2 gap-2">
          <PromptComposerButton onClick={overwriteProfile} className="gap-1 px-2.5">
            <Save className="h-3.5 w-3.5" />{t("prompt_composer.scene_overwrite")}
          </PromptComposerButton>
          <PromptComposerButton onClick={() => void deleteProfile()} className="gap-1 px-2.5 text-destructive">
            <Trash2 className="h-3.5 w-3.5" />{t("prompt_composer.scene_delete")}
          </PromptComposerButton>
        </div>
      )}
    </section>
  );
}
