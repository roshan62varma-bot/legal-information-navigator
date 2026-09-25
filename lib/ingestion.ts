import type { DocumentChunk, Page, PiiCategory, PiiReport } from "@/types/legal";
import { LIMITS } from "@/types/legal";

/**
 * Isomorphic ingestion helpers: safe to import from the browser and from
 * route handlers. PDF byte parsing lives in lib/pdf-client.ts (browser) and
 * app/api/ingest (server fallback); embeddings live in lib/server/gemini.ts.
 */

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split pasted plain text into pseudo-pages of roughly `charsPerPage`, breaking on paragraphs. */
export function paginateText(text: string, charsPerPage = 3000): Page[] {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  const explicit = clean.split(/\f|\n?-{3,}\s*page\s*break\s*-{3,}\n?/i);
  const pages: Page[] = [];
  for (const block of explicit) {
    const paragraphs = block.split(/\n\n/);
    let current = "";
    for (const para of paragraphs) {
      if (current && current.length + para.length > charsPerPage) {
        pages.push({ page: pages.length + 1, text: current.trim() });
        current = "";
      }
      current += (current ? "\n\n" : "") + para;
    }
    if (current.trim()) pages.push({ page: pages.length + 1, text: current.trim() });
  }
  return pages.slice(0, LIMITS.maxPages);
}

// ---------------------------------------------------------------------------
// PII scrubber (runs in the browser before any network call)
// ---------------------------------------------------------------------------

type PiiRule = { category: PiiCategory; pattern: RegExp; group?: number; validate?: (m: string) => boolean };

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Horizontal whitespace only: a name never spans a line break.
const NAME = String.raw`[A-Z][a-z'’-]+(?:[ \t]+[A-Z]\.)?(?:[ \t]+[A-Z][a-z'’-]+){1,2}`;

// Order matters: the most specific patterns run first so a card number is not
// half-eaten by the phone rule.
const PII_RULES: PiiRule[] = [
  { category: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { category: "card", pattern: /\b(?:\d[ -]?){13,19}\b/g, validate: luhnValid },
  { category: "bankDetail", pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g },
  { category: "bankDetail", pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  {
    category: "bankDetail",
    pattern: /\b((?:account|a\/c|acct|routing|sort code|iban|swift|bic)(?:\s+(?:no\.?|number|#))?\s*[:#-]?\s*)([A-Z0-9][A-Z0-9 -]{5,32}[A-Z0-9])/gi,
    group: 2,
  },
  { category: "idNumber", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { category: "idNumber", pattern: /\b[2-9]\d{3}\s\d{4}\s\d{4}\b/g },
  { category: "idNumber", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  {
    category: "idNumber",
    pattern: /\b((?:passport|driver'?s? licen[cs]e|licen[cs]e|national id|tax id|ein|ssn|pan|aadhaar)(?:\s+(?:no\.?|number|#))?\s*[:#-]?\s*)([A-Z0-9][A-Z0-9-]{5,20})/gi,
    group: 2,
  },
  {
    category: "phone",
    pattern: /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}(?![\w-])/g,
    validate: (m) => m.replace(/\D/g, "").length >= 9,
  },
  { category: "phone", pattern: /(?<![\w-])\+\d{10,13}(?![\w-])/g },
  {
    category: "address",
    pattern: /\b\d{1,6}\s+(?:[A-Z][A-Za-z0-9.'-]*\s){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Parkway|Pkwy|Highway|Hwy|Nagar|Marg)\b\.?(?:,?\s*(?:Apt|Suite|Unit|Flat|#)\s*[\w-]+)?/g,
  },
  { category: "address", pattern: /\bP\.?\s?O\.?\s+Box\s+\d+\b/gi },
  // Names: titles, labelled fields, signature blocks, defined-party parentheticals.
  { category: "name", pattern: new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+(${NAME.replace("{1,2}", "{0,2}")})`, "g"), group: 1 },
  {
    category: "name",
    pattern: new RegExp(String.raw`\b((?:Name|Signed|Signature|By|Employee|Tenant|Landlord|Witness|Print Name|Attn|Attention)\s*:\s*)(${NAME})`, "g"),
    group: 2,
  },
  {
    category: "name",
    pattern: new RegExp(String.raw`(${NAME})(?=,?\s+(?:an individual|residing at|\(\s*(?:the\s+)?["“](?:Employee|Tenant|Contractor|Consultant|Recipient|Discloser|Borrower|Guarantor|Buyer|Seller|Licensee|Licensor)))`, "g"),
    group: 1,
  },
];

const TOKEN_PREFIX: Record<PiiCategory, string> = {
  name: "NAME",
  email: "EMAIL",
  phone: "PHONE",
  address: "ADDRESS",
  idNumber: "ID",
  bankDetail: "BANK",
  card: "CARD",
};

const NON_NAME_WORDS = new Set([
  "This Agreement",
  "The Company",
  "The Parties",
  "Effective Date",
  "Confidential Information",
  "Governing Law",
  "United States",
  "New York",
  "Receiving Party",
  "Disclosing Party",
]);

export type ScrubResult = { pages: Page[]; report: PiiReport };

/**
 * Replace PII with stable placeholder tokens ("[NAME_1]"). The same value
 * always maps to the same token across every page, so the model can still
 * reason about "who does what" without seeing who they are.
 */
export function scrubPII(pages: Page[]): ScrubResult {
  const tokenFor = new Map<string, string>();
  const counters: Record<PiiCategory, number> = {
    name: 0, email: 0, phone: 0, address: 0, idNumber: 0, bankDetail: 0, card: 0,
  };
  const samples: PiiReport["samples"] = [];

  const assign = (category: PiiCategory, value: string): string => {
    const key = `${category}:${value.trim().toLowerCase()}`;
    const existing = tokenFor.get(key);
    if (existing) return existing;
    if (category === "name") {
      // "Mr. Smith" and "John Smith" are the same person: share a token on surname match.
      const words = value.trim().toLowerCase().split(/\s+/);
      for (const [k, token] of Array.from(tokenFor.entries())) {
        if (!k.startsWith("name:")) continue;
        const other = k.slice(5).split(/\s+/);
        if (other[other.length - 1] === words[words.length - 1] && (other.length === 1 || words.length === 1)) {
          tokenFor.set(key, token);
          return token;
        }
      }
    }
    counters[category] += 1;
    const token = `[${TOKEN_PREFIX[category]}_${counters[category]}]`;
    tokenFor.set(key, token);
    if (samples.length < 12) samples.push({ category, token });
    return token;
  };

  const scrubbed = pages.map((p) => {
    let text = p.text;
    for (const rule of PII_RULES) {
      text = text.replace(rule.pattern, (...args: unknown[]) => {
        const match = args[0] as string;
        const target = rule.group ? (args[rule.group] as string | undefined) : match;
        if (!target || target.startsWith("[")) return match;
        if (rule.category === "name" && NON_NAME_WORDS.has(target.trim())) return match;
        if (rule.validate && !rule.validate(target)) return match;
        const token = assign(rule.category, target);
        return rule.group ? match.replace(target, token) : token;
      });
    }
    // Once a name has been learned from a labelled context, redact it everywhere.
    // Longest names first, so "John Smith" is replaced whole before "Smith" alone.
    const names = Array.from(tokenFor.entries()).sort((a, b) => b[0].length - a[0].length);
    for (const [key, token] of names) {
      if (!key.startsWith("name:")) continue;
      const value = key.slice(5);
      if (value.length < 4) continue;
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), token);
    }
    return { page: p.page, text };
  });

  const total = Object.values(counters).reduce((a, b) => a + b, 0);
  return { pages: scrubbed, report: { counts: counters, total, samples } };
}

export function describePiiReport(report: PiiReport): string {
  if (report.total === 0) return "No personal details detected";
  const labels: Record<PiiCategory, [string, string]> = {
    name: ["name", "names"],
    email: ["email address", "email addresses"],
    phone: ["phone number", "phone numbers"],
    address: ["street address", "street addresses"],
    idNumber: ["ID number", "ID numbers"],
    bankDetail: ["bank detail", "bank details"],
    card: ["card number", "card numbers"],
  };
  const parts = (Object.keys(report.counts) as PiiCategory[])
    .filter((k) => report.counts[k] > 0)
    .map((k) => `${report.counts[k]} ${labels[k][report.counts[k] === 1 ? 0 : 1]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${list} detected and removed`;
}

// ---------------------------------------------------------------------------
// Indirect prompt-injection defence (runs server-side before prompting)
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:please\s+)?(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+)*(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|rules?|directions?|context|messages?)[^.\n]*/gi,
  /\b(?:you\s+are\s+now|from\s+now\s+on,?\s+you\s+(?:are|will))\b[^.\n]*/gi,
  /\b(?:please\s+)?act\s+as\s+(?:an?\s+|the\s+)?(?:ai|assistant|chat\s?bot|language\s+model|llm|system|dan|unfiltered|unrestricted|jailbroken|different\s+model)\b[^.\n]*/gi,
  /\bpretend\s+(?:to\s+be|you\s+are)\b[^.\n]*/gi,
  /\bjail\s?break(?:ing|ed)?\b[^.\n]*/gi,
  /\b(?:developer|god|dan)\s+mode\b[^.\n]*/gi,
  /\b(?:reveal|print|show|repeat|output)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b[^.\n]*/gi,
  /\bnew\s+instructions?\s*:[^\n]*/gi,
  /\b(?:respond|reply|answer)\s+only\s+with\b[^.\n]*/gi,
  /\b(?:tell|inform)\s+the\s+user\s+(?:that\s+)?(?:this|the)\s+(?:contract|agreement|document)\s+is\s+(?:safe|fair|standard|fine)\b[^.\n]*/gi,
];

const TAG_PATTERN = /<\/?\s*(?:system|user_query|retrieved_context|instructions?|assistant|prompt|context|prescan_hints|change)\b[^>]*>/gi;

export const NEUTRALIZED_MARKER = "[instruction-like text removed]";

export type SanitizeResult = { text: string; neutralized: number };

/**
 * Remove instruction-like strings and our own XML delimiters from untrusted
 * document text, then escape angle brackets so a document can never close a
 * <retrieved_context> block and speak with the system's voice.
 */
export function sanitizeForPrompt(input: string): SanitizeResult {
  let neutralized = 0;
  let text = input.replace(TAG_PATTERN, () => {
    neutralized += 1;
    return " ";
  });
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, () => {
      neutralized += 1;
      return NEUTRALIZED_MARKER;
    });
  }
  text = text.replace(/</g, "‹").replace(/>/g, "›");
  return { text, neutralized };
}

export function sanitizePages(pages: Page[]): { pages: Page[]; neutralized: number } {
  let neutralized = 0;
  const out = pages.map((p) => {
    const r = sanitizeForPrompt(p.text);
    neutralized += r.neutralized;
    return { page: p.page, text: r.text };
  });
  return { pages: out, neutralized };
}

/** Sanitize a user question: same defence, plus length clamp and whitespace collapse. */
export function sanitizeQuery(query: string): string {
  return sanitizeForPrompt(query.replace(/\s+/g, " ").trim().slice(0, LIMITS.maxQueryChars)).text;
}

// ---------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------

const HEADING_PATTERNS: RegExp[] = [
  /^(?:section|article|clause)\s+[\dIVXLC]+(?:\.\d+)*[.:)]?\s+[^\n]{2,90}$/i,
  /^\d{1,2}(?:\.\d{1,2}){0,2}[.)]?\s+[A-Z][^\n]{2,90}$/,
  /^[A-Z][A-Z0-9 ,&'()/-]{3,80}$/,
  /^\(?[a-z]\)\s+[A-Z][^\n]{2,60}$/,
];

const RUN_IN_HEADING = /^(?:(?:section|article|clause)\s+)?\d+(?:\.\d+)*[.)]?\s+[A-Z][^.]{2,60}\.(?:\s|$)/i;

export function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 4) return false;
  // "3. Term. This Agreement shall..." is a run-in heading however long the clause body is.
  if (RUN_IN_HEADING.test(l)) return true;
  if (l.length > 100) return false;
  if (/^\d+(?:\.\d+)*[.)]?\s+[A-Z]/.test(l)) return l.split(/\s+/).length <= 14;
  return HEADING_PATTERNS.some((p) => p.test(l));
}

export function headingLabel(line: string): string {
  const l = line.trim();
  const lead = l.match(/^(\d+(?:\.\d+)*[.)]?\s+[A-Z][^.]{2,60})\./);
  const label = lead ? lead[1] : l;
  return label.length > 90 ? `${label.slice(0, 87)}...` : label;
}

// ---------------------------------------------------------------------------
// Chunking: sliding window, 512 tokens, 10% overlap, page + section metadata
// ---------------------------------------------------------------------------

export const CHUNK_TOKENS = 512;
export const CHUNK_OVERLAP = 0.1;
/** English legal prose averages ~1.33 tokens per word. */
const TOKENS_PER_WORD = 1.33;

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * TOKENS_PER_WORD);
}

type Word = { w: string; page: number; section: string };

export function chunkPages(
  pages: Page[],
  opts: { chunkTokens?: number; overlap?: number } = {},
): DocumentChunk[] {
  const chunkTokens = opts.chunkTokens ?? CHUNK_TOKENS;
  const overlap = opts.overlap ?? CHUNK_OVERLAP;
  const windowWords = Math.max(20, Math.floor(chunkTokens / TOKENS_PER_WORD));
  const stride = Math.max(1, Math.floor(windowWords * (1 - overlap)));

  const words: Word[] = [];
  let section = "Preamble";
  for (const p of pages) {
    for (const line of p.text.split("\n")) {
      if (isHeading(line)) section = headingLabel(line);
      for (const w of line.split(/\s+/)) if (w) words.push({ w, page: p.page, section });
    }
  }

  const chunks: DocumentChunk[] = [];
  for (let start = 0; start < words.length; start += stride) {
    const slice = words.slice(start, start + windowWords);
    if (slice.length === 0) break;
    // Drop a tiny tail that is already fully covered by the previous window's overlap.
    if (chunks.length > 0 && slice.length < windowWords * overlap) break;
    const text = slice.map((x) => x.w).join(" ");
    // Label the chunk with the section that dominates it, not whatever it starts in.
    const tally = new Map<string, number>();
    for (const x of slice) tally.set(x.section, (tally.get(x.section) ?? 0) + 1);
    const dominant = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
    chunks.push({
      id: `c${chunks.length + 1}`,
      page: slice[0].page,
      endPage: slice[slice.length - 1].page,
      section: dominant.slice(0, 200),
      text: text.slice(0, 8000),
      tokenEstimate: estimateTokens(text),
    });
    if (start + windowWords >= words.length) break;
    if (chunks.length >= LIMITS.maxChunks) break;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Content-addressed document id (same result in browser and Node)
// ---------------------------------------------------------------------------

export async function computeDocumentId(pages: Page[]): Promise<string> {
  const data = new TextEncoder().encode(pages.map((p) => `${p.page}\u0000${p.text}`).join("\u0001"));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `doc_${hex.slice(0, 32)}`;
}

export function totalChars(pages: Page[]): number {
  return pages.reduce((n, p) => n + p.text.length, 0);
}

/** Heuristic: fewer than ~40 characters per page means the PDF is scanned images. */
export function looksScanned(pages: Page[]): boolean {
  if (pages.length === 0) return true;
  return totalChars(pages) / pages.length < 40;
}

/** Split a Gemini OCR transcript on its <<<PAGE n>>> markers. */
export function splitTranscript(transcript: string): Page[] {
  const parts = transcript.split(/<<<\s*PAGE\s+(\d+)\s*>>>/i);
  const pages: Page[] = [];
  if (parts.length === 1) {
    const text = normalizeWhitespace(transcript);
    return text ? [{ page: 1, text }] : [];
  }
  for (let i = 1; i < parts.length; i += 2) {
    const text = normalizeWhitespace(parts[i + 1] ?? "");
    if (text) pages.push({ page: pages.length + 1, text: text.slice(0, 60_000) });
  }
  return pages.slice(0, LIMITS.maxPages);
}
