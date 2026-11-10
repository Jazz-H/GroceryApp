import { useEffect, useRef, useState } from 'react';

export const PULL_TRIGGER = 70;

/** Is the nearest scrollable ancestor of this element scrolled to the top? */
function atTop(target: EventTarget | null): boolean {
  let el = target instanceof Element ? (target as HTMLElement) : null;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      return el.scrollTop <= 0;
    }
    el = el.parentElement;
  }
  return true;
}

/**
 * Pull down from the top of the page to refresh. Installed apps don't get the browser's
 * built-in gesture, so this provides one. Returns how far the indicator should be pulled.
 */
export function usePullToRefresh(onRefresh: () => void): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    let startY = 0;
    let active = false;
    let distance = 0;

    const onStart = (e: TouchEvent) => {
      active = false;
      if (e.touches.length !== 1) return;
      const t = e.target as Element | null;
      // Not while typing, picking from a list, or inside a bottom sheet.
      if (t?.closest('input, textarea, select, .sheet, .sheet-backdrop')) return;
      if (!atTop(e.target)) return;
      startY = e.touches[0].clientY;
      distance = 0;
      active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      distance = e.touches[0].clientY - startY;
      setPull(distance > 0 ? Math.min(distance * 0.5, 110) : 0);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (distance * 0.5 >= PULL_TRIGGER) {
        setRefreshing(true);
        setPull(PULL_TRIGGER);
        refreshRef.current();
      } else setPull(0);
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return { pull, refreshing };
}
