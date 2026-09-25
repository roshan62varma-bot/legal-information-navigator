"use client";

import * as React from "react";

/**
 * Browser state read through useSyncExternalStore: one render with the right
 * value, no setState-in-effect cascade, and a stable server snapshot so
 * hydration never mismatches.
 */

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

function subscribeRootClass(notify: () => void): () => void {
  const mo = new MutationObserver(notify);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

/** True when the dark theme class is on <html> (set by the pre-paint theme script or the toggle). */
export function useIsDark(): boolean {
  return React.useSyncExternalStore(
    subscribeRootClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

const noopSubscribe = () => () => {};

/** Feature detection that is false on the server and correct on the first client render. */
export function useBrowserSupports(test: () => boolean): boolean {
  return React.useSyncExternalStore(noopSubscribe, test, () => false);
}

/** True while `ref`'s element is on screen and the tab is visible: used to pause 3D rendering. */
export function useInView(ref: React.RefObject<Element | null>, rootMargin = "100px"): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const el = ref.current;
      if (!el) return () => {};
      const io = new IntersectionObserver(([entry]) => {
        inView.set(el, entry.isIntersecting);
        notify();
      }, { rootMargin });
      io.observe(el);
      document.addEventListener("visibilitychange", notify);
      return () => {
        io.disconnect();
        document.removeEventListener("visibilitychange", notify);
      };
    },
    [ref, rootMargin],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => document.visibilityState === "visible" && (ref.current ? inView.get(ref.current) ?? true : true),
    () => false,
  );
}

const inView = new WeakMap<Element, boolean>();
