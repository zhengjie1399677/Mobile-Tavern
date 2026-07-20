import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";

export default function DbWritingOverlay() {
  const { t } = useTranslation();
  const { isDbWriting } = useUnifiedApp((state) => ({ isDbWriting: state.isDbWriting }));

  if (!isDbWriting) return null;

  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] z-50 flex flex-col items-center justify-center animate-fadeIn">
      <div className="bg-card border border-border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-2xl max-w-[200px] text-center">
        <div className="w-8 h-8 border-2 border-[var(--accent-color)]/30 border-t-[var(--accent-color)] rounded-full animate-spin" />
        <div className="space-y-1">
          <p className="text-xs font-bold text-foreground">
            {t("db.writing_overlay")}
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            IndexedDB Transactions
          </p>
        </div>
      </div>
    </div>
  );
}
