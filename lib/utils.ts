import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Scroll `el` into view inside its nearest scrollable ancestor only (scrollIntoView also moves the window). */
export function scrollWithin(el: HTMLElement | null, block: "start" | "center" = "center"): void {
  if (!el) return;
  let parent = el.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  if (!parent) return;
  const pr = parent.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const offset = er.top - pr.top + parent.scrollTop;
  const top = block === "center" ? offset - parent.clientHeight / 2 + er.height / 2 : offset - 12;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  parent.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
}
