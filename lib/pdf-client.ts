"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Page } from "@/types/legal";
import { LIMITS } from "@/types/legal";
import { normalizeWhitespace } from "@/lib/ingestion";

/**
 * Browser-side PDF handling with pdfjs-dist. Text is extracted locally so
 * the raw file never leaves the device on the happy path.
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      // Copied to /public by scripts/copy-pdf-worker.mjs (same origin, so CSP worker-src 'self' covers it).
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  // Copy: pdf.js transfers the buffer to its worker, and we may need the bytes again for OCR.
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false, disableFontFace: false }).promise;
}

type TextItem = { str: string; transform: number[]; hasEOL?: boolean };

/** Rebuild reading-order lines from positioned text items. */
export function itemsToText(items: TextItem[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
    else if (out && !out.endsWith(" ") && !out.endsWith("\n") && item.str && !item.str.startsWith(" ")) out += " ";
    out += item.str;
    if (item.hasEOL) {
      out += "\n";
      lastY = null;
      continue;
    }
    lastY = y;
  }
  return normalizeWhitespace(out.replace(/ +\n/g, "\n"));
}

export async function extractPdfText(
  data: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: Page[]; pageCount: number }> {
  const doc = await openPdf(data);
  const total = Math.min(doc.numPages, LIMITS.maxPages);
  const pages: Page[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => "str" in it) as TextItem[];
    pages.push({ page: i, text: itemsToText(items).slice(0, 60_000) });
    onProgress?.(i, total);
  }
  await doc.destroy();
  return { pages, pageCount: total };
}
