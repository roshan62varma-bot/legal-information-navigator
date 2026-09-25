// Live smoke test against a running server: node scripts/smoke.mjs [baseUrl]
import { readFileSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const src = readFileSync(new URL("../lib/samples.ts", import.meta.url), "utf8");
const grab = (name) => {
  const start = src.indexOf(`export const ${name} = \``) + `export const ${name} = \``.length;
  return src.slice(start, src.indexOf("`;", start));
};
const toPages = (t) => [{ page: 1, text: t }];

async function post(path, body) {
  const t = Date.now();
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t, model: res.headers.get("x-model"), text };
}

const ingest = async (name, text) => {
  const r = await post("/api/ingest", { name, pages: toPages(text), source: "text" });
  if (r.status !== 200) throw new Error(`ingest ${r.status} ${r.text}`);
  const j = JSON.parse(r.text);
  console.log(`ingest ${name}: ${r.ms}ms mode=${j.retrievalMode} chunks=${j.chunks.length} injections=${j.injectionsNeutralized}`);
  return { documentId: j.documentId, name, pages: j.pages, chunks: j.chunks };
};

const A = await ingest("Standard NDA", grab("SAMPLE_STANDARD_NDA"));
const B = await ingest("Revised NDA", grab("SAMPLE_REVISED_NDA"));
const payload = (d) => ({ documentId: d.documentId, name: d.name, pages: d.pages });
const which = process.argv[3] ?? "all";

const show = (label, r, pick) => {
  let parsed = null;
  try { parsed = JSON.parse(r.text); } catch {}
  console.log(`\n== ${label}: status=${r.status} ${r.ms}ms model=${r.model}`);
  console.log(parsed ? JSON.stringify(pick ? pick(parsed) : parsed, null, 1).slice(0, 1800) : r.text.slice(0, 1800));
};

if (which === "all" || which === "summarize") show("summarize", await post("/api/summarize", { documentId: B.documentId, document: payload(B) }), (j) => ({ tldr: j.tldr, obligations: j.keyObligations?.length, citations: j.citations }));
if (which === "all" || which === "redflags") show("redflags", await post("/api/redflags", { documentId: B.documentId, document: payload(B), perspective: "Contractor or consultant" }), (j) => ({ score: j.overallRiskScore, flags: j.flags?.map((f) => `${f.severity} ${f.flagType} p${f.citation?.page}: ${f.citation?.excerpt}`) }));
if (which === "all" || which === "compare") show("compare", await post("/api/compare", { documentIdA: A.documentId, documentIdB: B.documentId, documentA: payload(A), documentB: payload(B) }), (j) => ({ verdict: j.verdict, annotations: j.annotations?.map((a) => `${a.rowId} ${a.riskDelta} ${a.severity}: ${a.whatChanged}`) }));
if (which === "all" || which === "ask") {
  for (const q of ["How long does the non-compete last and where does it apply?", "What is the monthly rent?"]) {
    const r = await post("/api/ask", { documentId: B.documentId, document: payload(B), chunks: B.chunks, query: q });
    const events = r.text.trim().split("\n").map((l) => JSON.parse(l));
    const result = events.find((e) => e.type === "result")?.data;
    console.log(`\n== ask "${q}": status=${r.status} ${r.ms}ms stages=${events.filter((e) => e.type === "stage").map((e) => e.stage).join(">")}`);
    console.log(JSON.stringify(result ? { status: result.status, answer: result.answer, refusal: result.refusalReason, faith: result.faithfulness, cites: result.citations.map((c) => `p${c.page} ${c.verified} ${c.excerpt}`), top: result.retrieved.map((x) => `${x.id}:${x.rerankScore}`) } : events.at(-1), null, 1));
  }
}
if (which === "all" || which === "consult") show("consult", await post("/api/consult", { documentId: B.documentId, document: payload(B), concerns: "I may start my own analytics company next year" }), (j) => ({ title: j.documentTitle, items: j.items?.map((i) => `${i.priority} ${i.clauseTitle} (${i.questions?.length}q)`) }));

// Negative cases
show("bad request", await post("/api/summarize", { documentId: "nope" }));
show("tampered doc", await post("/api/summarize", { documentId: B.documentId, document: { ...payload(B), pages: [{ page: 1, text: "changed" }] } }));
