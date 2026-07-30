import { Clock, Cpu } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { Message } from "../../../types";

interface MessageTimestampProps {
  message: Message;
  roundNum: number;
  isUser: boolean;
}

export function MessageTimestamp({
  message,
  roundNum,
  isUser,
}: MessageTimestampProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`text-[10px] text-muted-foreground font-mono mt-1 ${
        isUser ? "text-right" : "text-left"
      } flex gap-2 ${isUser ? "justify-end" : "justify-start"} flex-wrap`}
    >
      {roundNum > 0 && (
        <span className="flex items-center gap-1 opacity-70 text-primary font-medium">
          {t("message_bubble.round_label", { roundNum: String(roundNum) })}
        </span>
      )}
      <span className={roundNum > 0 ? "border-l border-border pl-2" : ""}>
        {new Date(message.timestamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {message.generationTime !== undefined && (
        <span className="flex items-center gap-1 opacity-70 border-l border-border pl-2">
          <Clock className="w-2.5 h-2.5" />
          {message.generationTime.toFixed(1)}s
        </span>
      )}
      {message.tokenCount !== undefined && message.tokenCount > 0 && (
        <span
          className="flex items-center gap-1 opacity-70 border-l border-border pl-2"
          title={`提示词Tokens: ${message.promptTokenCount || 0}`}
        >
          <Cpu className="w-2.5 h-2.5" />
          {message.tokenCount} Token
        </span>
      )}
    </div>
  );
}
