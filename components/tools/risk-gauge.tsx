"use client";

import * as React from "react";

/** Semicircular 0-100 gauge. Colour bands match the severity palette; the number is always printed, so colour is not the only signal. */
export function RiskGauge({ score, label, pending = false }: { score: number | undefined; label: string; pending?: boolean }) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const angle = -90 + (s / 100) * 180;
  const band = s >= 70 ? "Very one-sided" : s >= 45 ? "Leans against you" : s >= 20 ? "Some concerns" : "Mostly balanced";
  const arc = (from: number, to: number) => {
    const p = (v: number) => {
      const a = ((-180 + (v / 100) * 180) * Math.PI) / 180;
      return `${60 + 48 * Math.cos(a)} ${60 + 48 * Math.sin(a)}`;
    };
    return `M ${p(from)} A 48 48 0 0 1 ${p(to)}`;
  };
  return (
    <figure className="flex items-center gap-4" aria-label={`${label}: ${Math.round(s)} out of 100, ${band}`}>
      <svg viewBox="0 0 120 70" className="w-32 shrink-0" aria-hidden>
        <path d={arc(0, 20)} className="stroke-sev-low-fg/60" strokeWidth="10" fill="none" />
        <path d={arc(20.5, 45)} className="stroke-sev-medium-fg/60" strokeWidth="10" fill="none" />
        <path d={arc(45.5, 70)} className="stroke-sev-high-fg/70" strokeWidth="10" fill="none" />
        <path d={arc(70.5, 100)} className="stroke-sev-critical-fg/80" strokeWidth="10" fill="none" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "60px 60px", transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }} opacity={pending ? 0.35 : 1}>
          <line x1="60" y1="60" x2="60" y2="20" className="stroke-ink" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="60" cy="60" r="4.5" className="fill-ink" />
      </svg>
      <figcaption>
        <span className="block font-serif text-3xl tabular-nums leading-none text-ink">
          {score === undefined ? "–" : Math.round(s)}
          <span className="text-base text-ink-soft">/100</span>
        </span>
        <span className="mt-1 block text-sm font-semibold text-ink">{band}</span>
        <span className="block text-2xs text-ink-soft">{label}</span>
      </figcaption>
    </figure>
  );
}
