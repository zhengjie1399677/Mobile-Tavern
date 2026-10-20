import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import { analyzeThemeCss, type ThemeCssDiagnostic } from "../../domain/themes/themeCssDiagnostics";
import { insertThemeCssSnippet } from "../../domain/themes/themeCssSnippets";
import { detectCriticalNavigationHiding } from "../../utils/themePackage";
import { CssDiagnosticsPanel } from "./CssDiagnosticsPanel";
import { CssSnippetLibrary } from "./CssSnippetLibrary";

export function CssSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const diagnostics = useMemo(() => analyzeThemeCss(value), [value]);
  const navigationRisks = useMemo(() => detectCriticalNavigationHiding(value), [value]);

  useEffect(() => {
    const pending = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (!pending || !textarea) return;
    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
  }, [value]);

  const selectRange = (start: number, end: number): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(start, end);
  };

  const handleDiagnosticSelect = (diagnostic: ThemeCssDiagnostic): void => {
    selectRange(diagnostic.offset, diagnostic.offset + Math.max(diagnostic.length, 1));
  };

  const handleInsertSnippet = (code: string): void => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? value.length;
    const selectionEnd = textarea?.selectionEnd ?? value.length;
    const result = insertThemeCssSnippet(value, code, selectionStart, selectionEnd);
    pendingSelectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    onChange(result.css);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-2.5">
      <div>
        <h2 className="text-sm font-bold">自定义 CSS</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          预览和保存都会执行安全清洗与主题作用域。远程 URL、@import、脚本、固定定位和 Safe Area 覆盖不可用。
        </p>
      </div>
      <div className="flex min-h-[22rem] flex-1 overflow-hidden rounded-xl border border-border bg-input">
        <pre
          aria-hidden="true"
          className="select-none border-r border-border bg-muted/60 px-2 py-2.5 text-right font-mono text-xs leading-5 text-muted-foreground"
        >
          {Array.from({ length: Math.max(1, value.split("\n").length) }, (_, index) => index + 1).join("\n")}
        </pre>
        <textarea
          ref={textareaRef}
          aria-label="自定义 CSS 文档"
          value={value}
          onChange={event => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-[22rem] flex-1 resize-none bg-transparent p-2.5 font-mono text-xs leading-5 text-foreground outline-none"
          placeholder={'[data-ui="main-tab-bar"] {\n  border-color: var(--primary);\n}'}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("theme_studio.css.line_count", { count: value.split("\n").length })}
      </p>

      {navigationRisks.length > 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">
          {t("theme_studio.css.navigation_risk", { targets: navigationRisks.join("、") })}
        </p>
      )}

      <CssDiagnosticsPanel css={value} diagnostics={diagnostics} onSelect={handleDiagnosticSelect} />
      <CssSnippetLibrary onInsert={handleInsertSnippet} />
    </div>
  );
}
