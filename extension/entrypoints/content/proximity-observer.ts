/** Images within about 1.5 screens above or below the viewport are prepared in advance. */
export const PREFETCH_ROOT_MARGIN = '150% 0px';

/** A change in how close an element is to the screen. */
export interface ProximityChange {
  /** Inside the prefetch area (screen plus margin). */
  near?: boolean;
  /** On screen. */
  visible?: boolean;
}

export type ProximityCallback = (element: Element, change: ProximityChange) => void;

/** Watches elements; replaceable in tests, where nothing scrolls. */
export interface ProximityObserver {
  observe(element: Element): void;
  unobserve(element: Element): void;
  disconnect(): void;
}

/** Proximity observer built on two `IntersectionObserver`s (prefetch area and screen). */
export function createProximityObserver(callback: ProximityCallback): ProximityObserver {
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        callback(entry.target, { near: entry.isIntersecting });
      }
    },
    { rootMargin: PREFETCH_ROOT_MARGIN },
  );
  const visibleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      callback(entry.target, { visible: entry.isIntersecting });
    }
  });
  return {
    observe(element) {
      nearObserver.observe(element);
      visibleObserver.observe(element);
    },
    unobserve(element) {
      nearObserver.unobserve(element);
      visibleObserver.unobserve(element);
    },
    disconnect() {
      nearObserver.disconnect();
      visibleObserver.disconnect();
    },
  };
}
