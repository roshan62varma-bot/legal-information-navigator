import type { HeuristicFlag, Page, Severity } from "@/types/legal";
import { SEVERITY_ORDER } from "@/types/legal";
import { headingLabel, isHeading } from "@/lib/ingestion";

/**
 * Deterministic clause pre-scan. It runs instantly in the browser (so the
 * red-flag panel is never empty while Gemini thinks) and its hits are passed
 * to the model as hints that the model must confirm or reject against the text.
 */

type Rule = {
  flagType: HeuristicFlag["flagType"];
  base: Severity;
  match: RegExp;
  /** Escalate when the sentence also matches this. */
  escalate?: { when: RegExp; to: Severity; reason: string };
  reason: string;
};

const RULES: Rule[] = [
  {
    flagType: "non_compete",
    base: "HIGH",
    match: /\bnon[- ]?compet\w*|\bshall not\b[^.]{0,80}\b(?:compete|engage in any (?:business|activity) (?:that|which) competes|be employed by a competitor)/i,
    escalate: {
      when: /\b(?:worldwide|anywhere in the world|throughout the world|(?:[2-9]|\d{2})\s*(?:\(\w+\)\s*)?years?|(?:two|three|four|five|six|seven|ten)\s*(?:\(\d+\)\s*)?years?)\b/i,
      to: "CRITICAL",
      reason: "Restriction is worldwide or lasts two years or more",
    },
    reason: "Limits where you can work after the agreement ends",
  },
  {
    flagType: "auto_renewal",
    base: "HIGH",
    match: /\b(?:automatic(?:ally)?\s+renew\w*|auto[- ]?renew\w*|renew\w*\s+automatic\w*|successive\s+(?:renewal\s+)?(?:terms|periods)\s+unless)/i,
    reason: "Renews by default unless you cancel in time",
  },
  {
    flagType: "mandatory_arbitration",
    base: "MEDIUM",
    match: /\b(?:binding arbitration|(?:resolved|settled|determined)\s+(?:exclusively\s+|solely\s+)?by\s+(?:final\s+(?:and\s+)?(?:binding\s+)?)?arbitration|submit(?:ted)?\s+to\s+arbitration)/i,
    escalate: {
      when: /\b(?:class[- ]action|jury trial|right to a jury|waive\w*)\b/i,
      to: "HIGH",
      reason: "Also waives a jury trial or class action",
    },
    reason: "Disputes go to private arbitration instead of court",
  },
  {
    flagType: "liquidated_damages",
    base: "HIGH",
    match: /\bliquidated damages\b|\bpay\b[^.]{0,60}\b(?:penalty|a sum of|the sum of)\b[^.]{0,40}\bfor (?:each|every|any) (?:breach|violation)/i,
    reason: "Fixes a payment you owe on breach, regardless of actual loss",
  },
  {
    flagType: "unilateral_amendment",
    base: "HIGH",
    match: /\b(?:may|can|reserves? the right to)\s+(?:\w+\s+){0,3}(?:amend|modify|change|update|revise)\s+(?:this agreement|these terms|the terms|any terms|this contract|the agreement)[^.]{0,120}\b(?:at any time|sole discretion|without (?:prior )?notice|from time to time)/i,
    reason: "The other side can change the terms without your agreement",
  },
  {
    flagType: "one_sided_indemnification",
    base: "HIGH",
    match: /\b(?:employee|recipient|receiving party|contractor|consultant|tenant|customer|licensee|you|user|client|vendor|supplier)\s+(?:shall|will|agrees? to|must)\s+(?:\w+\s+){0,3}indemnif\w*/i,
    escalate: {
      when: /\b(?:any and all|all claims|including (?:reasonable )?attorneys?'? fees|regardless of|whether or not)\b/i,
      to: "CRITICAL",
      reason: "Covers any and all claims, not just ones you caused",
    },
    reason: "You cover the other side's losses and legal costs",
  },
  {
    flagType: "ip_assignment",
    base: "HIGH",
    match: /\b(?:hereby\s+)?(?:irrevocably\s+)?assigns?\b[^.]{0,80}\b(?:all\s+)?(?:right,?\s+title(?:,)?\s+and\s+interest|intellectual property|inventions|work product)/i,
    reason: "Ownership of what you create transfers to the other side",
  },
  {
    flagType: "liability_cap",
    base: "MEDIUM",
    match: /\b(?:limitation of liability|in no event shall\b[^.]{0,80}\bliable|(?:total|aggregate|maximum) liability\b[^.]{0,80}\b(?:shall not exceed|limited to|capped))/i,
    reason: "Caps how much you could recover if something goes wrong",
  },
  {
    flagType: "termination_for_convenience",
    base: "MEDIUM",
    match: /\bterminat\w*\b[^.]{0,80}\b(?:for convenience|for any reason(?: or no reason)?|without cause|at (?:its|their) (?:sole )?discretion)/i,
    reason: "The agreement can be ended without any fault on your side",
  },
  {
    flagType: "third_party_data_sharing",
    base: "HIGH",
    match: /\b(?:share|disclose|sell|transfer|provide)\b[^.]{0,80}\b(?:personal|your|customer|user)?\s*(?:data|information)\b[^.]{0,80}\bthird[- ]part(?:y|ies)/i,
    reason: "Your information can be passed to outside companies",
  },
];

type Sentence = { text: string; page: number; clause: string };

export function splitSentences(pages: readonly Page[]): Sentence[] {
  const out: Sentence[] = [];
  let clause = "Preamble";
  for (const p of pages) {
    for (const line of p.text.split("\n")) {
      if (isHeading(line)) clause = headingLabel(line);
      const parts = line.match(/[^.;!?]+(?:[.;!?]+(?=\s|$)|$)/g) ?? [];
      for (const s of parts) {
        const t = s.trim();
        if (t.length > 12) out.push({ text: t, page: p.page, clause });
      }
    }
  }
  return out;
}

export function scanRedFlags(pages: readonly Page[]): HeuristicFlag[] {
  const found = new Map<string, HeuristicFlag>();
  for (const s of splitSentences(pages)) {
    for (const rule of RULES) {
      if (!rule.match.test(s.text)) continue;
      let severity = rule.base;
      let reason = rule.reason;
      if (rule.escalate && rule.escalate.when.test(s.text)) {
        severity = rule.escalate.to;
        reason = `${rule.reason}. ${rule.escalate.reason}`;
      }
      const flag: HeuristicFlag = {
        flagType: rule.flagType,
        severity,
        page: s.page,
        clause: s.clause,
        excerpt: s.text.length > 320 ? `${s.text.slice(0, 317)}...` : s.text,
        reason,
      };
      // Keep the most severe hit per flag type.
      const prev = found.get(rule.flagType);
      if (!prev || SEVERITY_ORDER[severity] < SEVERITY_ORDER[prev.severity]) found.set(rule.flagType, flag);
    }
  }
  return Array.from(found.values()).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Rough 0-100 score from the pre-scan, shown until the model's score arrives. */
export function heuristicRiskScore(flags: readonly HeuristicFlag[]): number {
  const weight: Record<Severity, number> = { CRITICAL: 30, HIGH: 16, MEDIUM: 8, LOW: 3 };
  return Math.min(100, flags.reduce((s, f) => s + weight[f.severity], 0));
}
