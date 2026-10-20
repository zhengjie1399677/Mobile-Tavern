import { useTranslation } from "../../contexts/LanguageContext";

export function InteractionRawJsonEditor({
  value,
  onChange,
  errors,
}: {
  value: string;
  onChange: (value: string) => void;
  errors: string[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {t("theme_studio.interactions.json_hint")}
      </p>
      <textarea
        aria-label={t("theme_studio.interactions.json_label")}
        value={value}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-[20rem] w-full resize-y rounded-xl border border-border bg-input p-3 font-mono text-xs leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring"
      />
      {errors.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
          {errors.map((error, index) => (
            <li key={index} className="text-[10px] leading-relaxed text-destructive">{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
