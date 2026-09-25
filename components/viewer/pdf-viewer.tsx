"use client";

import * as React from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findExcerptRange } from "@/lib/highlight";
import { scrollWithin } from "@/lib/utils";
import type { HighlightTarget } from "@/components/workspace/workspace-context";

/**
 * pdf.js viewer: canvas for pixels, text layer for selection and citation
 * highlights. Pages render lazily as they approach the viewport.
 */
export function PdfViewer({ fileUrl, highlight }: { fileUrl: string; highlight: HighlightTarget | null }) {
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef(new Map<number, PageHandle>());

  React.useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const { loadPdfJs } = await import("@/lib/pdf-client");
        const pdfjs = await loadPdfJs();
        const data = await (await fetch(fileUrl)).arrayBuffer();
        loaded = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        if (!cancelled) setDoc(loaded);
      } catch {
        if (!cancelled) setError("This PDF could not be displayed.");
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [fileUrl]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!highlight || !doc) return;
    const handle = pageRefs.current.get(highlight.page);
    handle?.scrollIntoView();
    void handle?.highlight(highlight.excerpt).then((found) => {
      if (found) return;
      // The model may cite a neighbouring page for text that wraps across a page break.
      for (const p of [highlight.page + 1, highlight.page - 1]) {
        const h = pageRefs.current.get(p);
        if (h) {
          void h.highlight(highlight.excerpt).then((ok) => ok && h.scrollIntoView());
        }
      }
    });
  }, [highlight, doc]);

  if (error) return <p className="p-6 text-sm text-redline">{error}</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-1 border-b border-rule px-3 py-1.5">
        <span className="mr-auto text-2xs text-ink-soft">{doc ? `${doc.numPages} pages` : "Loading"}</span>
        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}>
          <ZoomOut />
        </Button>
        <span className="w-10 text-center text-2xs tabular-nums text-ink-soft">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>
          <ZoomIn />
        </Button>
      </div>
      <div ref={containerRef} className="scrollbar-thin flex-1 overflow-auto bg-ink/[0.04] px-3 py-4 sm:px-5">
        {!doc && (
          <div className="grid h-40 place-items-center text-ink-soft">
            <Loader2 className="size-5 animate-spin" aria-label="Loading PDF" />
          </div>
        )}
        {doc &&
          width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i + 1}
              doc={doc}
              pageNumber={i + 1}
              width={Math.min(width - 8, 900) * zoom}
              register={(h) => {
                if (h) pageRefs.current.set(i + 1, h);
                else pageRefs.current.delete(i + 1);
              }}
            />
          ))}
      </div>
    </div>
  );
}

type PageHandle = { scrollIntoView: () => void; highlight: (excerpt: string) => Promise<boolean> };

function PdfPage({
  doc,
  pageNumber,
  width,
  register,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  register: (h: PageHandle | null) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const textRef = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(pageNumber <= 2);
  const [aspect, setAspect] = React.useState(1.294);
  const rendered = React.useRef<Promise<void> | null>(null);
  const renderKey = React.useRef("");

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const render = React.useCallback(async () => {
    const key = `${width}`;
    if (rendered.current && renderKey.current === key) return rendered.current;
    renderKey.current = key;
    rendered.current = (async () => {
      const page: PDFPageProxy = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textDiv = textRef.current;
      if (!canvas || !textDiv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;

      const { TextLayer } = await import("pdfjs-dist");
      textDiv.replaceChildren();
      textDiv.style.setProperty("--scale-factor", String(scale));
      const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await layer.render();
    })();
    return rendered.current;
  }, [doc, pageNumber, width]);

  React.useEffect(() => {
    if (visible) void render();
  }, [visible, render]);

  React.useEffect(() => {
    register({
      scrollIntoView: () => scrollWithin(wrapRef.current, "start"),
      highlight: async (excerpt: string) => {
        setVisible(true);
        await render();
        const div = textRef.current;
        if (!div) return false;
        div.querySelectorAll(".cite-hl").forEach((n) => n.classList.remove("cite-hl", "cite-hl-flash"));
        const spans = Array.from(div.querySelectorAll<HTMLSpanElement>("span:not(.markedContent)"));
        let full = "";
        const offsets: number[] = [];
        for (const s of spans) {
          offsets.push(full.length);
          full += `${s.textContent ?? ""} `;
        }
        const range = findExcerptRange(full, excerpt);
        if (!range) return false;
        let first: HTMLSpanElement | null = null;
        spans.forEach((s, i) => {
          const start = offsets[i];
          const end = start + (s.textContent?.length ?? 0);
          if (end > range.start && start < range.end) {
            s.classList.add("cite-hl", "cite-hl-flash");
            first ??= s;
          }
        });
        scrollWithin(first as HTMLSpanElement | null, "center");
        return true;
      },
    });
    return () => register(null);
  }, [register, render]);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto mb-4 bg-white shadow-sheet"
      style={{ width, height: width * aspect }}
      data-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      role="region"
    >
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden />
      <div ref={textRef} className="textLayer" />
      <span className="absolute -left-1 top-2 -translate-x-full pr-2 text-2xs tabular-nums text-ink-soft max-sm:hidden">{pageNumber}</span>
    </div>
  );
}
