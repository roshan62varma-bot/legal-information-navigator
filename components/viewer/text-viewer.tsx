"use client";

import * as React from "react";
import type { Page } from "@/types/legal";
import { findExcerptRange } from "@/lib/highlight";
import { isHeading } from "@/lib/ingestion";
import { WithPiiTokens } from "@/components/panels/shared";
import { scrollWithin } from "@/lib/utils";
import type { HighlightTarget } from "@/components/workspace/workspace-context";

type Target = { page: number; start: number; end: number };

/** Find the quote on the cited page, or on a neighbour (quotes can wrap a page break). start = -1 when not found. */
function locateExcerpt(pages: readonly Page[], cited: number | null, excerpt: string): Target | null {
  if (cited === null) return null;
  for (const p of [cited, cited + 1, cited - 1]) {
    const page = pages.find((x) => x.page === p);
    const range = page ? findExcerptRange(page.text, excerpt) : null;
    if (range) return { page: p, ...range };
  }
  return { page: cited, start: -1, end: -1 };
}

/** Paper-style renderer for pasted text and OCR output (what the AI actually saw, PII tokens included). */
export function TextViewer({ pages, highlight }: { pages: Page[]; highlight: HighlightTarget | null }) {
  const refs = React.useRef(new Map<number, HTMLElement>());
  const containerRef = React.useRef<HTMLDivElement>(null);

  const cited = highlight?.page ?? null;
  const excerpt = highlight?.excerpt ?? "";
  const nonce = highlight?.nonce ?? 0;

  const target = React.useMemo(() => locateExcerpt(pages, cited, excerpt), [cited, excerpt, pages]);

  React.useEffect(() => {
    if (!target) return;
    // After commit, the first <mark> (if the quote was found) is the scroll target; otherwise the page.
    const mark = containerRef.current?.querySelector<HTMLElement>("mark.cite-hl") ?? null;
    scrollWithin(mark ?? refs.current.get(target.page) ?? null, mark ? "center" : "start");
  }, [target, nonce]);

  return (
    <div ref={containerRef} className="scrollbar-thin h-full overflow-auto bg-ink/[0.04] px-3 py-4 sm:px-5">
      {pages.map((p) => (
        <article
          key={p.page}
          ref={(el) => {
            if (el) refs.current.set(p.page, el);
          }}
          aria-label={`Page ${p.page}`}
          className="relative mx-auto mb-4 max-w-[46rem] bg-sheet px-6 py-7 shadow-sheet sm:px-10 sm:py-10"
        >
          <span className="absolute right-4 top-3 text-2xs tabular-nums text-ink-soft">Page {p.page}</span>
          <PageText text={p.text} range={target && target.page === p.page && target.start >= 0 ? target : null} />
        </article>
      ))}
    </div>
  );
}

const PageText = React.memo(function PageText({ text, range }: { text: string; range: { start: number; end: number } | null }) {
  // Split into paragraphs while keeping absolute offsets, so the highlight range can cross paragraph boundaries.
  const paragraphs: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const para of text.split("\n")) {
    paragraphs.push({ text: para, offset });
    offset += para.length + 1;
  }
  return (
    <div className="space-y-3 font-serif text-[0.95rem] leading-[1.75] text-ink">
      {paragraphs.map((para, i) => {
        if (!para.text.trim()) return null;
        const heading = isHeading(para.text) && para.text.length < 70;
        const Tag = heading ? "h4" : "p";
        const cls = heading ? "pt-2 font-serif text-base font-bold" : "";
        if (!range || range.end <= para.offset || range.start >= para.offset + para.text.length) {
          return (
            <Tag key={i} className={cls}>
              <WithPiiTokens text={para.text} />
            </Tag>
          );
        }
        const s = Math.max(0, range.start - para.offset);
        const e = Math.min(para.text.length, range.end - para.offset);
        return (
          <Tag key={i} className={cls}>
            <WithPiiTokens text={para.text.slice(0, s)} />
            <mark className="cite-hl">
              <WithPiiTokens text={para.text.slice(s, e)} />
            </mark>
            <WithPiiTokens text={para.text.slice(e)} />
          </Tag>
        );
      })}
    </div>
  );
});
