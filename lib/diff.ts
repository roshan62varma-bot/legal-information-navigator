import type { Clause, DiffKind, DiffRow, Page } from "@/types/legal";
import { headingLabel, isHeading } from "@/lib/ingestion";

/**
 * Clause-level contract diff.
 *
 * 1. Segment each document into clauses on headings.
 * 2. Myers O(ND) diff over the normalised clause sequences.
 * 3. Pair nearby delete+insert runs whose word-set similarity is high enough
 *    into "modified" rows, and run a second word-level Myers diff inside them.
 */

// ---------------------------------------------------------------------------
// Myers diff (generic)
// ---------------------------------------------------------------------------

export type EditOp<T> = { op: "equal" | "insert" | "delete"; value: T };

export function myersDiff<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean = Object.is): EditOp<T>[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // Backtrack through the saved V arrays.
  const ops: EditOp<T>[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ op: "equal", value: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ op: "insert", value: b[y - 1] });
      else ops.push({ op: "delete", value: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

// ---------------------------------------------------------------------------
// Clause segmentation
// ---------------------------------------------------------------------------

export function normalizeClause(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\s*(?:section|article|clause)?\s*[\dIVXivx]+(?:\.\d+)*[.)]?\s*/, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .trim();
}

export function segmentClauses(pages: readonly Page[], prefix: string): Clause[] {
  const clauses: Clause[] = [];
  let heading = "Preamble";
  let buf: string[] = [];
  let page = pages[0]?.page ?? 1;
  let startPage = page;

  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      clauses.push({
        id: `${prefix}${clauses.length + 1}`,
        heading,
        text,
        normalized: normalizeClause(`${text}`),
        page: startPage,
      });
    }
    buf = [];
  };

  for (const p of pages) {
    page = p.page;
    for (const line of p.text.split("\n")) {
      if (!line.trim()) continue;
      if (isHeading(line)) {
        flush();
        heading = headingLabel(line);
        startPage = page;
      }
      if (buf.length === 0) startPage = page;
      buf.push(line.trim());
    }
  }
  flush();
  return clauses;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function wordSet(s: string): Set<string> {
  return new Set(s.split(" ").filter((w) => w.length > 2));
}

/** Sørensen-Dice coefficient over word sets. */
export function similarity(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function headingKey(h: string): string {
  return normalizeClause(h).replace(/\s+/g, " ");
}

export function wordDiff(before: string, after: string): NonNullable<DiffRow["wordDiff"]> {
  const a = before.split(/(\s+)/).filter((t) => t.length > 0);
  const b = after.split(/(\s+)/).filter((t) => t.length > 0);
  const ops = myersDiff(a, b);
  const merged: NonNullable<DiffRow["wordDiff"]> = [];
  for (const o of ops) {
    const last = merged[merged.length - 1];
    if (last && last.op === o.op) last.text += o.value;
    else merged.push({ op: o.op, text: o.value });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Document diff
// ---------------------------------------------------------------------------

export const MODIFIED_THRESHOLD = 0.45;

export function diffDocuments(pagesA: readonly Page[], pagesB: readonly Page[]): { rows: DiffRow[]; stats: Record<DiffKind, number> } {
  const A = segmentClauses(pagesA, "a");
  const B = segmentClauses(pagesB, "b");
  const ops = myersDiff(A, B, (x, y) => x.normalized === y.normalized);

  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === "equal") {
      const before = ops[i].value;
      rows.push({ id: `r${rows.length + 1}`, kind: "unchanged", heading: before.heading, before, after: before, similarity: 1, wordDiff: null });
      i++;
      continue;
    }
    // Collect a run of consecutive deletes/inserts and pair them up.
    const deletes: Clause[] = [];
    const inserts: Clause[] = [];
    while (i < ops.length && ops[i].op !== "equal") {
      if (ops[i].op === "delete") deletes.push(ops[i].value);
      else inserts.push(ops[i].value);
      i++;
    }
    const usedInserts = new Set<number>();
    const pairs = new Map<number, number>();
    deletes.forEach((d, di) => {
      let best = -1;
      let bestScore = MODIFIED_THRESHOLD;
      inserts.forEach((ins, ii) => {
        if (usedInserts.has(ii)) return;
        const sameHeading = headingKey(d.heading) === headingKey(ins.heading) && d.heading !== "Preamble";
        const score = similarity(d.normalized, ins.normalized) + (sameHeading ? 0.25 : 0);
        if (score > bestScore) {
          best = ii;
          bestScore = score;
        }
      });
      if (best >= 0) {
        usedInserts.add(best);
        pairs.set(di, best);
      }
    });
    // Emit in document order: walk deletes, placing inserts that precede their partner.
    let nextInsert = 0;
    const emitInsertsUpTo = (limit: number) => {
      while (nextInsert < limit) {
        if (!usedInserts.has(nextInsert)) {
          const after = inserts[nextInsert];
          rows.push({ id: `r${rows.length + 1}`, kind: "added", heading: after.heading, before: null, after, similarity: 0, wordDiff: null });
        }
        nextInsert++;
      }
    };
    deletes.forEach((d, di) => {
      const partner = pairs.get(di);
      if (partner !== undefined) {
        emitInsertsUpTo(partner);
        const after = inserts[partner];
        rows.push({
          id: `r${rows.length + 1}`,
          kind: "modified",
          heading: after.heading,
          before: d,
          after,
          similarity: Number(similarity(d.normalized, after.normalized).toFixed(3)),
          wordDiff: wordDiff(d.text, after.text),
        });
        if (nextInsert === partner) nextInsert++;
      } else {
        rows.push({ id: `r${rows.length + 1}`, kind: "removed", heading: d.heading, before: d, after: null, similarity: 0, wordDiff: null });
      }
    });
    emitInsertsUpTo(inserts.length);
  }

  const stats: Record<DiffKind, number> = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const r of rows) stats[r.kind]++;
  return { rows, stats };
}
