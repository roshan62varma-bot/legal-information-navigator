import "server-only";
import { z } from "zod";
import type { AskEvent, DocumentChunk, GroundedAnswer, IngestResponse, Page, Preferences } from "@/types/legal";
import { AnswerModelSchema, GroundedAnswerSchema, QA_DISCLAIMER } from "@/types/legal";
import { chunkPages, computeDocumentId, sanitizePages, sanitizeQuery } from "@/lib/ingestion";
import { hybridSearch, rerank, toRetrievedChunk, type Candidate, type RerankFn } from "@/lib/retrieval";
import { answerPrompt, rerankPrompt } from "@/lib/prompts";
import { faithfulness, verifyCitations } from "@/lib/grounding";
import { embedDocuments, embedQuery, generateStructured } from "@/lib/server/gemini";

// ---------------------------------------------------------------------------
// Ingestion: sanitize -> chunk -> embed
// ---------------------------------------------------------------------------

const EMBED_BATCH = 90;

export async function ingestDocument(pages: Page[]): Promise<IngestResponse> {
  const { pages: clean, neutralized } = sanitizePages(pages);
  const documentId = await computeDocumentId(clean);
  const chunks = chunkPages(clean);

  let retrievalMode: IngestResponse["retrievalMode"] = "hybrid";
  try {
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      vectors.push(...(await embedDocuments(batch.map((c) => `${c.section}\n${c.text}`))));
    }
    chunks.forEach((c, i) => (c.embedding = vectors[i] ?? null));
    if (chunks.some((c) => c.embedding === null)) throw new Error("missing vectors");
  } catch (err) {
    // Embeddings are an optimisation: BM25 keeps Q&A working if they fail.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "MISSING_API_KEY") throw err;
    chunks.forEach((c) => (c.embedding = null));
    retrievalMode = "lexical";
  }

  return { documentId, chunks, retrievalMode, injectionsNeutralized: neutralized, pages: clean };
}

// ---------------------------------------------------------------------------
// Gemini as a cross-encoder reranker
// ---------------------------------------------------------------------------

const RerankSchema = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(10) })),
});

export const geminiReranker: RerankFn = async (query, candidates: Candidate[]) => {
  const { object } = await generateStructured({
    tier: "lite",
    schema: RerankSchema,
    prompt: rerankPrompt(
      query,
      candidates.map((c) => ({ id: c.chunk.id, section: c.chunk.section, text: c.chunk.text })),
    ),
  });
  return new Map(object.scores.map((s) => [s.id, s.score]));
};

// ---------------------------------------------------------------------------
// Grounded Q&A: retrieve -> rerank -> generate -> verify
// ---------------------------------------------------------------------------

export type AskOptions = {
  pages: Page[];
  chunks: DocumentChunk[];
  query: string;
  preferences?: Partial<Preferences>;
  emit: (e: AskEvent) => void;
  reranker?: RerankFn | null;
  signal?: AbortSignal;
};

function refusal(reason: string, retrieved: GroundedAnswer["retrieved"]): GroundedAnswer {
  return GroundedAnswerSchema.parse({
    status: "refused",
    answer: "",
    refusalReason: reason,
    citations: [],
    confidence: "low",
    followUps: [],
    faithfulness: { verifiedCitations: 0, totalCitations: 0, passed: false },
    retrieved,
    disclaimer: QA_DISCLAIMER,
  });
}

export async function answerQuestion(opts: AskOptions): Promise<GroundedAnswer> {
  const { emit } = opts;
  const query = sanitizeQuery(opts.query);

  emit({ type: "stage", stage: "retrieve", detail: "Searching your document (vector + keyword)" });
  let queryVector: number[] | null = null;
  if (opts.chunks.every((c) => c.embedding !== null)) {
    try {
      queryVector = await embedQuery(query);
    } catch {
      queryVector = null;
    }
  }
  const candidates = hybridSearch(opts.chunks, query, queryVector, 12);
  emit({ type: "retrieved", chunks: candidates.map(toRetrievedChunk) });

  if (candidates.length === 0) {
    return refusal("Nothing in your document matches this question.", []);
  }

  emit({ type: "stage", stage: "rerank", detail: `Gemini is ranking ${candidates.length} passages for relevance` });
  const top = await rerank(query, candidates, opts.reranker === undefined ? geminiReranker : opts.reranker, { topK: 5, minScore: 4 });
  const retrieved = top.map(toRetrievedChunk);
  emit({ type: "retrieved", chunks: retrieved });

  if (top.length === 0) {
    return refusal("Your document does not appear to cover this question, so there is nothing to cite. Try rephrasing, or ask an attorney.", candidates.slice(0, 5).map(toRetrievedChunk));
  }

  emit({ type: "stage", stage: "generate", detail: "Writing an answer from the top passages only" });
  const { object } = await generateStructured({
    tier: "fast",
    schema: AnswerModelSchema,
    prompt: answerPrompt(top.map((t) => t.chunk), query, opts.preferences),
    signal: opts.signal,
  });

  emit({ type: "stage", stage: "verify", detail: "Checking every citation against your document" });
  // Only the retrieved passages count as evidence: build pseudo-pages from them.
  const evidence: Page[] = top.map((t) => ({ page: t.chunk.page, text: t.chunk.text }));
  const citations = verifyCitations(object.citations, evidence).map((c) => {
    // Keep page numbers honest against the full document too.
    return c.verified ? c : verifyCitations([c], opts.pages)[0];
  });
  const faith = faithfulness(citations);

  if (!object.answerable) {
    return refusal(object.answer || "Your document does not answer this question.", retrieved);
  }
  if (!faith.passed) {
    return refusal("An answer was drafted but none of its quotes could be found in your document, so it was withheld.", retrieved);
  }

  return GroundedAnswerSchema.parse({
    status: "answered",
    answer: object.answer,
    refusalReason: null,
    citations: citations.filter((c) => c.verified),
    confidence: object.confidence,
    followUps: object.followUps.slice(0, 3),
    faithfulness: faith,
    retrieved,
    disclaimer: QA_DISCLAIMER,
  });
}
