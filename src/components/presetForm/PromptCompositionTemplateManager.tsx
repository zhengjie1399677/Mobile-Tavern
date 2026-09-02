import { BookOpen, ChevronDown, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { useState } from "react";
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
  const [expanded, setExpanded] = useState(true);
  const userTemplates = templates.filter((template) => template.source === "user");
  const sillyTavernTemplates = templates.filter((template) => template.source === "external");
  const scenePresets = listPromptCompositionScenePresets();

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs transition-all duration-150 shadow-xs">
      <PromptComposerButton
        onClick={() => setExpanded((prev) => !prev)}
        variant="ghost"
        className="flex w-full items-center justify-between p-3 text-left font-bold text-xs hover:bg-muted/20 rounded-2xl transition-colors h-auto min-h-0"
      >
        <span className="inline-flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
            <BookOpen className="h-3.5 w-3.5" />
          </span>
          <span>{t("prompt_composer.template_library")}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
            {templates.length + scenePresets.length + 1}
          </span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </PromptComposerButton>

      {expanded && (
        <div className="space-y-3.5 px-3 pb-3.5 pt-1 border-t border-border/50">
          {/* 保存当前编排按钮 */}
          <PromptComposerButton
            onClick={onSave}
            className="min-h-10 w-full gap-2 border-primary/30 bg-primary/10 text-primary font-bold hover:bg-primary/20 hover:border-primary/40 shadow-xs"
          >
            <Save className="h-4 w-4" />
            <span>{t("prompt_composer.save_current_template", { name: composition.name })}</span>
          </PromptComposerButton>

          {/* 基础示例 */}
          <TemplateGroup
            title={t("prompt_composer.template_group_basic")}
            empty=""
            icon={<Sparkles className="h-3.5 w-3.5 text-amber-500" />}
            templates={[]}
            basicLabel={t("prompt_composer.basic_example")}
            onLoadBasic={onLoadBasic}
            onLoad={onLoad}
            onDelete={onDelete}
          />

          {/* 官方场景预设 */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              <span>{t("prompt_composer.template_group_scenes")}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {scenePresets.map((preset) => {
                const name = t(`prompt_composer.scene_${preset.id}`);
                return (
                  <PromptComposerButton
                    key={preset.id}
                    onClick={() => onLoadScene(preset, name)}
                    className="h-auto min-h-12 w-full flex-col items-start gap-1 rounded-xl border border-border/60 bg-background/80 p-2.5 text-left hover:border-primary/40 hover:bg-muted/30 shadow-2xs transition-all"
                  >
                    <span className="text-xs font-bold text-foreground">{name}</span>
                    <span className="whitespace-normal text-[9.5px] font-normal leading-relaxed text-muted-foreground">
                      {t(`prompt_composer.scene_${preset.id}_description`)}
                    </span>
                  </PromptComposerButton>
                );
              })}
            </div>
          </section>

          {/* 用户自定义模板 */}
          <TemplateGroup
            title={t("prompt_composer.template_group_user")}
            empty={t("prompt_composer.template_group_empty")}
            icon={<Save className="h-3.5 w-3.5 text-emerald-500" />}
            templates={userTemplates}
            onLoad={onLoad}
            onDelete={onDelete}
          />

          {/* SillyTavern 兼容导入 */}
          <TemplateGroup
            title={t("prompt_composer.template_group_sillytavern")}
            empty={t("prompt_composer.template_group_empty")}
            icon={<Upload className="h-3.5 w-3.5 text-sky-500" />}
            templates={sillyTavernTemplates}
            onLoad={onLoad}
            onDelete={onDelete}
          />
        </div>
      )}
    </section>
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
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>

      {basicLabel && onLoadBasic && (
        <PromptComposerButton
          onClick={onLoadBasic}
          className="h-auto min-h-9 w-full justify-start rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-left font-semibold hover:border-primary/40 hover:bg-muted/30 shadow-2xs"
        >
          {basicLabel}
        </PromptComposerButton>
      )}

      {templates.map((template) => (
        <div
          key={template.id}
          className="flex items-center rounded-xl border border-border/60 bg-background/80 shadow-2xs hover:border-border transition-colors overflow-hidden"
        >
          <PromptComposerButton
            variant="ghost"
            onClick={() => onLoad(template)}
            className="h-auto min-h-10 min-w-0 flex-1 justify-start rounded-none border-0 px-3 py-2 text-left shadow-none active:scale-100"
          >
            <span className="block truncate text-xs font-semibold text-foreground">{template.name}</span>
            <span className="text-[9px] text-muted-foreground">{new Date(template.updatedAt).toLocaleString()}</span>
          </PromptComposerButton>
          <PromptComposerButton
            variant="ghost"
            size="icon-lg"
            onClick={() => onDelete(template)}
            className="rounded-none border-0 border-l border-border/50 px-3 text-destructive shadow-none hover:bg-destructive/10"
            aria-label={`Delete ${template.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </PromptComposerButton>
        </div>
      ))}

      {!basicLabel && templates.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 p-2.5 text-center text-[10px] text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}
