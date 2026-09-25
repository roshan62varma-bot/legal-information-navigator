# Security

Legal Information Navigator handles contracts that often contain personal and commercial details. The design goal is that **nothing sensitive leaves the browser that does not have to, nothing is stored, and nothing a client sends is trusted.**

## Threat model and controls

| Threat | Control | Where |
|---|---|---|
| Personal data sent to a third-party AI | PII (names, emails, phones, addresses, SSN/Aadhaar/PAN/passport, IBAN/IFSC/account, Luhn-valid cards) replaced with stable tokens **in the browser before any request** | `lib/ingestion.ts` `scrubPII`, `components/upload/use-ingest.ts` |
| Prompt injection hidden in a document ("ignore previous instructions…") | Instruction-like patterns and our own XML tags stripped; `< >` escaped so a document cannot close its `<retrieved_context>` block; model told all context is data | `sanitizeForPrompt`, `lib/prompts.ts` `GUARDRAILS` |
| Hallucinated or fabricated legal claims | Zod-validated structured output only; every citation re-checked against the document; Q&A answers without a verified quote are withheld | `lib/grounding.ts`, `lib/server/pipeline.ts` |
| Tampered document between requests | Document id is a SHA-256 content hash; every route recomputes it (409 on mismatch) | `assertDocumentId` in `lib/server/http.ts` |
| Forged retrieval index / injected chunk text | Chunk text is never accepted from the client (re-derived from hash-verified pages). Embeddings are HMAC-SHA256 signed at ingest and verified in constant time on every question (409 on mismatch) | `lib/server/signing.ts`, `loadIndex` |
| XSS | React escaping, no user HTML rendered; **nonce-based CSP with `'strict-dynamic'`** (no `'unsafe-inline'` or `'unsafe-eval'` for scripts in production), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` | `proxy.ts`, `lib/security.ts` |
| Other sites spending the API quota (CSRF-style abuse) | API accepts `POST` only and rejects cross-site requests (`Sec-Fetch-Site` / `Origin`) in the proxy before any work | `proxy.ts` `isCrossSiteRequest` |
| Oversized or malformed payloads (DoS) | Body read as a stream with a hard byte cap (works without `Content-Length`), strict UTF-8, `application/json` only, `.strict()` Zod schemas rejecting unknown keys, PDF magic-byte check, page/char/chunk limits | `readBodyLimited`, `types/legal.ts` |
| Abuse / cost blow-up | Sliding-window rate limits per client and route; per-attempt timeouts; circuit breaker for failing models | `lib/server/rate-limit.ts`, `lib/server/gemini.ts` |
| Secret exposure | `GEMINI_API_KEY` read only in `server-only` modules; never sent to the browser; errors are typed `{ error, code }` with no stack traces; logs contain model ids and status codes only, never document text | `lib/server/*` |
| Clickjacking, sniffing, cross-origin leaks | `X-Frame-Options: DENY`, `nosniff`, HSTS preload, COOP/CORP `same-origin`, `Origin-Agent-Cluster`, restrictive `Permissions-Policy`, `Referrer-Policy` | `next.config.mjs` |
| Vulnerable dependencies | `npm audit` reports **0 vulnerabilities**; CI fails on any moderate+ advisory; Dependabot weekly updates | `.github/workflows/ci.yml`, `.github/dependabot.yml` |

## Data handling

* No database, no file storage, no analytics. Each request is processed in memory and discarded.
* Scanned PDFs are the one case where the raw file must leave the browser (for OCR); the user is asked for explicit consent first, and PII is scrubbed from the transcript before any analysis.
* Reader preferences (language, reading level, text size, theme) live only in the browser's `localStorage`.

## Verification

```bash
npm run lint && npm run typecheck && npm test && npm audit --audit-level=moderate
```

`__tests__/security-efficiency.test.ts` covers the CSP, cross-site guard, streamed body cap, media-type and UTF-8 checks, strict schemas, HMAC index signing and tamper detection; `ingestion.test.ts` covers PII scrubbing and injection neutralisation; `pipeline.integration.test.ts` proves forged indexes are rejected and injected text never reaches the model.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
