"use client";

import type { ApiError, AskEvent, DocumentPayload, IngestResponse, OcrResponse, Page, Preferences, SignedIndex } from "@/types/legal";

export class ClientApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
  }
}

/** useObject surfaces non-2xx bodies as Error(message=raw body). Turn that back into friendly text. */
export function readableError(err: unknown): { message: string; code: string } {
  if (err instanceof ClientApiError) return { message: err.message, code: err.code };
  const raw = err instanceof Error ? err.message : String(err ?? "");
  try {
    const parsed = JSON.parse(raw) as Partial<ApiError>;
    if (parsed.error) return { message: parsed.error, code: parsed.code ?? "ERROR" };
  } catch {
    /* not JSON */
  }
  if (/failed to fetch|network/i.test(raw)) return { message: "Could not reach the server. Check your connection and try again.", code: "NETWORK" };
  if (/interrupted|aborted/i.test(raw)) return { message: "The response was cut off. Try again.", code: "INTERRUPTED" };
  return { message: "Something went wrong. Try again.", code: "ERROR" };
}

async function asApiError(res: Response): Promise<ClientApiError> {
  try {
    const body = (await res.json()) as ApiError;
    return new ClientApiError(body.error, body.code, res.status);
  } catch {
    return new ClientApiError(`Request failed (${res.status})`, "HTTP_ERROR", res.status);
  }
}

export async function ingestPages(name: string, pages: Page[], source: "pdf" | "text" | "ocr"): Promise<IngestResponse> {
  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pages, source }),
  });
  if (!res.ok) throw await asApiError(res);
  return (await res.json()) as IngestResponse;
}

export async function serverParsePdf(file: File): Promise<OcrResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/ingest", { method: "POST", body: form });
  if (!res.ok) throw await asApiError(res);
  return (await res.json()) as OcrResponse;
}

export function toPayload(doc: DocumentPayload): DocumentPayload {
  return { documentId: doc.documentId, name: doc.name, pages: doc.pages };
}

/** Stream NDJSON AskEvents from /api/ask. */
export async function askQuestion(
  doc: DocumentPayload & { index: SignedIndex | null },
  query: string,
  preferences: Preferences,
  onEvent: (e: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: doc.documentId, document: toPayload(doc), index: doc.index, query, preferences }),
    signal,
  });
  if (!res.ok || !res.body) throw await asApiError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AskEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AskEvent);
}
