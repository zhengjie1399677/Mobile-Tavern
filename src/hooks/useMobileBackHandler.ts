import React from "react";
import {
  registerMobileBackHandler,
  type MobileBackHandler,
} from "../infrastructure/native/mobileBackNavigation";

export function useMobileBackHandler(
  enabled: boolean,
  handler: MobileBackHandler,
  priority = 0,
): void {
  const handlerRef = React.useRef(handler);
  React.useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    if (!enabled) return;
    return registerMobileBackHandler(() => handlerRef.current(), priority);
  }, [enabled, priority]);
}
