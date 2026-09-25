"use client";

import * as React from "react";
import { Flag, Lightbulb, ScanSearch } from "lucide-react";
import type { IngestedDocument, RedFlag, Severity } from "@/types/legal";
import { DISCLAIMER, FLAG_LABELS, RedFlagModelSchema, RedFlagOutputSchema, SEVERITY_ORDER } from "@/types/legal";
import { heuristicRiskScore, scanRedFlags } from "@/lib/heuristics";
import { verifyAndRepairCitation } from "@/lib/grounding";
import { toPayload } from "@/lib/api-client";
import { cn, pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CitationLink, ErrorNotice, GenAiStatus, SeverityBadge, SkeletonLines } from "@/components/panels/shared";
import { EmptyOutput, FieldLabel, ToolFrame, inputClass } from "./tool-frame";
import { RiskGauge } from "./risk-gauge";
import { useStructuredStream } from "./use-structured-stream";
import { ReadAloud, useRequestPreferences } from "@/components/preferences";

const PERSPECTIVES = ["", "Employee", "Contractor or consultant", "Tenant", "Customer or user", "Recipient of confidential information", "Small business owner"];
const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function RedFlagsTool({ doc }: { doc: IngestedDocument }) {
  const { partial, final, run, stop, isLoading, errorMessage, model, state } = useStructuredStream("/api/redflags", RedFlagModelSchema);
  const [perspective, setPerspective] = React.useState("");
  const [filter, setFilter] = React.useState<Severity | "ALL">("ALL");
  const id = React.useId();

  const prescan = React.useMemo(() => scanRedFlags(doc.pages), [doc.pages]);
  const preferences = useRequestPreferences();
  const submit = () => run({ documentId: doc.documentId, document: toPayload(doc), perspective: perspective || undefined, preferences });

  const flags: Partial<RedFlag>[] = React.useMemo(() => {
    if (final) {
      const parsed = RedFlagOutputSchema.safeParse(final.flags);
      if (parsed.success) return [...parsed.data].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }
    return ((partial?.flags ?? []) as (Partial<RedFlag> | undefined)[]).filter((f): f is Partial<RedFlag> => !!f);
  }, [final, partial]);

  const counts = React.useMemo(() => {
    const c: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of flags) if (f.severity) c[f.severity]++;
    return c;
  }, [flags]);

  const visible = filter === "ALL" ? flags : flags.filter((f) => f.severity === filter);
  const showPrescan = isLoading && flags.length === 0;

  return (
    <ToolFrame
      title="Red flags"
      description="Clauses that could cost you money, lock you in, or take away rights, ranked by severity."
      disclaimer={DISCLAIMER}
      controls={
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex-1">
            <FieldLabel htmlFor={id}>I am signing as (optional)</FieldLabel>
            <select id={id} value={perspective} onChange={(e) => setPerspective(e.target.value)} className={inputClass}>
              {PERSPECTIVES.map((p) => (
                <option key={p} value={p}>
                  {p || "Not sure / general reader"}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={isLoading}>
            <Flag aria-hidden /> {final ? "Scan again" : "Scan for red flags"}
          </Button>
        </form>
      }
    >
      {state === "idle" && (
        <EmptyOutput icon={<Flag className="size-5" aria-hidden />}>
          <p>
            Gemini checks for one-sided indemnities, auto-renewals, non-competes, arbitration, IP assignment, liability caps, penalties, unilateral changes and
            data sharing.
          </p>
          {prescan.length > 0 && (
            <p className="font-semibold text-ink">
              A quick pattern scan already spotted {pluralize(prescan.length, "possible issue")}.
            </p>
          )}
        </EmptyOutput>
      )}

      {state !== "idle" && (
        <div className="space-y-5" lang={preferences.language}>
          <GenAiStatus state={state} model={model} label="reviewing every clause" onStop={stop} />
          {errorMessage && <ErrorNotice message={errorMessage} onRetry={submit} />}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-control border border-rule bg-sheet p-4">
            <RiskGauge
              score={partial?.overallRiskScore ?? (isLoading ? heuristicRiskScore(prescan) : undefined)}
              pending={partial?.overallRiskScore === undefined}
              label={partial?.overallRiskScore === undefined ? "Estimate from pattern scan" : "One-sidedness score from Gemini"}
            />
            {partial?.overallAssessment ? (
              <p className="max-w-xs flex-1 text-sm text-ink">{partial.overallAssessment}</p>
            ) : (
              <div className="max-w-xs flex-1">
                <SkeletonLines lines={2} />
              </div>
            )}
          </div>

          {flags.length > 0 && (
            <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
              <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")}>
                All {flags.length}
              </FilterChip>
              {SEVERITIES.map((sv) =>
                counts[sv] ? (
                  <FilterChip key={sv} active={filter === sv} onClick={() => setFilter(sv)}>
                    <SeverityBadge severity={sv} /> {counts[sv]}
                  </FilterChip>
                ) : null,
              )}
            </div>
          )}

          {showPrescan && (
            <section aria-label="Instant pattern scan" className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
                <ScanSearch className="size-4" aria-hidden /> Instant pattern scan, waiting for Gemini to confirm
              </p>
              {prescan.map((h) => (
                <div key={h.flagType} className="rounded-control border border-dashed border-rule bg-sheet/60 p-3 opacity-80">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={h.severity} />
                    <span className="text-sm font-semibold">{FLAG_LABELS[h.flagType]}</span>
                    <span className="ml-auto text-2xs text-ink-soft">page {h.page}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{h.reason}</p>
                </div>
              ))}
              {prescan.length === 0 && <SkeletonLines lines={4} />}
            </section>
          )}

          <ol className="space-y-3">
            {visible.map((f, i) => (
              <FlagCard key={`${f.flagType}-${i}`} flag={f} doc={doc} done={!!final} />
            ))}
          </ol>

          {final && flags.length === 0 && <p className="text-sm text-ink-soft">Gemini did not find clauses that stand out as risky. That is not a guarantee: read the whole document or ask an attorney.</p>}
          {final && (
            <p className="text-2xs text-ink-soft">
              Pattern scan suggested {prescan.length}; Gemini confirmed and reported {flags.length} after reading the full text.
            </p>
          )}
        </div>
      )}
    </ToolFrame>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors",
        active ? "border-ink bg-ink text-sheet" : "border-rule text-ink-soft hover:border-ink/40",
      )}
    >
      {children}
    </button>
  );
}

const EDGE: Record<Severity, string> = {
  CRITICAL: "border-l-sev-critical-fg",
  HIGH: "border-l-sev-high-fg",
  MEDIUM: "border-l-sev-medium-fg",
  LOW: "border-l-sev-low-fg",
};

function FlagCard({ flag, doc, done }: { flag: Partial<RedFlag>; doc: IngestedDocument; done: boolean }) {
  const citation = React.useMemo(() => {
    const c = flag.citation;
    if (!done || !c?.excerpt || !c.page) return null;
    return verifyAndRepairCitation({ page: c.page, clause: c.clause ?? "", excerpt: c.excerpt }, doc.pages);
  }, [done, flag.citation, doc.pages]);

  return (
    <li className={cn("rounded-control border border-rule border-l-4 bg-sheet p-4", flag.severity ? EDGE[flag.severity] : "border-l-rule")}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={flag.severity} />
        {flag.flagType && <span className="text-2xs font-semibold text-ink-soft">{FLAG_LABELS[flag.flagType]}</span>}
      </div>
      {flag.title && <h4 className="mt-2 font-serif text-lg leading-snug text-ink">{flag.title}</h4>}
      {flag.plainExplanation && <p className="mt-1 text-sm leading-relaxed text-ink">{flag.plainExplanation}</p>}
      {done && flag.plainExplanation && (
        <div className="-ml-3">
          <ReadAloud text={[flag.title, flag.plainExplanation, flag.recommendation].filter(Boolean).join(". ")} />
        </div>
      )}
      {flag.recommendation && (
        <p className="mt-3 flex gap-2 rounded-control bg-ink/[0.04] p-2.5 text-sm text-ink">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
          <span>
            <span className="font-semibold">Worth asking about: </span>
            {flag.recommendation}
          </span>
        </p>
      )}
      <div className="mt-3">
        {citation ? <CitationLink citation={citation} verified={citation.verified} /> : flag.citation?.page ? <CitationLink citation={flag.citation} compact /> : null}
      </div>
    </li>
  );
}
