import "server-only";
import { z } from "zod";
import type { AskEvent, GroundedAnswer, IngestResponse, Page, Preferences, SignedIndex } from "@/types/legal";
import { AnswerModelSchema, GroundedAnswerSchema, QA_DISCLAIMER } from "@/types/legal";
import { chunkPages, computeDocumentId, sanitizePages, sanitizeQuery } from "@/lib/ingestion";
import { hybridSearch, rerank, toRetrievedChunk, type Candidate, type RerankFn } from "@/lib/retrieval";
import { answerPrompt, rerankPrompt } from "@/lib/prompts";
import { faithfulness, verifyCitations } from "@/lib/grounding";
import { dequantize } from "@/lib/vector";
import { embedDocuments, embedQuery, generateStructured } from "@/lib/server/gemini";
import { signIndex, verifyIndex } from "@/lib/server/signing";
import { ApiRouteError } from "@/lib/server/http";

// ---------------------------------------------------------------------------
// Ingestion: sanitize -> chunk -> embed
// ---------------------------------------------------------------------------

export async function ingestDocument(pages: Page[], signal?: AbortSignal): Promise<IngestResponse> {
  const { pages: clean, neutralized } = sanitizePages(pages);
  const documentId = await computeDocumentId(clean);
  const chunks = chunkPages(clean);

  let index: SignedIndex | null = null;
  try {
    const vectors = await embedDocuments(chunks.map((c) => `${c.section}\n${c.text}`), signal);
    if (vectors.length !== chunks.length) throw new Error("missing vectors");
    index = { vectors, signature: await signIndex(documentId, vectors) };
  } catch (err) {
    // Embeddings are an optimisation: BM25 keeps Q&A working if they fail.
    if (err instanceof ApiRouteError && err.code === "MISSING_API_KEY") throw err;
    index = null;
  }

  return { documentId, chunks, index, retrievalMode: index ? "hybrid" : "lexical", injectionsNeutralized: neutralized, pages: clean };
}

/**
 * Rebuild the chunk list from the (hash-verified) pages and attach the
 * client-held vectors only if their HMAC signature is valid.
 */
export async function loadIndex(documentId: string, pages: Page[], index: SignedIndex | null) {
  const chunks = chunkPages(pages);
  if (!index) return { chunks, vectors: null };
  if (index.vectors.length !== chunks.length || !(await verifyIndex(documentId, index.vectors, index.signature))) {
    throw new ApiRouteError(409, "INDEX_INVALID", "The search index for this document is invalid. Upload the document again.");
  }
  return { chunks, vectors: index.vectors.map(dequantize) };
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

export type LoadedIndex = Awaited<ReturnType<typeof loadIndex>>;

export type AskOptions = {
  documentId: string;
  pages: Page[];
  index: SignedIndex | null;
  /** Pre-verified index (the route verifies before streaming); loaded here when absent. */
  loaded?: LoadedIndex;
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

  const { chunks, vectors } = opts.loaded ?? (await loadIndex(opts.documentId, opts.pages, opts.index));
  emit({ type: "stage", stage: "retrieve", detail: vectors ? "Searching your document (vector + keyword)" : "Searching your document (keyword)" });
  let queryVector: number[] | null = null;
  if (vectors) {
    try {
      queryVector = await embedQuery(query, opts.signal);
    } catch {
      queryVector = null;
    }
  }
  const candidates = hybridSearch(chunks, query, queryVector, vectors, 12);
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
