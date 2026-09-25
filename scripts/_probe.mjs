import { readFileSync } from "node:fs";
const base = "http://localhost:3100";
const src = readFileSync(new URL("../lib/samples.ts", import.meta.url), "utf8");
const k = "export const SAMPLE_REVISED_NDA = `"; const i = src.indexOf(k) + k.length; const text = src.slice(i, src.indexOf("`;", i));
const ing = await (await fetch(base + "/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "t", source: "text", pages: [{ page: 1, text }] }) })).json();
const route = process.argv[2] ?? "consult";
const t = Date.now();
const res = await fetch(base + "/api/" + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: ing.documentId, document: { documentId: ing.documentId, name: "t", pages: ing.pages } }) });
console.log("status", res.status, "model", res.headers.get("x-model"), Date.now() - t, "ms to headers");
const reader = res.body.getReader(); const dec = new TextDecoder(); let n = 0, total = "", last = Date.now();
while (true) { const { value, done } = await reader.read(); if (done) break; n++; total += dec.decode(value); const gap = Date.now() - last; last = Date.now(); if (gap > 3000 || n % 40 === 0) console.log(`chunk ${n} @${Date.now() - t}ms gap=${gap} len=${total.length}`); }
console.log("done", n, "chunks", Date.now() - t, "ms, len", total.length, "tail:", total.slice(-120));
