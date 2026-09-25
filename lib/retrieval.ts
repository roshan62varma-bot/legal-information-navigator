import type { DocumentChunk, RetrievedChunk } from "@/types/legal";

/**
 * Retrieval over an in-memory DocumentChunk[]; no vector DB.
 *
 *   query ─┬─ dense: cosine(queryEmbedding, chunk.embedding)
 *          └─ sparse: BM25 over chunk text
 *                 │
 *        reciprocal-rank fusion (k = 60)  -> top N candidates
 *                 │
 *        rerank(): Gemini scores each (query, chunk) pair  -> top 5
 */

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its may me my of on or our shall should that the their them there these this to under was what when where which who will with would you your".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Tiny suffix stripper: enough to match "terminate / termination / terminated". */
export function stem(t: string): string {
  if (t.length <= 4) return t;
  return t.replace(/(ational|ation|ions|ion|ings|ing|ed|es|ies|ly|ment|s)$/, "") || t;
}

export function bm25Scores(query: string, docs: readonly string[], k1 = 1.4, b = 0.75): number[] {
  const qTerms = Array.from(new Set(tokenize(query)));
  const docTokens = docs.map(tokenize);
  const N = docs.length;
  const avgdl = docTokens.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const toks of docTokens) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  return docTokens.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / Math.max(1, avgdl))));
    }
    return score;
  });
}

function ranksOf(scores: number[]): number[] {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const ranks = new Array<number>(scores.length);
  order.forEach(([, idx], rank) => (ranks[idx] = rank));
  return ranks;
}

export type Candidate = {
  chunk: DocumentChunk;
  vectorScore: number | null;
  lexicalScore: number;
  fusedScore: number;
};

export function hybridSearch(
  chunks: readonly DocumentChunk[],
  query: string,
  queryEmbedding: readonly number[] | null,
  topN = 12,
  rrfK = 60,
): Candidate[] {
  if (chunks.length === 0) return [];
  const lexical = bm25Scores(query, chunks.map((c) => `${c.section} ${c.text}`));
  const lexRanks = ranksOf(lexical);

  const canUseVectors = queryEmbedding !== null && chunks.every((c) => c.embedding !== null);
  const vector = canUseVectors ? chunks.map((c) => cosineSimilarity(queryEmbedding!, c.embedding!)) : null;
  const vecRanks = vector ? ranksOf(vector) : null;

  const candidates = chunks.map((chunk, i) => {
    let fused = lexical[i] > 0 ? 1 / (rrfK + lexRanks[i] + 1) : 0;
    if (vecRanks) fused += 1 / (rrfK + vecRanks[i] + 1);
    return { chunk, vectorScore: vector ? vector[i] : null, lexicalScore: lexical[i], fusedScore: fused };
  });

  return candidates
    .filter((c) => c.fusedScore > 0)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topN);
}

/** Scores 0-10 for each candidate id; supplied by the Gemini cross-encoder in production, a mock in tests. */
export type RerankFn = (query: string, candidates: Candidate[]) => Promise<Map<string, number>>;

export type Reranked = Candidate & { rerankScore: number | null };

export async function rerank(
  query: string,
  candidates: Candidate[],
  rerankFn: RerankFn | null,
  opts: { topK?: number; minScore?: number } = {},
): Promise<Reranked[]> {
  const topK = opts.topK ?? 5;
  const minScore = opts.minScore ?? 4;
  if (candidates.length === 0) return [];
  if (!rerankFn) return candidates.slice(0, topK).map((c) => ({ ...c, rerankScore: null }));
  let scores: Map<string, number>;
  try {
    scores = await rerankFn(query, candidates);
  } catch {
    // Reranker unavailable: fall back to fused order rather than failing the question.
    return candidates.slice(0, topK).map((c) => ({ ...c, rerankScore: null }));
  }
  return candidates
    .map((c) => ({ ...c, rerankScore: scores.get(c.chunk.id) ?? 0 }))
    .filter((c) => c.rerankScore >= minScore)
    .sort((a, b) => b.rerankScore - a.rerankScore || b.fusedScore - a.fusedScore)
    .slice(0, topK);
}

export function toRetrievedChunk(c: Reranked | Candidate): RetrievedChunk {
  return {
    id: c.chunk.id,
    page: c.chunk.page,
    section: c.chunk.section,
    preview: c.chunk.text.slice(0, 220),
    vectorScore: c.vectorScore === null ? null : Number(c.vectorScore.toFixed(4)),
    lexicalScore: Number(c.lexicalScore.toFixed(3)),
    fusedScore: Number(c.fusedScore.toFixed(5)),
    rerankScore: "rerankScore" in c ? c.rerankScore : null,
  };
}
