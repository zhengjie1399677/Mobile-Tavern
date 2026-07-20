import { useEffect, useState } from "react";

const WIDE_PROMPT_QUERY = "(min-width: 700px)";

export function useWidePromptWorkbench(): boolean {
  const [isWide, setIsWide] = useState(() => readWideState());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(WIDE_PROMPT_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  return isWide;
}

function readWideState(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_PROMPT_QUERY).matches;
}
