import { useCallback, useRef, useState } from 'react';

/**
 * Tracks an element's content width so SVG charts can size to their card.
 * Uses a callback ref so it works when the element mounts later (e.g. after
 * an empty state is replaced by the chart).
 */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}
