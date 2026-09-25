import { SummarizeRequestSchema, SummaryModelSchema } from "@/types/legal";
import { summarizePrompt } from "@/lib/prompts";
import { assertDocumentId, enforceRateLimit, errorResponse, parseBody, streamResponse } from "@/lib/server/http";
import { streamStructured } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/summarize: streams a SummaryOutput (partial JSON, validated by Zod on completion). */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "ai", 30);
    const body = await parseBody(req, SummarizeRequestSchema);
    await assertDocumentId(body.documentId, body.document);
    const { stream, model } = await streamStructured({
      tier: "fast",
      schema: SummaryModelSchema,
      prompt: summarizePrompt(body.document.pages, body.focus, body.preferences),
      signal: req.signal,
    });
    return streamResponse(stream, model);
  } catch (err) {
    return errorResponse(err);
  }
}
