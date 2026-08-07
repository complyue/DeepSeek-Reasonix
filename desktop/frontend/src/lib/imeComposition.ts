// IME composition tracking for the composer's Enter-send guard. WebKit fires
// compositionend before the confirming Enter keydown (isComposing=false,
// keyCode 13), so the guard needs the last compositionend timestamp, not just
// the event flags. Native listeners are used because React's synthetic
// composition events are unreliable in embedded WebViews.
import { useLayoutEffect, useRef } from "react";

// Grace after compositionend to swallow a confirm-Enter that lands just after
// it; the real gap is a few ms, so keep it short or a deliberate quick second
// Enter (submit) gets eaten too.
export const IME_CONFIRM_GRACE_MS = 100;

export function isImeKeyEvent(
  e: { nativeEvent: { isComposing?: boolean; keyCode?: number } },
  composing: boolean,
  lastCompositionEndAt: number,
): boolean {
  const native = e.nativeEvent;
  return (
    composing ||
    native.isComposing === true ||
    native.keyCode === 229 ||
    Date.now() - lastCompositionEndAt < IME_CONFIRM_GRACE_MS
  );
}

// Callers must mount the element before `active` flips true; the effect binds
// once and does not retry.
export function useImeCompositionGuard(ref: { current: HTMLElement | null }, active: boolean) {
  const composingRef = useRef(false);
  const lastCompositionEndAt = useRef(0);
  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const start = () => {
      composingRef.current = true;
    };
    const end = () => {
      composingRef.current = false;
      lastCompositionEndAt.current = Date.now();
    };
    el.addEventListener("compositionstart", start);
    el.addEventListener("compositionend", end);
    return () => {
      el.removeEventListener("compositionstart", start);
      el.removeEventListener("compositionend", end);
    };
  }, [active]);
  return { composingRef, lastCompositionEndAt };
}
