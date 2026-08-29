import { useTranslation } from "../../../../contexts/LanguageContext";
import type { ViewportSize } from "../../utils";
import type {
  DiagnosticSection,
  SystemReportSectionProps,
} from "./types";

interface SystemReportPanelProps {
  sections: DiagnosticSection[];
  diagnoseLog: string;
  isChecking: boolean;
  isTauri: boolean;
  deviceModel: string;
  viewportSize: ViewportSize;
  safeAreas: SystemReportSectionProps["safeAreas"];
  onRunSelfCheck: () => Promise<void>;
  onCopyFullReport: () => void;
  onCopyErrorsOnly: () => void;
  onCopySection: (section: DiagnosticSection) => void;
  onCopyDiagnoseLog: () => void;
  onClearDiagnoseLog: () => void;
}

export function SystemReportPanel({
  sections,
  diagnoseLog,
  isChecking,
  isTauri,
  deviceModel,
  viewportSize,
  safeAreas,
  onRunSelfCheck,
  onCopyFullReport,
  onCopyErrorsOnly,
  onCopySection,
  onCopyDiagnoseLog,
  onClearDiagnoseLog,
}: SystemReportPanelProps) {
  const { t } = useTranslation();
  const errorCount = sections.filter((section) => section.hasError).length;
  const warningCount = sections.filter((section) => section.hasWarning).length;

  return (
    <div className="mt-6 text-center space-y-1 pb-4 select-text font-mono text-[9px] text-muted-foreground">
      <div className="font-bold text-[10px] text-muted-foreground mb-1 select-none flex flex-wrap items-center justify-center gap-2">
        🛠️ {t("report.title")}
        <button
          onClick={onCopyFullReport}
          className="text-[9px] text-primary hover:underline font-normal cursor-pointer select-none px-2 py-0.5 border border-primary/20 rounded bg-primary/5 hover:bg-primary/10 active:scale-95 transition-all"
        >
          {t("report.copy")}
        </button>
        <button
          onClick={() => void onRunSelfCheck()}
          disabled={isChecking}
          className="text-[9px] text-emerald-400 hover:underline font-normal cursor-pointer select-none px-2 py-0.5 border border-emerald-400/30 rounded bg-emerald-400/10 hover:bg-emerald-400/15 active:scale-95 transition-all disabled:opacity-55"
        >
          {isChecking ? t("report.checking") : t("report.check_start")}
        </button>
        {sections.length > 0 && (errorCount > 0 || warningCount > 0) && (
          <button
            onClick={onCopyErrorsOnly}
            className="text-[9px] text-amber-400 hover:underline font-normal cursor-pointer select-none px-2 py-0.5 border border-amber-400/30 rounded bg-amber-400/10 hover:bg-amber-400/15 active:scale-95 transition-all"
          >
            {t("report.copy_errors")}
          </button>
        )}
      </div>

      {sections.length > 0 && (
        <p className={`opacity-80 font-bold ${errorCount > 0 ? "text-red-400" : warningCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
          {t("report.errors_summary", {
            errors: String(errorCount),
            warnings: String(warningCount),
          })}
        </p>
      )}

      <p className="opacity-55">
        {t("report.version")}: v{__APP_VERSION__} • {t("report.platform")}:{" "}
        {isTauri ? t("report.android_client") : t("report.web_client")}
      </p>
      <p className="opacity-55">
        {t("report.device")}: {deviceModel}
      </p>
      {typeof window !== "undefined" && (
        <p className="opacity-55">
          {t("report.viewport")}: {viewportSize.w}x{viewportSize.h} (visual:{" "}
          {Math.round(viewportSize.vW)}x{Math.round(viewportSize.vH)})
        </p>
      )}
      {safeAreas && (
        <p className="opacity-55">
          {t("report.safe_area")}: {safeAreas.top}dp | {safeAreas.bottom}dp
        </p>
      )}

      {sections.length > 0 && (
        <div className="mt-3 space-y-2 text-left touch-pan-y">
          {sections.map((section) => (
            <div
              key={section.id}
              className={`p-2 bg-zinc-950/90 border rounded-lg text-zinc-300 font-sans tracking-wide max-w-full shadow-inner leading-relaxed touch-pan-y ${
                section.hasError
                  ? "border-red-500/40"
                  : section.hasWarning
                    ? "border-amber-500/40"
                    : "border-zinc-800"
              }`}
            >
              <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1 text-[8px] font-bold select-none">
                <span className={section.hasError ? "text-red-400" : section.hasWarning ? "text-amber-400" : "text-zinc-500"}>
                  {section.hasError ? "⛔ " : section.hasWarning ? "⚠️ " : "✓ "}
                  {section.title}
                </span>
                <button
                  onClick={() => onCopySection(section)}
                  className="text-primary hover:underline text-[8px]"
                >
                  [{t("report.copy_section")}]
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300 touch-pan-y">
                {section.lines.filter((line) => !line.startsWith("\n[")).join("\n")}
              </pre>
            </div>
          ))}
        </div>
      )}

      {diagnoseLog && sections.length === 0 && (
        <div className="mt-3 text-left p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-lg text-zinc-300 font-sans tracking-wide max-w-full shadow-inner leading-relaxed touch-pan-y">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1.5 text-[8px] font-bold text-zinc-500 select-none">
            <span>🛠️ {t("report.title")} DEBUGLOG</span>
            <div className="flex gap-2">
              <button
                onClick={onCopyDiagnoseLog}
                className="text-primary hover:underline text-[8px]"
              >
                [{t("report.copy")}]
              </button>
              <button
                onClick={onClearDiagnoseLog}
                className="text-zinc-500 hover:text-zinc-400 text-[8px]"
              >
                [clear]
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300 touch-pan-y">
            {diagnoseLog}
          </pre>
        </div>
      )}
    </div>
  );
}
