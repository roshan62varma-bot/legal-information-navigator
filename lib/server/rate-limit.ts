/**
 * In-memory sliding-window rate limiter (no Redis). Each key keeps the
 * timestamps of its requests inside the window. Per serverless instance,
 * which is the right trade-off for a stateless demo deployment.
 */

const hits = new Map<string, number[]>();
let lastSweep = 0;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastSweep > windowMs) sweep(windowMs, now);
  const cutoff = now - windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (list.length >= limit) {
    hits.set(key, list);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, list[0] + windowMs - now) };
  }
  list.push(now);
  hits.set(key, list);
  return { allowed: true, remaining: limit - list.length, retryAfterMs: 0 };
}

function sweep(windowMs: number, now: number): void {
  lastSweep = now;
  const cutoff = now - windowMs;
  for (const [k, list] of hits) {
    const live = list.filter((t) => t > cutoff);
    if (live.length === 0) hits.delete(k);
    else hits.set(k, live);
  }
}

export function __resetRateLimits(): void {
  hits.clear();
  lastSweep = 0;
}
