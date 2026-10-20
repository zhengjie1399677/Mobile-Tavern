import { useEffect, useRef, useState } from "react";

/**
 * 数字输入草稿：输入过程中不钳制，失焦/回车时再解析并夹到 [min, max]。
 * 避免“全选后输入 500”被逐键夹成 1000/10000 之类的错误。
 */
export function DraftNumberInput({
  value,
  min,
  max,
  step,
  integer = false,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onCommit: (value: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (focused) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setDraft(String(value));
    }
  }, [value, focused]);

  const commit = () => {
    const parsed = integer ? Number.parseInt(draft, 10) : Number.parseFloat(draft);
    const next = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : lastValueRef.current;
    lastValueRef.current = next;
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <input
      aria-label={ariaLabel}
      type="number"
      min={min}
      max={max}
      step={step}
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
