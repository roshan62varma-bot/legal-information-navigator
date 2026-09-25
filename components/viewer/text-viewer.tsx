"use client";

import * as React from "react";
import type { Page } from "@/types/legal";
import { findExcerptRange } from "@/lib/highlight";
import { isHeading } from "@/lib/ingestion";
import { WithPiiTokens } from "@/components/panels/shared";
import { scrollWithin } from "@/lib/utils";
import type { HighlightTarget } from "@/components/workspace/workspace-context";

/** Paper-style renderer for pasted text and OCR output (what the AI actually saw, PII tokens included). */
export function TextViewer({ pages, highlight }: { pages: Page[]; highlight: HighlightTarget | null }) {
  const refs = React.useRef(new Map<number, HTMLElement>());
  const markRef = React.useRef<HTMLElement | null>(null);

  const target = React.useMemo(() => {
    if (!highlight) return null;
    for (const p of [highlight.page, highlight.page + 1, highlight.page - 1]) {
      const page = pages.find((x) => x.page === p);
      if (!page) continue;
      const range = findExcerptRange(page.text, highlight.excerpt);
      if (range) return { page: p, ...range };
    }
    return { page: highlight.page, start: -1, end: -1 };
  }, [highlight, pages]);

  React.useEffect(() => {
    if (!target) return;
    const el = markRef.current ?? refs.current.get(target.page) ?? null;
    scrollWithin(el, markRef.current ? "center" : "start");
  }, [target, highlight?.nonce]);

  // The <mark> for the current target re-registers itself during commit.
  markRef.current = null;

  return (
    <div className="scrollbar-thin h-full overflow-auto bg-ink/[0.04] px-3 py-4 sm:px-5">
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
          <PageText
            text={p.text}
            range={target && target.page === p.page && target.start >= 0 ? target : null}
            markRef={markRef}
          />
        </article>
      ))}
    </div>
  );
}

function PageText({
  text,
  range,
  markRef,
}: {
  text: string;
  range: { start: number; end: number } | null;
  markRef: React.MutableRefObject<HTMLElement | null>;
}) {
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
        const isFirst = range.start >= para.offset;
        return (
          <Tag key={i} className={cls}>
            <WithPiiTokens text={para.text.slice(0, s)} />
            <mark
              className="cite-hl"
              ref={(el) => {
                if (isFirst) markRef.current = el;
              }}
            >
              <WithPiiTokens text={para.text.slice(s, e)} />
            </mark>
            <WithPiiTokens text={para.text.slice(e)} />
          </Tag>
        );
      })}
    </div>
  );
}
