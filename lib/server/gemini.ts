import "server-only";
import { createGoogle, type GoogleProvider } from "@ai-sdk/google";
import { embed, embedMany, generateText, Output, streamText, type EmbeddingModel, type LanguageModel } from "ai";
import type { z } from "zod";
import { LIMITS } from "@/types/legal";
import { GUARDRAILS } from "@/lib/prompts";
import { quantize } from "@/lib/vector";
import { ApiRouteError } from "@/lib/server/http";

/**
 * Gemini access. Model ids are configurable because Google retires model
 * versions regularly (1.5 and 2.5 are closed to new keys at time of writing).
 *
 * LITE chain: short, latency-critical calls (reranking).
 * FAST chain: streaming UI work (summary, compare, Q&A answers, OCR).
 * DEEP chain: long-form analysis (red flags, consultation sheet); falls back
 *             to the FAST chain automatically when the pro model is out of quota.
 *
 * Every attempt has a time-to-first-token budget; a model that is overloaded
 * or stuck is abandoned and the next model in the chain takes over.
 */

function list(env: string | undefined, fallback: string[]): string[] {
  const parsed = env?.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : fallback;
}

export const LITE_MODELS = list(process.env.GEMINI_LITE_MODELS, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]);
export const FAST_MODELS = list(process.env.GEMINI_FAST_MODELS, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]);
export const DEEP_MODELS = list(process.env.GEMINI_DEEP_MODELS, ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.8-flash"]);
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

/** Time-to-first-token budget per model attempt before falling back. */
const FIRST_TOKEN_MS = Number(process.env.GEMINI_FIRST_TOKEN_MS ?? 22_000);
/** Whole-call budget per attempt for non-streaming calls. */
const CALL_MS = Number(process.env.GEMINI_CALL_MS ?? 30_000);
/** Embedding batches sent concurrently (Gemini accepts up to 100 texts per call). */
const EMBED_BATCH = 100;
const EMBED_CONCURRENCY = 3;

export type Tier = "lite" | "fast" | "deep";

// One provider instance per process: avoids rebuilding HTTP config on every call.
let cachedProvider: { key: string; provider: GoogleProvider } | null = null;

function provider(): GoogleProvider {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new ApiRouteError(503, "MISSING_API_KEY", "The server has no Gemini API key. Add GEMINI_API_KEY to .env.local and restart.");
  }
  if (cachedProvider?.key !== key) cachedProvider = { key, provider: createGoogle({ apiKey: key }) };
  return cachedProvider.provider;
}

// ---------------------------------------------------------------------------
// Circuit breaker: a model that just failed (quota, overload, timeout, 404)
// is skipped for a cooldown instead of costing every request another
// 1-22 s round trip. If every model is cooling down, the full chain is tried.
// ---------------------------------------------------------------------------

const unavailableUntil = new Map<string, number>();

export function cooldownFor(error: string): number {
  if (/404|not found|no longer available/i.test(error)) return 10 * 60_000;
  if (/429|quota|exhausted/i.test(error)) return 60_000;
  if (/timeout|503|overload|high demand|unavailable/i.test(error)) return 30_000;
  return 0;
}

export function markModelFailure(id: string, error: string, now = Date.now()): void {
  const ms = cooldownFor(error);
  if (ms > 0) unavailableUntil.set(id, now + ms);
}

export function __resetModelHealth(): void {
  unavailableUntil.clear();
}

export function modelChain(tier: Tier, now = Date.now()): string[] {
  const chain = Array.from(new Set(tier === "deep" ? [...DEEP_MODELS, ...FAST_MODELS] : tier === "lite" ? LITE_MODELS : FAST_MODELS));
  const healthy = chain.filter((id) => (unavailableUntil.get(id) ?? 0) <= now);
  return healthy.length > 0 ? healthy : chain;
}

function attemptSignal(outer: AbortSignal | undefined, ms: number | null): { signal: AbortSignal; controller: AbortController } {
  const controller = new AbortController();
  const signals = [controller.signal];
  if (outer) signals.push(outer);
  if (ms !== null) signals.push(AbortSignal.timeout(ms));
  return { signal: AbortSignal.any(signals), controller };
}

class FirstTokenTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new FirstTokenTimeout(`no output within ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Test seam: integration tests swap in MockLanguageModelV4 / MockEmbeddingModelV4. */
type Overrides = {
  languageModel?: (id: string) => LanguageModel;
  embeddingModel?: EmbeddingModel;
};
let overrides: Overrides = {};
export function __setModelOverrides(o: Overrides): void {
  overrides = o;
}
function lm(id: string): LanguageModel {
  return overrides.languageModel ? overrides.languageModel(id) : provider()(id);
}

function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; message?: string };
    return `${e.statusCode ?? ""} ${e.message ?? ""}`.trim();
  }
  return String(err);
}

function upstreamError(errors: string[]): ApiRouteError {
  const timeout = errors.length > 0 && errors.every((e) => /timeout|abort/i.test(e));
  if (timeout) return new ApiRouteError(504, "AI_TIMEOUT", "The AI service is responding slowly right now. Try again in a moment.");
  const quota = errors.some((e) => /429|quota|exhausted/i.test(e));
  const overloaded = errors.some((e) => /503|overload|high demand|unavailable/i.test(e));
  if (quota) return new ApiRouteError(429, "AI_QUOTA", "The AI service is out of quota right now. Wait a minute and try again.");
  if (overloaded) return new ApiRouteError(503, "AI_BUSY", "The AI service is busy right now. Try again in a few seconds.");
  return new ApiRouteError(502, "AI_UPSTREAM", "The AI service returned an error. Try again.");
}

function logFailure(errors: string[]): void {
  // Model ids and status codes only: never prompts or document text.
  console.warn("[gemini] all models failed", errors.map((e) => e.slice(0, 160)));
}

/**
 * Structured streaming with model fallback: we read the stream until the
 * first JSON token arrives. If a model fails before producing anything
 * (quota, 404, overload, first-token timeout) the next model in the chain
 * is tried transparently. Once tokens flow we commit to that model.
 *
 * Returns a plain-text stream of the JSON being generated, which is what
 * the AI SDK's useObject() consumes on the client.
 */
export async function streamStructured<T extends z.ZodType>(opts: {
  tier: Tier;
  schema: T;
  prompt: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  const errors: string[] = [];
  for (const id of modelChain(opts.tier)) {
    if (opts.signal?.aborted) break;
    const { signal, controller } = attemptSignal(opts.signal, null);
    const result = streamText({
      model: lm(id),
      instructions: GUARDRAILS,
      prompt: opts.prompt,
      output: Output.object({ schema: opts.schema }),
      temperature: opts.temperature ?? 0.2,
      maxRetries: 0,
      abortSignal: signal,
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();
    let first: string | null = null;
    let failed = false;
    const deadline = Date.now() + FIRST_TOKEN_MS;
    try {
      while (true) {
        const next = await withTimeout(iterator.next(), Math.max(1, deadline - Date.now()));
        if (next.done) break;
        const part = next.value;
        if (part.type === "error") {
          errors.push(`${id}: ${describeError(part.error)}`);
          failed = true;
          break;
        }
        if (part.type === "text-delta" && part.text.length > 0) {
          first = part.text;
          break;
        }
      }
    } catch (err) {
      errors.push(`${id}: ${err instanceof FirstTokenTimeout ? "timeout" : describeError(err)}`);
      failed = true;
    }
    if (failed || first === null) {
      if (!failed) errors.push(`${id}: empty response`);
      markModelFailure(id, errors[errors.length - 1]);
      controller.abort();
      continue;
    }

    const encoder = new TextEncoder();
    const firstChunk = first;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(firstChunk));
      },
      async pull(c) {
        // Keep reading until something is enqueued: a pull() that resolves
        // without enqueuing is not re-invoked by the Streams machinery.
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              c.close();
              return;
            }
            const part = next.value;
            if (part.type === "text-delta" && part.text.length > 0) {
              c.enqueue(encoder.encode(part.text));
              return;
            }
            if (part.type === "error") {
              c.error(new Error("AI stream interrupted"));
              return;
            }
          }
        } catch {
          c.error(new Error("AI stream interrupted"));
        }
      },
      async cancel() {
        controller.abort();
        await iterator.return?.();
      },
    });
    return { stream, model: id };
  }
  logFailure(errors);
  throw upstreamError(errors);
}

export async function generateStructured<T extends z.ZodType>(opts: {
  tier: Tier;
  schema: T;
  prompt: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ object: z.infer<T>; model: string }> {
  const errors: string[] = [];
  for (const id of modelChain(opts.tier)) {
    if (opts.signal?.aborted) break;
    try {
      const { output } = await generateText({
        model: lm(id),
        instructions: GUARDRAILS,
        prompt: opts.prompt,
        output: Output.object({ schema: opts.schema }),
        temperature: opts.temperature ?? 0,
        maxRetries: 0,
        abortSignal: attemptSignal(opts.signal, CALL_MS).signal,
      });
      return { object: output as z.infer<T>, model: id };
    } catch (err) {
      errors.push(`${id}: ${describeError(err)}`);
      markModelFailure(id, errors[errors.length - 1]);
    }
  }
  logFailure(errors);
  throw upstreamError(errors);
}

// ---------------------------------------------------------------------------
// Embeddings (returned int8-quantised; see lib/vector.ts)
// ---------------------------------------------------------------------------

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function embeddingModel(): EmbeddingModel {
  return overrides.embeddingModel ?? provider().embedding(EMBEDDING_MODEL);
}

function embeddingOptions(taskType: TaskType) {
  return { google: { outputDimensionality: LIMITS.embeddingDims, taskType } };
}

/** Embeds documents in batches of 100, three batches in flight at a time. */
export async function embedDocuments(texts: string[], signal?: AbortSignal): Promise<string[]> {
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) batches.push(texts.slice(i, i + EMBED_BATCH));
  const results: string[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const { embeddings } = await embedMany({
        model: embeddingModel(),
        values: batches[index],
        providerOptions: embeddingOptions("RETRIEVAL_DOCUMENT"),
        maxRetries: 1,
        abortSignal: signal,
      });
      results[index] = embeddings.map(quantize);
    }
  };
  await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, batches.length) }, worker));
  return results.flat();
}

/** Query embedding as a unit float vector (full precision on the query side). */
export async function embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    providerOptions: embeddingOptions("RETRIEVAL_QUERY"),
    maxRetries: 1,
    abortSignal: signal,
  });
  return embedding;
}

// ---------------------------------------------------------------------------
// OCR fallback for scanned PDFs
// ---------------------------------------------------------------------------

export async function transcribePdf(bytes: Uint8Array, prompt: string, signal?: AbortSignal): Promise<string> {
  const errors: string[] = [];
  for (const id of modelChain("fast")) {
    if (signal?.aborted) break;
    try {
      const { text } = await generateText({
        model: lm(id),
        temperature: 0,
        maxRetries: 0,
        abortSignal: attemptSignal(signal, 50_000).signal,
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: bytes, mediaType: "application/pdf" },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      return text;
    } catch (err) {
      errors.push(`${id}: ${describeError(err)}`);
      markModelFailure(id, errors[errors.length - 1]);
    }
  }
  logFailure(errors);
  throw upstreamError(errors);
}
