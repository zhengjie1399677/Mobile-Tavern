import zhCN from "./zh-CN";
import zhTW from "./zh-TW";
import en from "./en";
import ja from "./ja";
import ru from "./ru";
import es from "./es";
import ko from "./ko";
import ptBR from "./pt-BR";

export const TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh-CN": zhCN as Record<string, string>,
  "zh-TW": zhTW as Record<string, string>,
  "en": en as Record<string, string>,
  "ja": ja as Record<string, string>,
  "ru": ru as Record<string, string>,
  "es": es as Record<string, string>,
  "ko": ko as Record<string, string>,
  "pt-BR": ptBR as Record<string, string>,
};
