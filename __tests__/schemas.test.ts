import { describe, expect, it } from "vitest";
import {
  AnswerModelSchema,
  AskRequestSchema,
  CompareModelSchema,
  ConsultationSheetSchema,
  DISCLAIMER,
  DocumentChunkSchema,
  GroundedAnswerSchema,
  QA_DISCLAIMER,
  RedFlagModelSchema,
  RedFlagOutputSchema,
  SummaryOutputSchema,
} from "@/types/legal";

const citation = { page: 2, clause: "4. Non-Competition", excerpt: "shall not engage in any business that competes" };

const summary = {
  documentType: "Mutual NDA",
  parties: ["Company", "Consultant"],
  tldr: "A confidentiality agreement.",
  keyObligations: ["Keep information secret."],
  keyRights: ["Get information back."],
  duration: "1 year",
  governingLaw: null,
  keyDates: [{ label: "Notice", value: "90 days" }],
  options: [{ option: "Ask to narrow the non-compete", whatItMeans: "Request a shorter or local restriction." }],
  checklist: ["Confirm the renewal notice date."],
  citations: [citation],
  disclaimer: DISCLAIMER,
};

describe("SummaryOutputSchema", () => {
  it("accepts a well-formed summary", () => {
    expect(SummaryOutputSchema.safeParse(summary).success).toBe(true);
  });
  it("requires the exact fixed disclaimer, never model-written text", () => {
    expect(SummaryOutputSchema.safeParse({ ...summary, disclaimer: "This is legal advice." }).success).toBe(false);
    expect(SummaryOutputSchema.safeParse({ ...summary, disclaimer: undefined }).success).toBe(false);
  });
  it("rejects an empty tldr and wrong types", () => {
    expect(SummaryOutputSchema.safeParse({ ...summary, tldr: "" }).success).toBe(false);
    expect(SummaryOutputSchema.safeParse({ ...summary, keyRights: "none" }).success).toBe(false);
  });
  it("rejects citations with a non-positive page", () => {
    expect(SummaryOutputSchema.safeParse({ ...summary, citations: [{ ...citation, page: 0 }] }).success).toBe(false);
  });
});

describe("RedFlag schemas", () => {
  const flag = {
    severity: "HIGH",
    flagType: "auto_renewal",
    title: "Renews automatically",
    plainExplanation: "It keeps going unless you cancel.",
    recommendation: "Ask for a reminder.",
    citation,
  };
  it("accepts the documented RedFlagOutput array shape", () => {
    expect(RedFlagOutputSchema.safeParse([flag]).success).toBe(true);
  });
  it("rejects unknown severities and flag types", () => {
    expect(RedFlagOutputSchema.safeParse([{ ...flag, severity: "SEVERE" }]).success).toBe(false);
    expect(RedFlagOutputSchema.safeParse([{ ...flag, flagType: "bad_vibes" }]).success).toBe(false);
  });
  it("bounds the overall risk score to 0-100", () => {
    expect(RedFlagModelSchema.safeParse({ overallRiskScore: 101, overallAssessment: "x", flags: [] }).success).toBe(false);
    expect(RedFlagModelSchema.safeParse({ overallRiskScore: 64, overallAssessment: "x", flags: [flag] }).success).toBe(true);
  });
});

describe("Compare, answer and consultation schemas", () => {
  it("validates diff annotations", () => {
    const ok = { verdict: "Worse.", annotations: [{ rowId: "r3", whatChanged: "a", whyItMatters: "b", riskDelta: "MORE_RISK", severity: "HIGH" }] };
    expect(CompareModelSchema.safeParse(ok).success).toBe(true);
    expect(CompareModelSchema.safeParse({ ...ok, annotations: [{ ...ok.annotations[0], riskDelta: "WORSE" }] }).success).toBe(false);
  });

  it("validates the model's answer and the grounded answer envelope", () => {
    expect(AnswerModelSchema.safeParse({ answerable: true, answer: "Yes.", citations: [citation], confidence: "high", followUps: [] }).success).toBe(true);
    const grounded = {
      status: "answered",
      answer: "Yes.",
      refusalReason: null,
      citations: [{ ...citation, verified: true }],
      confidence: "high",
      followUps: [],
      faithfulness: { verifiedCitations: 1, totalCitations: 1, passed: true },
      retrieved: [],
      disclaimer: QA_DISCLAIMER,
    };
    expect(GroundedAnswerSchema.safeParse(grounded).success).toBe(true);
    expect(GroundedAnswerSchema.safeParse({ ...grounded, disclaimer: DISCLAIMER }).success).toBe(false);
  });

  it("caps the consultation sheet at 10 items and requires at least one", () => {
    const item = { clauseTitle: "Non-compete", priority: "CRITICAL", whyAsk: "Broad.", questions: ["Is it enforceable?"], citation };
    const sheet = { documentTitle: "NDA", situationSummary: "s", items: [item], documentsToBring: [], generalQuestions: [], disclaimer: DISCLAIMER };
    expect(ConsultationSheetSchema.safeParse(sheet).success).toBe(true);
    expect(ConsultationSheetSchema.safeParse({ ...sheet, items: [] }).success).toBe(false);
    expect(ConsultationSheetSchema.safeParse({ ...sheet, items: Array(11).fill(item) }).success).toBe(false);
  });
});

describe("Request schemas treat unknown input defensively", () => {
  it("chunks carry no client-supplied embeddings", () => {
    const chunk = { id: "c1", page: 1, endPage: 1, section: "s", text: "t", tokenEstimate: 1 };
    expect(DocumentChunkSchema.safeParse(chunk).success).toBe(true);
    expect(DocumentChunkSchema.safeParse({ ...chunk, page: 0 }).success).toBe(false);
  });
  it("rejects malformed document ids and too-short questions", () => {
    const base = {
      documentId: "doc_0123456789abcdef",
      document: { documentId: "doc_0123456789abcdef", name: "a", pages: [{ page: 1, text: "x" }] },
      index: null,
      query: "What is the term?",
    };
    expect(AskRequestSchema.safeParse(base).success).toBe(true);
    expect(AskRequestSchema.safeParse({ ...base, query: "hi" }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ...base, documentId: "../../etc/passwd" }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ...base, document: { ...base.document, documentId: "../../etc/passwd" } }).success).toBe(false);
  });
});

describe("prompt output style (language and reading level)", async () => {
  const { styleBlock, summarizePrompt } = await import("@/lib/prompts");
  it("defaults to plain English", () => {
    expect(styleBlock()).toMatch(/English/);
    expect(styleBlock()).toMatch(/grade-8/);
  });
  it("asks for the chosen language but keeps quotes verbatim", () => {
    const s = styleBlock({ language: "hi", readingLevel: "simple" });
    expect(s).toMatch(/Hindi/);
    expect(s).toMatch(/verbatim/);
    expect(s).toMatch(/grade-5/);
  });
  it("threads preferences into the summary prompt and requests options and a checklist", () => {
    const p = summarizePrompt([{ page: 1, text: "1. Term. One year." }], undefined, { language: "es", readingLevel: "detailed" });
    expect(p).toMatch(/<output_style>[\s\S]*Spanish/);
    expect(p).toMatch(/options:/);
    expect(p).toMatch(/checklist:/);
  });
});
