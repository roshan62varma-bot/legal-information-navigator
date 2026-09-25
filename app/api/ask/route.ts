import type { AskEvent } from "@/types/legal";
import { AskRequestSchema } from "@/types/legal";
import { ApiRouteError, assertDocumentId, enforceRateLimit, errorResponse, parseBody } from "@/lib/server/http";
import { answerQuestion, loadIndex } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ask: grounded Q&A. Streams NDJSON AskEvents so the UI can show
 * each RAG stage live; the final "result" event carries a GroundedAnswer that
 * has already passed the server-side faithfulness gate (or is a refusal).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "ai", 30);
    const body = await parseBody(req, AskRequestSchema);
    await assertDocumentId(body.documentId, body.document);
    // Reject a forged or stale index with a real HTTP status before any streaming starts.
    const loaded = await loadIndex(body.documentId, body.document.pages, body.index);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (e: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        try {
          const data = await answerQuestion({
            documentId: body.documentId,
            pages: body.document.pages,
            index: body.index,
            loaded,
            query: body.query,
            preferences: body.preferences,
            emit,
            signal: req.signal,
          });
          emit({ type: "result", data });
        } catch (err) {
          const e =
            err instanceof ApiRouteError
              ? { error: err.message, code: err.code }
              : { error: "Something went wrong while answering. Try again.", code: "INTERNAL" };
          emit({ type: "error", ...e });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
