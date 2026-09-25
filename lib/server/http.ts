import type { z } from "zod";
import type { ApiError, DocumentPayload } from "@/types/legal";
import { computeDocumentId } from "@/lib/ingestion";
import { checkRateLimit } from "@/lib/server/rate-limit";

/** Typed error thrown anywhere in a route; converted to { error, code } JSON. Never leaks stack traces. */
export class ApiRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiRouteError) {
    const body: ApiError = { error: err.message, code: err.code };
    return Response.json(body, { status: err.status, headers: { ...NO_STORE, ...err.headers } });
  }
  // Log the class of failure only: never request bodies (they contain the user's document).
  console.error("[api] unhandled", err instanceof Error ? err.name : typeof err);
  const body: ApiError = { error: "Something went wrong on our side. Try again.", code: "INTERNAL" };
  return Response.json(body, { status: 500, headers: NO_STORE });
}

const TOO_LARGE = () => new ApiRouteError(413, "PAYLOAD_TOO_LARGE", "This document is too large to analyse. Try a shorter file.");

/**
 * Read the body with a hard byte cap enforced while streaming, so a request
 * without (or lying about) Content-Length cannot make the server buffer an
 * unbounded payload.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw TOO_LARGE();
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw TOO_LARGE();
    }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T, maxBytes = 3_000_000): Promise<z.infer<T>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiRouteError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as application/json.");
  }
  const bytes = await readBodyLimited(req, maxBytes);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiRouteError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    throw new ApiRouteError(400, "INVALID_REQUEST", `${first?.message ?? "Invalid request"}${where}`);
  }
  return parsed.data;
}

/** Document ids are content hashes, so the server can check that the text it received is the text it indexed. */
export async function assertDocumentId(expected: string, doc: DocumentPayload): Promise<void> {
  const actual = await computeDocumentId(doc.pages);
  if (expected !== doc.documentId || actual !== doc.documentId) {
    throw new ApiRouteError(409, "DOCUMENT_MISMATCH", "The document changed since it was processed. Upload it again.");
  }
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function enforceRateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000): void {
  const r = checkRateLimit(`${bucket}:${clientKey(req)}`, limit, windowMs);
  if (!r.allowed) {
    throw new ApiRouteError(429, "RATE_LIMITED", `Too many requests. Try again in ${Math.ceil(r.retryAfterMs / 1000)} seconds.`, {
      "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)),
    });
  }
}

export function streamResponse(stream: ReadableStream<Uint8Array>, model: string, extra: Record<string, string> = {}): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Model": model,
      ...NO_STORE,
      ...extra,
    },
  });
}
