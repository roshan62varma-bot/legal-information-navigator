import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embed, embedMany, generateObject, streamObject, type LanguageModelV1 } from "ai";
import type { z } from "zod";
import { LIMITS } from "@/types/legal";
import { GUARDRAILS } from "@/lib/prompts";
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

export type Tier = "lite" | "fast" | "deep";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new ApiRouteError(503, "MISSING_API_KEY", "The server has no Gemini API key. Add GEMINI_API_KEY to .env.local and restart.");
  }
  return key;
}

function provider() {
  return createGoogleGenerativeAI({ apiKey: apiKey() });
}

export function modelChain(tier: Tier): string[] {
  const chain = tier === "deep" ? [...DEEP_MODELS, ...FAST_MODELS] : tier === "lite" ? LITE_MODELS : FAST_MODELS;
  return Array.from(new Set(chain));
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

function languageModel(id: string): LanguageModelV1 {
  return provider()(id, { structuredOutputs: true });
}

/** Test seam: integration tests swap in MockLanguageModelV1 / MockEmbeddingModelV1. */
type Overrides = {
  languageModel?: (id: string) => LanguageModelV1;
  embeddingModel?: Parameters<typeof embedMany>[0]["model"];
};
let overrides: Overrides = {};
export function __setModelOverrides(o: Overrides): void {
  overrides = o;
}
function lm(id: string): LanguageModelV1 {
  return overrides.languageModel ? overrides.languageModel(id) : languageModel(id);
}

function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; message?: string; responseBody?: string };
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

/**
 * streamObject with model fallback: we read the stream until the first
 * content arrives. If a model fails before producing anything (quota, 404,
 * overload) we transparently try the next model in the chain. Once tokens
 * are flowing we commit to that model.
 *
 * Returns a plain-text stream of the JSON being generated, which is exactly
 * what the AI SDK's useObject() consumes on the client.
 */
export async function streamStructured<T extends z.ZodTypeAny>(opts: {
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
    const result = streamObject({
      model: lm(id),
      schema: opts.schema,
      system: GUARDRAILS,
      prompt: opts.prompt,
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
        if (part.type === "text-delta" && part.textDelta.length > 0) {
          first = part.textDelta;
          break;
        }
      }
    } catch (err) {
      errors.push(`${id}: ${err instanceof FirstTokenTimeout ? "timeout" : describeError(err)}`);
      failed = true;
      controller.abort();
    }
    if (failed || first === null) {
      if (!failed) errors.push(`${id}: empty response`);
      continue;
    }

    const encoder = new TextEncoder();
    const firstChunk = first;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
      },
      async pull(controller) {
        // Keep reading until we enqueue something: a pull() that resolves without
        // enqueuing is not re-invoked by the Streams machinery, so skipping the
        // interleaved "object" parts must happen inside this loop.
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              controller.close();
              return;
            }
            const part = next.value;
            if (part.type === "text-delta" && part.textDelta.length > 0) {
              controller.enqueue(encoder.encode(part.textDelta));
              return;
            }
            if (part.type === "error") {
              controller.error(new Error("AI stream interrupted"));
              return;
            }
          }
        } catch {
          controller.error(new Error("AI stream interrupted"));
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    return { stream, model: id };
  }
  console.warn("[gemini] all models failed", errors.map((e) => e.slice(0, 200)));
  throw upstreamError(errors);
}

export async function generateStructured<T extends z.ZodTypeAny>(opts: {
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
      const { object } = await generateObject({
        model: lm(id),
        schema: opts.schema,
        system: GUARDRAILS,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0,
        maxRetries: 0,
        abortSignal: attemptSignal(opts.signal, CALL_MS).signal,
      });
      return { object: object as z.infer<T>, model: id };
    } catch (err) {
      errors.push(`${id}: ${describeError(err)}`);
    }
  }
  console.warn("[gemini] all models failed", errors.map((e) => e.slice(0, 200)));
  throw upstreamError(errors);
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

function embeddingModel(taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  if (overrides.embeddingModel) return overrides.embeddingModel;
  return provider().textEmbeddingModel(EMBEDDING_MODEL, {
    outputDimensionality: LIMITS.embeddingDims,
    taskType,
  });
}

/** L2-normalise and round: truncated (MRL) Gemini embeddings are not unit length, and rounding shrinks the payload the browser holds. */
export function compactVector(v: readonly number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel("RETRIEVAL_DOCUMENT"),
    values: texts,
    maxRetries: 1,
  });
  return embeddings.map(compactVector);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel("RETRIEVAL_QUERY"), value: text, maxRetries: 1 });
  return compactVector(embedding);
}

// ---------------------------------------------------------------------------
// OCR fallback for scanned PDFs
// ---------------------------------------------------------------------------

export async function transcribePdf(bytes: Uint8Array, prompt: string): Promise<string> {
  const { generateText } = await import("ai");
  const errors: string[] = [];
  for (const id of modelChain("fast")) {
    try {
      const { text } = await generateText({
        model: lm(id),
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(50_000),
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: bytes, mimeType: "application/pdf" },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      return text;
    } catch (err) {
      errors.push(`${id}: ${describeError(err)}`);
    }
  }
  throw upstreamError(errors);
}
