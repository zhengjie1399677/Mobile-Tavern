import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useTranslation } from "../../contexts/LanguageContext";
import { THEME_CSS_SNIPPETS } from "../../domain/themes/themeCssSnippets";

export function CssSnippetLibrary({ onInsert }: { onInsert: (code: string) => void }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(current => !current)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span>
          <span className="block text-xs font-bold">{t("theme_studio.snippets.title")}</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">{t("theme_studio.snippets.hint")}</span>
        </span>
        {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
          {THEME_CSS_SNIPPETS.map(snippet => (
            <div key={snippet.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold">{t(`theme_studio.snippets.${snippet.id}.title`)}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {t(`theme_studio.snippets.${snippet.id}.description`)}
                </p>
              </div>
              <pre className="max-h-24 overflow-auto rounded bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground custom-scrollbar">
                {snippet.code}
              </pre>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 self-start px-2.5 text-[11px]"
                onClick={() => onInsert(snippet.code)}
              >
                {t("theme_studio.snippets.insert")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
