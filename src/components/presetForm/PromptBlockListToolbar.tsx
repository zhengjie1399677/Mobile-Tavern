import { CheckCheck, Power, PowerOff, Search, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  PromptComposerButton,
  PromptComposerInput,
  PromptComposerSelect,
} from "./PromptComposerControls";
import type { PromptBlockGroupMode, PromptBlockSortMode } from "./promptBlockListTools";

export default function PromptBlockListToolbar(props: {
  query: string;
  onQueryChange: (value: string) => void;
  groupMode: PromptBlockGroupMode;
  onGroupModeChange: (value: PromptBlockGroupMode) => void;
  sortMode: PromptBlockSortMode;
  onSortModeChange: (value: PromptBlockSortMode) => void;
  visibleCount: number;
  totalCount: number;
  visibleTokens: number;
  selectedCount: number;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const hasSelection = props.selectedCount > 0;
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-muted/20 p-2">
      <div className="space-y-1.5 sm:grid sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:gap-1.5 sm:space-y-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <PromptComposerInput
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder={t("prompt_composer.list_search")}
            aria-label={t("prompt_composer.list_search")}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:contents">
          <PromptComposerSelect
            value={props.groupMode}
            onValueChange={(value) => props.onGroupModeChange(value as PromptBlockGroupMode)}
            ariaLabel={t("prompt_composer.list_group")}
            className="h-8"
            options={[
              { value: "none", label: t("prompt_composer.group_none") },
              { value: "role", label: t("prompt_composer.group_role") },
              { value: "source", label: t("prompt_composer.group_source") },
              { value: "placement", label: t("prompt_composer.group_placement") },
            ]}
          />
          <PromptComposerSelect
            value={props.sortMode}
            onValueChange={(value) => props.onSortModeChange(value as PromptBlockSortMode)}
            ariaLabel={t("prompt_composer.list_sort")}
            className="h-8"
            options={[
              { value: "order", label: t("prompt_composer.sort_order") },
              { value: "tokens", label: t("prompt_composer.sort_tokens") },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
        <span>{t("prompt_composer.list_stats", {
          visible: String(props.visibleCount),
          total: String(props.totalCount),
          tokens: String(props.visibleTokens),
        })}</span>
        <span className="ml-auto">{t("prompt_composer.selected_count", { count: String(props.selectedCount) })}</span>
        <ToolButton onClick={props.onSelectVisible} label={t("prompt_composer.select_visible")} icon={<CheckCheck className="h-3 w-3" />} />
        <ToolButton onClick={props.onClearSelection} disabled={!hasSelection} label={t("prompt_composer.clear_selection")} icon={<X className="h-3 w-3" />} />
        <ToolButton onClick={() => props.onSetEnabled(true)} disabled={!hasSelection} label={t("prompt_composer.batch_enable")} icon={<Power className="h-3 w-3" />} />
        <ToolButton onClick={() => props.onSetEnabled(false)} disabled={!hasSelection} label={t("prompt_composer.batch_disable")} icon={<PowerOff className="h-3 w-3" />} />
        <ToolButton onClick={props.onDelete} disabled={!hasSelection} destructive label={t("prompt_composer.batch_delete")} icon={<Trash2 className="h-3 w-3" />} />
      </div>
    </section>
  );
}

function ToolButton(props: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <PromptComposerButton
      onClick={props.onClick}
      disabled={props.disabled}
      className={`min-h-7 gap-1 px-2 py-1 text-[9px] ${props.destructive ? "text-destructive" : ""}`}
    >
      {props.icon}{props.label}
    </PromptComposerButton>
  );
}
