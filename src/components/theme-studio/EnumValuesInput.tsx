import { useEffect, useRef, useState } from "react";

/**
 * 枚举值列表输入草稿：保留用户正在输入的逗号/空格，失焦时再拆分提交。
 * 直接受控重序列化会在输入逗号时把空 token 吃掉，导致无法追加新值。
 */
export function EnumValuesInput({
  values,
  onChange,
  className,
  ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(values.join(", "));
  const [focused, setFocused] = useState(false);
  const lastCommittedRef = useRef(values.join(", "));

  useEffect(() => {
    if (focused) return;
    const next = values.join(", ");
    lastCommittedRef.current = next;
    setDraft(next);
  }, [values, focused]);

  const commit = () => {
    const parsed = [...new Set(draft.split(",").map(item => item.trim()).filter(Boolean))];
    if (parsed.length === 0) {
      setDraft(lastCommittedRef.current);
      return;
    }
    lastCommittedRef.current = parsed.join(", ");
    setDraft(lastCommittedRef.current);
    onChange(parsed);
  };

  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={className}
    />
  );
}
