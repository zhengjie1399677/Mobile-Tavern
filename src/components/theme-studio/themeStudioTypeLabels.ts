import { useTranslation } from "../../contexts/LanguageContext";
import type {
  ThemeInteractionAction,
  ThemeInteractionCondition,
  ThemeInteractionEventType,
  ThemeMediaSurface,
} from "../../domain/themes/themeInteractionContract";

/** 把 `media.setVolume` 一类标识转成小写 snake_case 的 i18n key 片段。 */
function keyPart(value: string): string {
  return value
    .replace(/\./g, "_")
    .replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * 可视化编辑器的类型标签。
 *
 * 下拉框的 value 仍是契约标识；这里只负责把展示文案本地化，
 * 避免中文界面里出现 boolean / media.play / theme.activate 这类原始标识。
 */
export function useThemeStudioTypeLabels() {
  const { t } = useTranslation();
  return {
    stateType: (value: "boolean" | "enum" | "counter") =>
      t(`theme_studio.type_labels.state_${value}`),
    mediaKind: (value: "audio" | "video") =>
      t(`theme_studio.type_labels.media_${value}`),
    preload: (value: "none" | "metadata" | "auto") =>
      t(`theme_studio.type_labels.preload_${value}`),
    fit: (value: "cover" | "contain" | "fill") =>
      t(`theme_studio.type_labels.fit_${value}`),
    event: (value: ThemeInteractionEventType) =>
      t(`theme_studio.type_labels.event_${keyPart(value)}`),
    condition: (value: ThemeInteractionCondition["condition"]) =>
      t(`theme_studio.type_labels.condition_${keyPart(value)}`),
    action: (value: ThemeInteractionAction["action"]) =>
      t(`theme_studio.type_labels.action_${keyPart(value)}`),
    orientation: (value: "portrait" | "landscape") =>
      t(`theme_studio.type_labels.orientation_${value}`),
    surface: (value: ThemeMediaSurface) =>
      t(`theme_studio.type_labels.surface_${keyPart(value)}`),
    booleanValue: (value: boolean) =>
      t(`theme_studio.type_labels.boolean_${value ? "true" : "false"}`),
  };
}
