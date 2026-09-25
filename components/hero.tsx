"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { EyeOff, Quote, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { PreferencesMenu } from "@/components/preferences";

const ContractScene = dynamic(() => import("@/components/three/contract-scene"), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden />,
});

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-rule/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Legal Information Navigator, back to top">
          <Mark />
          <span className="font-serif text-lg leading-none text-ink">
            Legal Information <span className="italic">Navigator</span>
          </span>
        </a>
        <nav className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="max-sm:hidden">
            <a href="#workspace">Workspace</a>
          </Button>
          <PreferencesMenu />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/** Wordmark: a folded page with a highlighter stroke. */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <path d="M6 3h11l5 5v17H6z" className="fill-sheet stroke-ink" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17 3v5h5" className="fill-none stroke-ink" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="8.5" y="12" width="11" height="3.4" rx="1" className="fill-highlight" />
      <path d="M9.5 13.7h9M9.5 18.5h9M9.5 21.5h6" className="stroke-ink" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function Hero({ onTrySample }: { onTrySample: () => void }) {
  return (
    <section id="top" className="relative overflow-hidden border-b border-rule">
      <div className="mx-auto grid max-w-[1440px] items-center gap-6 px-4 pb-10 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-4 lg:pt-6">
        <div className="max-w-xl py-4 lg:py-16">
          <h1 className="text-4xl text-ink sm:text-5xl">
            Know what you are signing before you sign it.
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
            Upload a lease, NDA, employment agreement or terms of service. Get a plain-English summary, the clauses that could cost you, answers quoted
            straight from the page, and the questions to take to a lawyer.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="#workspace">Open a contract</a>
            </Button>
            <Button size="lg" variant="secondary" onClick={onTrySample}>
              Try a sample NDA
            </Button>
          </div>
          <ul className="mt-9 grid gap-3 text-sm text-ink sm:grid-cols-3 sm:gap-5">
            <li className="flex gap-2.5">
              <EyeOff className="mt-0.5 size-4 shrink-0 text-seal" aria-hidden />
              <span>Personal details are removed in your browser before anything is sent.</span>
            </li>
            <li className="flex gap-2.5">
              <Quote className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
              <span>Every finding links to the exact clause and page it came from.</span>
            </li>
            <li className="flex gap-2.5">
              <Scale className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
              <span>Legal information to prepare you, not a replacement for an attorney.</span>
            </li>
          </ul>
        </div>
        <div className="relative h-[340px] sm:h-[440px] lg:h-[600px]">
          <ContractScene label="A contract page being marked up: highlighted risky lines, a struck-through clause and an inserted line" />
        </div>
      </div>
    </section>
  );
}
