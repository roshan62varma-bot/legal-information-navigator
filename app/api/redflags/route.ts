import { RedFlagModelSchema, RedFlagsRequestSchema } from "@/types/legal";
import { redFlagsPrompt } from "@/lib/prompts";
import { scanRedFlags } from "@/lib/heuristics";
import { assertDocumentId, enforceRateLimit, errorResponse, parseBody, streamResponse } from "@/lib/server/http";
import { streamStructured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/redflags: deterministic pre-scan feeds hints into a deep-tier
 * Gemini review; streams { overallRiskScore, overallAssessment, flags: RedFlagOutput }.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "ai", 30);
    const body = await parseBody(req, RedFlagsRequestSchema);
    await assertDocumentId(body.documentId, body.document);
    const hints = scanRedFlags(body.document.pages);
    const { stream, model } = await streamStructured({
      tier: "deep",
      schema: RedFlagModelSchema,
      prompt: redFlagsPrompt(body.document.pages, hints, body.perspective, body.preferences),
      signal: req.signal,
    });
    return streamResponse(stream, model, { "X-Prescan-Hits": String(hints.length) });
  } catch (err) {
    return errorResponse(err);
  }
}
