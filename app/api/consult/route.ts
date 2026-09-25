import { ConsultModelSchema, ConsultRequestSchema } from "@/types/legal";
import { consultPrompt } from "@/lib/prompts";
import { scanRedFlags } from "@/lib/heuristics";
import { assertDocumentId, enforceRateLimit, errorResponse, parseBody, streamResponse } from "@/lib/server/http";
import { streamStructured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/consult: streams a ConsultationSheet for the attorney meeting. */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "ai", 30);
    const body = await parseBody(req, ConsultRequestSchema);
    await assertDocumentId(body.documentId, body.document);
    const { stream, model } = await streamStructured({
      tier: "deep",
      schema: ConsultModelSchema,
      prompt: consultPrompt(body.document.pages, scanRedFlags(body.document.pages), body.concerns, body.preferences),
      signal: req.signal,
    });
    return streamResponse(stream, model);
  } catch (err) {
    return errorResponse(err);
  }
}
