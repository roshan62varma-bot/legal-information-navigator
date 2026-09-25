"use client";

import * as React from "react";
import type { IngestedDocument, Page, PiiReport } from "@/types/legal";
import { LIMITS } from "@/types/legal";
import { looksScanned, paginateText, scrubPII, totalChars } from "@/lib/ingestion";
import { ingestPages, readableError, serverParsePdf } from "@/lib/api-client";

export type IngestStage =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "needs-ocr"; file: File }
  | { kind: "ocr" }
  | { kind: "scrubbing" }
  | { kind: "indexing"; pii: PiiReport | null }
  | { kind: "error"; message: string };

export function useIngest(onReady: (doc: IngestedDocument) => void) {
  const [stage, setStage] = React.useState<IngestStage>({ kind: "idle" });
  const [scrub, setScrub] = React.useState(true);

  const finish = React.useCallback(
    async (name: string, raw: Page[], source: IngestedDocument["source"], fileUrl: string | null) => {
      if (totalChars(raw) > LIMITS.maxCharsPerDocument) {
        throw new Error(JSON.stringify({ error: "This document is longer than 300,000 characters. Upload the part you need.", code: "TOO_LONG" }));
      }
      // PII leaves the page only as placeholders: this runs before any network call.
      setStage({ kind: "scrubbing" });
      const { pages, report } = scrub ? scrubPII(raw) : { pages: raw, report: null };
      setStage({ kind: "indexing", pii: report });
      const res = await ingestPages(name, pages, source);
      onReady({
        documentId: res.documentId,
        name,
        pages: res.pages,
        chunks: res.chunks,
        index: res.index,
        retrievalMode: res.retrievalMode,
        source,
        pii: report,
        injectionsNeutralized: res.injectionsNeutralized,
        fileUrl,
      });
      setStage({ kind: "idle" });
    },
    [onReady, scrub],
  );

  const fail = (err: unknown) => setStage({ kind: "error", message: readableError(err).message });

  const ingestFile = React.useCallback(
    async (file: File) => {
      try {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const isText = file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name);
        if (!isPdf && !isText) throw new Error(JSON.stringify({ error: "Upload a PDF or a .txt file.", code: "TYPE" }));
        if (file.size > LIMITS.maxFileBytes) throw new Error(JSON.stringify({ error: "Files must be 8 MB or smaller.", code: "SIZE" }));

        if (isText) {
          const pages = paginateText(await file.text());
          if (pages.length === 0) throw new Error(JSON.stringify({ error: "That file is empty.", code: "EMPTY" }));
          await finish(file.name, pages, "text", null);
          return;
        }

        setStage({ kind: "reading", done: 0, total: 1 });
        const { extractPdfText } = await import("@/lib/pdf-client");
        const buffer = await file.arrayBuffer();
        let pages: Page[];
        try {
          ({ pages } = await extractPdfText(buffer, (done, total) => setStage({ kind: "reading", done, total })));
        } catch {
          throw new Error(JSON.stringify({ error: "This PDF could not be opened. It may be damaged or password-protected.", code: "PDF_OPEN" }));
        }
        if (looksScanned(pages)) {
          setStage({ kind: "needs-ocr", file });
          return;
        }
        await finish(file.name, pages, "pdf", URL.createObjectURL(file));
      } catch (err) {
        fail(err);
      }
    },
    [finish],
  );

  /** Only after explicit consent: the raw PDF goes to the server because it has no text layer to scrub locally. */
  const runOcr = React.useCallback(
    async (file: File) => {
      try {
        setStage({ kind: "ocr" });
        const { pages } = await serverParsePdf(file);
        await finish(file.name, pages, "ocr", URL.createObjectURL(file));
      } catch (err) {
        fail(err);
      }
    },
    [finish],
  );

  const ingestText = React.useCallback(
    async (name: string, text: string) => {
      try {
        const pages = paginateText(text);
        if (totalChars(pages) < 80) throw new Error(JSON.stringify({ error: "Paste at least a few sentences of the document.", code: "SHORT" }));
        await finish(name, pages, "text", null);
      } catch (err) {
        fail(err);
      }
    },
    [finish],
  );

  const reset = React.useCallback(() => setStage({ kind: "idle" }), []);

  return { stage, scrub, setScrub, ingestFile, ingestText, runOcr, reset };
}
