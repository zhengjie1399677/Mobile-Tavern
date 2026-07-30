import type { CharacterCard } from "../../../types";
import { useTranslation } from "../../../contexts/LanguageContext";

interface MessageAvatarProps {
  isUser: boolean;
  userAvatar?: string;
  activePortraitUrl: string;
  activeCharacter: CharacterCard | null;
}

export function MessageAvatar({
  isUser,
  userAvatar,
  activePortraitUrl,
  activeCharacter,
}: MessageAvatarProps) {
  const { t } = useTranslation();
  const characterPortrait = activePortraitUrl || activeCharacter?.avatar || "";

  return (
    <div
      aria-hidden="true"
      className={`w-8 h-8 rounded-[11px] bg-gradient-to-br flex items-center justify-center font-bold text-xs shadow-sm border flex-shrink-0 overflow-hidden ${
        isUser
          ? "from-secondary to-muted border-border text-foreground transition-colors duration-300"
          : "from-card to-muted border-border text-foreground font-serif transition-colors duration-300"
      }`}
    >
      {isUser ? (
        userAvatar ? (
          <img src={userAvatar} alt="" className="w-full h-full object-cover" />
        ) : (
          t("message_bubble.me_avatar")
        )
      ) : characterPortrait ? (
        <img
          src={characterPortrait}
          alt=""
          className="w-full h-full object-cover animate-fadeIn"
        />
      ) : (
        activeCharacter?.name?.[0] || t("message_bubble.ai_fallback")
      )}
    </div>
  );
}
