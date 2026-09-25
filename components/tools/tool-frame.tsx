"use client";

import * as React from "react";
import { Disclaimer } from "@/components/panels/shared";

/** Standard tool layout: inputs on top, scrollable output, disclaimer pinned to the bottom. */
export function ToolFrame({
  title,
  description,
  controls,
  children,
  disclaimer,
}: {
  title: string;
  description: string;
  controls: React.ReactNode;
  children: React.ReactNode;
  disclaimer: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-rule px-5 pb-4 pt-5">
        <div>
          <h2 className="font-serif text-2xl text-ink">{title}</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-soft">{description}</p>
        </div>
        {controls}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      <Disclaimer text={disclaimer} />
    </div>
  );
}

export function EmptyOutput({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-10 text-center text-sm text-ink-soft">
      <span className="grid size-12 place-items-center rounded-pill bg-ink/5 text-ink-soft">{icon}</span>
      {children}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-ink">
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-control border border-rule bg-sheet px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-ink/40 focus:outline-none";
