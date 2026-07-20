import { BookOpen, Save, Trash2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type {
  PromptComposition,
  PromptCompositionTemplateRecord,
} from "../../domain/prompt-composition";

export default function PromptCompositionTemplateManager({
  composition,
  templates,
  onSave,
  onLoad,
  onDelete,
  onLoadBasic,
}: {
  composition: PromptComposition;
  templates: PromptCompositionTemplateRecord[];
  onSave: () => void;
  onLoad: (template: PromptCompositionTemplateRecord) => void;
  onDelete: (template: PromptCompositionTemplateRecord) => void;
  onLoadBasic: () => void;
}) {
  const { t } = useTranslation();
  const userTemplates = templates.filter((template) => template.source === "user");
  const sillyTavernTemplates = templates.filter((template) => template.source === "external");

  return (
    <details className="rounded-xl border border-border bg-background/70 p-3">
      <summary className="cursor-pointer text-xs font-bold">
        <span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />{t("prompt_composer.template_library")}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <button type="button" onClick={onSave} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary/10 text-xs font-bold text-primary">
          <Save className="h-3.5 w-3.5" />{t("prompt_composer.save_current_template", { name: composition.name })}
        </button>
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
        <button type="button" onClick={onLoadBasic} className="w-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-left text-xs font-semibold hover:border-primary/30">{basicLabel}</button>
      )}
      {templates.map((template) => (
        <div key={template.id} className="flex items-center rounded-lg border border-border bg-muted/20">
          <button type="button" onClick={() => onLoad(template)} className="min-w-0 flex-1 px-3 py-2 text-left">
            <span className="block truncate text-xs font-semibold">{template.name}</span>
            <span className="text-[9px] text-muted-foreground">{new Date(template.updatedAt).toLocaleString()}</span>
          </button>
          <button type="button" onClick={() => onDelete(template)} className="min-h-10 px-3 text-destructive" aria-label={`Delete ${template.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      {!basicLabel && templates.length === 0 && <div className="rounded-lg border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">{empty}</div>}
    </section>
  );
}
