import { CompareModelSchema, CompareRequestSchema } from "@/types/legal";
import { diffDocuments } from "@/lib/diff";
import { comparePrompt } from "@/lib/prompts";
import { ApiRouteError, assertDocumentId, enforceRateLimit, errorResponse, parseBody, streamResponse } from "@/lib/server/http";
import { streamStructured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/compare: the server recomputes the Myers clause diff (it never
 * trusts a client-side diff), then streams Gemini's annotation of every
 * changed row. The browser renders the same deterministic diff instantly
 * and merges annotations in by rowId as they stream.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "ai", 30);
    const body = await parseBody(req, CompareRequestSchema, 4_000_000);
    await assertDocumentId(body.documentIdA, body.documentA);
    await assertDocumentId(body.documentIdB, body.documentB);
    if (body.documentIdA === body.documentIdB) {
      throw new ApiRouteError(422, "SAME_DOCUMENT", "Both versions are identical. Upload a different second version.");
    }
    const { rows, stats } = diffDocuments(body.documentA.pages, body.documentB.pages);
    const { stream, model } = await streamStructured({
      tier: "fast",
      schema: CompareModelSchema,
      prompt: comparePrompt(rows, body.documentA.name, body.documentB.name, body.preferences),
      signal: req.signal,
    });
    return streamResponse(stream, model, {
      "X-Diff-Stats": `${stats.added}/${stats.removed}/${stats.modified}/${stats.unchanged}`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
