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
      className={`chat-message-avatar flex size-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-xs font-semibold ${
        isUser
          ? "from-secondary to-muted text-foreground transition-colors duration-300"
          : "from-card to-muted text-foreground font-serif transition-colors duration-300"
      }`}
    >
      {isUser ? (
        userAvatar ? (
          <img src={userAvatar} alt="" decoding="async" className="w-full h-full object-cover" />
        ) : (
          t("message_bubble.me_avatar")
        )
      ) : characterPortrait ? (
        <img
          src={characterPortrait}
          alt=""
          decoding="async"
          className="w-full h-full object-cover animate-fadeIn"
        />
      ) : (
        activeCharacter?.name?.[0] || t("message_bubble.ai_fallback")
      )}
    </div>
  );
}
