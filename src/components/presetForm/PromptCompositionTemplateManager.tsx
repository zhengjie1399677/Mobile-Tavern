import { BookOpen, Save, Trash2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type {
  PromptComposition,
  PromptCompositionScenePreset,
  PromptCompositionTemplateRecord,
} from "../../domain/prompt-composition";
import { listPromptCompositionScenePresets } from "../../domain/prompt-composition";
import { PromptComposerButton } from "./PromptComposerControls";

export default function PromptCompositionTemplateManager({
  composition,
  templates,
  onSave,
  onLoad,
  onDelete,
  onLoadBasic,
  onLoadScene,
}: {
  composition: PromptComposition;
  templates: PromptCompositionTemplateRecord[];
  onSave: () => void;
  onLoad: (template: PromptCompositionTemplateRecord) => void;
  onDelete: (template: PromptCompositionTemplateRecord) => void;
  onLoadBasic: () => void;
  onLoadScene: (preset: PromptCompositionScenePreset, localizedName: string) => void;
}) {
  const { t } = useTranslation();
  const userTemplates = templates.filter((template) => template.source === "user");
  const sillyTavernTemplates = templates.filter((template) => template.source === "external");
  const scenePresets = listPromptCompositionScenePresets();

  return (
    <details className="rounded-xl border border-border bg-background/70 p-3">
      <summary className="cursor-pointer text-xs font-bold">
        <span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />{t("prompt_composer.template_library")}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <PromptComposerButton onClick={onSave} className="min-h-10 w-full gap-2 border-primary/25 bg-primary/10 text-primary hover:bg-primary/15">
          <Save className="h-3.5 w-3.5" />{t("prompt_composer.save_current_template", { name: composition.name })}
        </PromptComposerButton>
        <TemplateGroup
          title={t("prompt_composer.template_group_basic")}
          empty=""
          icon={<BookOpen className="h-3.5 w-3.5" />}
          templates={[]}
          basicLabel={t("prompt_composer.basic_example")}
          onLoadBasic={onLoadBasic}
          onLoad={onLoad}
          onDelete={onDelete}
        />
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />{t("prompt_composer.template_group_scenes")}
          </div>
          {scenePresets.map((preset) => {
            const name = t(`prompt_composer.scene_${preset.id}`);
            return (
              <PromptComposerButton
                key={preset.id}
                onClick={() => onLoadScene(preset, name)}
                className="h-auto min-h-11 w-full flex-col items-start gap-0.5 bg-muted/20 px-3 py-2 text-left hover:border-primary/30"
              >
                <span className="text-xs font-semibold">{name}</span>
                <span className="whitespace-normal text-[9px] font-normal leading-relaxed text-muted-foreground">
                  {t(`prompt_composer.scene_${preset.id}_description`)}
                </span>
              </PromptComposerButton>
            );
          })}
        </section>
        <TemplateGroup
          title={t("prompt_composer.template_group_user")}
          empty={t("prompt_composer.template_group_empty")}
          icon={<Save className="h-3.5 w-3.5" />}
          templates={userTemplates}
          onLoad={onLoad}
          onDelete={onDelete}
        />
        <TemplateGroup
          title={t("prompt_composer.template_group_sillytavern")}
          empty={t("prompt_composer.template_group_empty")}
          icon={<Upload className="h-3.5 w-3.5" />}
          templates={sillyTavernTemplates}
          onLoad={onLoad}
          onDelete={onDelete}
        />
      </div>
    </details>
  );
}

function TemplateGroup({
  title,
  empty,
  icon,
  templates,
  basicLabel,
  onLoadBasic,
  onLoad,
  onDelete,
}: {
  title: string;
  empty: string;
  icon: ReactNode;
  templates: PromptCompositionTemplateRecord[];
  basicLabel?: string;
  onLoadBasic?: () => void;
  onLoad: (template: PromptCompositionTemplateRecord) => void;
  onDelete: (template: PromptCompositionTemplateRecord) => void;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{icon}{title}</div>
      {basicLabel && onLoadBasic && (
        <PromptComposerButton onClick={onLoadBasic} className="h-auto min-h-9 w-full justify-start bg-muted/20 px-3 py-2 text-left hover:border-primary/30">{basicLabel}</PromptComposerButton>
      )}
      {templates.map((template) => (
        <div key={template.id} className="flex items-center rounded-lg border border-border bg-muted/20">
          <PromptComposerButton variant="ghost" onClick={() => onLoad(template)} className="h-auto min-h-10 min-w-0 flex-1 justify-start rounded-none border-0 px-3 py-2 text-left shadow-none active:scale-100">
            <span className="block truncate text-xs font-semibold">{template.name}</span>
            <span className="text-[9px] text-muted-foreground">{new Date(template.updatedAt).toLocaleString()}</span>
          </PromptComposerButton>
          <PromptComposerButton variant="ghost" size="icon-lg" onClick={() => onDelete(template)} className="rounded-none border-0 px-3 text-destructive shadow-none hover:bg-destructive/10" aria-label={`Delete ${template.name}`}><Trash2 className="h-3.5 w-3.5" /></PromptComposerButton>
        </div>
      ))}
      {!basicLabel && templates.length === 0 && <div className="rounded-lg border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">{empty}</div>}
    </section>
  );
}
