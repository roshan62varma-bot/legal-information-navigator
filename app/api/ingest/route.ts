import type { OcrResponse, Page } from "@/types/legal";
import { IngestRequestSchema, LIMITS } from "@/types/legal";
import { looksScanned, normalizeWhitespace, splitTranscript, totalChars } from "@/lib/ingestion";
import { ocrPrompt } from "@/lib/prompts";
import { ApiRouteError, enforceRateLimit, errorResponse, parseBody } from "@/lib/server/http";
import { transcribePdf } from "@/lib/server/gemini";
import { ingestDocument } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ingest
 *
 * application/json      { name, pages, source }  -> chunk + embed, returns documentId + chunks.
 *                        Pages arrive already PII-scrubbed by the browser.
 * multipart/form-data   file=<pdf>               -> server-side parse fallback for PDFs the
 *                        browser could not read (scanned / image-only). Tries pdf-parse, then
 *                        Gemini multimodal OCR. Returns raw pages so the browser can scrub PII
 *                        before calling this route again with JSON.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      enforceRateLimit(req, "ocr", 6);
      return Response.json(await parseUploadedPdf(req), { headers: { "Cache-Control": "no-store" } });
    }
    enforceRateLimit(req, "ingest", 20);
    const body = await parseBody(req, IngestRequestSchema);
    if (totalChars(body.pages) > LIMITS.maxCharsPerDocument) {
      throw new ApiRouteError(413, "DOCUMENT_TOO_LONG", "This document is longer than 300,000 characters. Split it and upload the part you need.");
    }
    if (totalChars(body.pages) < 80) {
      throw new ApiRouteError(422, "DOCUMENT_EMPTY", "We could not find enough text in this document to analyse.");
    }
    return Response.json(await ingestDocument(body.pages), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

async function parseUploadedPdf(req: Request): Promise<OcrResponse> {
  const form = await req.formData().catch(() => {
    throw new ApiRouteError(400, "INVALID_UPLOAD", "Upload a PDF file.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiRouteError(400, "INVALID_UPLOAD", "Upload a PDF file.");
  if (file.size > LIMITS.maxFileBytes) throw new ApiRouteError(413, "FILE_TOO_LARGE", "PDFs must be 8 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new ApiRouteError(415, "NOT_A_PDF", "That file is not a PDF.");
  }

  const parsed = await parseWithPdfParse(bytes).catch(() => [] as Page[]);
  if (parsed.length > 0 && !looksScanned(parsed)) return { pages: parsed, method: "pdf-parse" };

  const transcript = await transcribePdf(bytes, ocrPrompt());
  const pages = splitTranscript(transcript);
  if (pages.length === 0) throw new ApiRouteError(422, "OCR_EMPTY", "No readable text was found in this PDF.");
  return { pages, method: "gemini-ocr" };
}

type PdfPageData = {
  pageIndex: number;
  getTextContent: () => Promise<{ items: { str: string; transform: number[] }[] }>;
};

async function parseWithPdfParse(bytes: Uint8Array): Promise<Page[]> {
  // Import the implementation file directly: pdf-parse's index runs a debug harness on import.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    data: Buffer,
    opts: { pagerender: (p: PdfPageData) => Promise<string>; max?: number },
  ) => Promise<unknown>;
  const texts: string[] = [];
  await pdfParse(Buffer.from(bytes), {
    max: LIMITS.maxPages,
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent();
      let lastY: number | undefined;
      let text = "";
      for (const item of content.items) {
        const y = item.transform[5];
        text += lastY === undefined || Math.abs(lastY - y) < 2 ? item.str : `\n${item.str}`;
        lastY = y;
      }
      texts[pageData.pageIndex] = text;
      return text;
    },
  });
  return texts.map((t, i) => ({ page: i + 1, text: normalizeWhitespace(t ?? "") }));
}
