import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Sparkles } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useTranslation } from "../../contexts/LanguageContext";
import { analyzeThemeCss, type ThemeCssDiagnostic } from "../../domain/themes/themeCssDiagnostics";
import { insertThemeCssSnippet } from "../../domain/themes/themeCssSnippets";
import { detectCriticalNavigationHiding } from "../../utils/themePackage";
import { CssDiagnosticsPanel } from "./CssDiagnosticsPanel";
import { CssSnippetLibrary } from "./CssSnippetLibrary";
import { ThemeCssAiPromptModal } from "./ThemeCssAiPromptModal";
import { MiniResourceManagerModal } from "./MiniResourceManagerModal";
import { ThemeStudioResourceView } from "./ThemeStudioResourceView";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export function CssSection({
  value,
  onChange,
  resourcePort,
  showCustomAlert,
  showCustomConfirm,
}: {
  value: string;
  onChange: (value: string) => void;
  resourcePort?: ThemeStudioResourcePort;
  showCustomAlert?: (msg: string, title?: string) => Promise<void>;
  showCustomConfirm?: (msg: string, title?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [resourceManagerOpen, setResourceManagerOpen] = useState(false);
  const [resourceVersion, setResourceVersion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">自定义 CSS</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            预览和保存都会执行安全清洗与主题作用域。远程 URL、@import、脚本、固定定位和 Safe Area 覆盖不可用。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-1.5 border-primary/30 hover:border-primary/60 hover:bg-primary/10 transition-colors"
            onClick={() => setAiPromptOpen(true)}
            title="查看并复制专为 AI 设计的提示词与规范"
          >
            <Sparkles className="size-3.5 text-amber-400" />
            <span>AI 编写提示词</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-1.5 hover:bg-muted/70 transition-colors"
            onClick={() => setResourceManagerOpen(true)}
            title="管理本地图片与音视频，生成 5 位短 ID"
          >
            <FolderOpen className="size-3.5 text-primary" />
            <span>素材库 (弹窗)</span>
          </Button>
        </div>
      </div>
      <div className="flex min-h-[22rem] flex-1 overflow-hidden rounded-xl border border-border bg-input">
        <pre
          ref={gutterRef}
          aria-hidden="true"
          className="select-none overflow-hidden border-r border-border bg-muted/60 px-2 py-2.5 text-right font-mono text-xs leading-5 text-muted-foreground"
        >
          {Array.from({ length: Math.max(1, value.split("\n").length) }, (_, index) => index + 1).join("\n")}
        </pre>
        <textarea
          ref={textareaRef}
          aria-label="自定义 CSS 文档"
          value={value}
          onChange={event => onChange(event.target.value)}
          onScroll={event => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          wrap="off"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="min-h-[22rem] flex-1 resize-none overflow-auto whitespace-pre bg-transparent p-2.5 font-mono text-xs leading-5 text-foreground outline-none"
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

      {/* 本地素材管理系统：支持直接在此处管理、导入、复制短 ID 及插入 CSS */}
      <ThemeStudioResourceView
        resourcePort={resourcePort}
        onInsertCode={handleInsertSnippet}
        showCustomAlert={showCustomAlert}
        showCustomConfirm={showCustomConfirm}
        embedded={true}
        refreshToken={resourceVersion}
      />

      <CssDiagnosticsPanel css={value} diagnostics={diagnostics} onSelect={handleDiagnosticSelect} />
      <CssSnippetLibrary onInsert={handleInsertSnippet} />

      <ThemeCssAiPromptModal
        isOpen={aiPromptOpen}
        onClose={() => setAiPromptOpen(false)}
      />
      <MiniResourceManagerModal
        isOpen={resourceManagerOpen}
        onClose={() => setResourceManagerOpen(false)}
        resourcePort={resourcePort}
        onInsertCode={handleInsertSnippet}
        onResourcesChanged={() => setResourceVersion(version => version + 1)}
        showCustomAlert={showCustomAlert}
        showCustomConfirm={showCustomConfirm}
      />
    </div>
  );
}
