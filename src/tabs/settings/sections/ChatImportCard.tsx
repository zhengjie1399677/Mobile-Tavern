import { MessageSquare, Upload } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../../components/ui/card";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export interface ChatImportCardProps extends Pick<UnifiedAppContextProps, "handleImportSillyChatHistory"> {}

export default function ChatImportCard({
  handleImportSillyChatHistory,
}: ChatImportCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="bg-card border-border shadow-sm mt-2">
      <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
        <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
          <MessageSquare className="w-4 h-4 text-primary" /> {t("chat_import.title")}
        </CardTitle>
        <CardDescription className="text-[10px] mt-0.5">
          {t("chat_import.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 px-3 pb-3 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t("chat_import.description")}
          <br />
          <span className="text-primary font-medium">{t("chat_import.tip_label")}</span>
          {t("chat_import.help_text")}
        </p>
        <div className="flex font-bold text-xs">
          <label className="w-full bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-emerald-500" /> {t("chat_import.upload_btn")}
            <input
              type="file"
              onChange={handleImportSillyChatHistory}
              accept=".json,.jsonl,.txt,.bin,application/json,text/plain"
              className="hidden"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
