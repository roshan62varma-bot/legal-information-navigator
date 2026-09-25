import { describe, expect, it } from "vitest";
import { diffDocuments, myersDiff, segmentClauses, wordDiff } from "@/lib/diff";
import { scanRedFlags } from "@/lib/heuristics";
import { paginateText } from "@/lib/ingestion";
import { SAMPLE_REVISED_NDA, SAMPLE_STANDARD_NDA } from "@/lib/samples";
import { EXPECTED_FLAGS, FIXTURE_NDA } from "./fixtures/nda";

describe("myersDiff", () => {
  const apply = (a: string[], ops: ReturnType<typeof myersDiff<string>>) => ops.filter((o) => o.op !== "delete").map((o) => o.value);
  const source = (ops: ReturnType<typeof myersDiff<string>>) => ops.filter((o) => o.op !== "insert").map((o) => o.value);

  it.each([
    ["ABCABBA", "CBABAC"],
    ["", "abc"],
    ["abc", ""],
    ["same", "same"],
    ["kitten", "sitting"],
  ])("produces a valid edit script from %s to %s", (a, b) => {
    const A = a.split("");
    const B = b.split("");
    const ops = myersDiff(A, B);
    expect(apply(A, ops)).toEqual(B);
    expect(source(ops)).toEqual(A);
  });

  it("finds the shortest edit script (D = 5 for the classic Myers example)", () => {
    const ops = myersDiff("ABCABBA".split(""), "CBABAC".split(""));
    expect(ops.filter((o) => o.op !== "equal").length).toBe(5);
  });

  it("diffs words inside a modified clause", () => {
    const d = wordDiff("lasts for one year", "lasts for five years");
    expect(d.some((x) => x.op === "delete" && x.text.includes("one"))).toBe(true);
    expect(d.some((x) => x.op === "insert" && x.text.includes("five"))).toBe(true);
  });
});

describe("clause diff between the sample NDAs", () => {
  const A = paginateText(SAMPLE_STANDARD_NDA);
  const B = paginateText(SAMPLE_REVISED_NDA);
  const { rows, stats } = diffDocuments(A, B);

  it("segments on numbered headings", () => {
    const clauses = segmentClauses(A, "a");
    expect(clauses.map((c) => c.heading)).toContain("5. Termination");
  });

  it("classifies added, removed, modified and unchanged clauses", () => {
    const byHeading = (h: string) => rows.find((r) => r.heading.includes(h));
    expect(byHeading("Non-Competition")?.kind).toBe("added");
    expect(byHeading("Liquidated Damages")?.kind).toBe("added");
    expect(byHeading("Purpose")?.kind).toBe("unchanged");
    expect(byHeading("Confidential Information")?.kind).toBe("modified");
    expect(rows.some((r) => r.kind === "removed")).toBe(true);
    expect(stats.added + stats.removed + stats.modified + stats.unchanged).toBe(rows.length);
  });

  it("attaches a word-level diff to modified rows", () => {
    for (const r of rows.filter((x) => x.kind === "modified")) {
      expect(r.wordDiff?.length).toBeGreaterThan(0);
      expect(r.before && r.after).toBeTruthy();
    }
  });
});

describe("red-flag precision on the fixture NDA", () => {
  const flags = scanRedFlags(paginateText(FIXTURE_NDA));

  it("detects all 5 known red flags at the correct severity", () => {
    for (const expected of EXPECTED_FLAGS) {
      const hit = flags.find((f) => f.flagType === expected.flagType);
      expect(hit, expected.flagType).toBeDefined();
      expect(hit!.severity, expected.flagType).toBe(expected.severity);
    }
  });

  it("reports no false positives on the benign clauses", () => {
    expect(flags.map((f) => f.flagType).sort()).toEqual(EXPECTED_FLAGS.map((f) => f.flagType).sort());
  });

  it("orders by severity and cites the clause and page", () => {
    expect(flags[0].severity).toBe("CRITICAL");
    const nc = flags.find((f) => f.flagType === "non_compete")!;
    expect(nc.clause).toMatch(/Non-Competition/);
    expect(nc.page).toBe(1);
    expect(nc.excerpt).toMatch(/anywhere in the world/);
  });

  it("finds the heavier issues in the revised sample NDA", () => {
    const sample = scanRedFlags(paginateText(SAMPLE_REVISED_NDA)).map((f) => f.flagType);
    for (const t of ["non_compete", "ip_assignment", "one_sided_indemnification", "third_party_data_sharing", "termination_for_convenience"]) {
      expect(sample).toContain(t);
    }
  });
});
