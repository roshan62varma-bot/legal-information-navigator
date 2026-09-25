"use client";

import * as React from "react";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, GitCompareArrows, Minus, MinusCircle, PencilLine, PlusCircle, RefreshCw } from "lucide-react";
import type { DiffAnnotation, DiffKind, DiffRow, IngestedDocument } from "@/types/legal";
import { CompareModelSchema, DISCLAIMER } from "@/types/legal";
import { diffDocuments } from "@/lib/diff";
import { toPayload } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorNotice, GenAiStatus, SeverityBadge, SkeletonLines, WithPiiTokens } from "@/components/panels/shared";
import { UploadZone } from "@/components/upload/upload-zone";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { EmptyOutput, ToolFrame } from "./tool-frame";
import { useStructuredStream } from "./use-structured-stream";
import { useRequestPreferences } from "@/components/preferences";

const KIND: Record<Exclude<DiffKind, "unchanged">, { label: string; icon: React.ReactNode; edge: string; tint: string; text: string }> = {
  added: { label: "Added", icon: <PlusCircle className="size-3.5" aria-hidden />, edge: "border-l-seal", tint: "bg-seal/[0.06]", text: "text-seal" },
  removed: { label: "Removed", icon: <MinusCircle className="size-3.5" aria-hidden />, edge: "border-l-redline", tint: "bg-redline/[0.05]", text: "text-redline" },
  modified: { label: "Modified", icon: <PencilLine className="size-3.5" aria-hidden />, edge: "border-l-amber", tint: "bg-amber/[0.06]", text: "text-amber" },
};

export function CompareTool({ doc }: { doc: IngestedDocument }) {
  const { secondary, setDocument, swapDocuments, focusCitation } = useWorkspace();
  const { partial, final, run, stop, isLoading, errorMessage, model, state } = useStructuredStream("/api/compare", CompareModelSchema);
  const [showUnchanged, setShowUnchanged] = React.useState(false);
  const preferences = useRequestPreferences();

  // Deterministic diff renders instantly; Gemini's annotations stream in by rowId.
  const diff = React.useMemo(() => (secondary ? diffDocuments(doc.pages, secondary.pages) : null), [doc.pages, secondary]);
  const annotations = React.useMemo(() => {
    const m = new Map<string, Partial<DiffAnnotation>>();
    const list = final?.annotations ?? partial?.annotations ?? [];
    for (const a of list) if (a?.rowId) m.set(a.rowId, a);
    return m;
  }, [final, partial]);

  const submit = () =>
    secondary &&
    run({ documentIdA: doc.documentId, documentIdB: secondary.documentId, documentA: toPayload(doc), documentB: toPayload(secondary), preferences });

  const rows = diff ? diff.rows.filter((r) => showUnchanged || r.kind !== "unchanged") : [];
  const riskTally = React.useMemo(() => {
    let more = 0;
    let less = 0;
    annotations.forEach((a) => {
      if (a.riskDelta === "MORE_RISK") more++;
      if (a.riskDelta === "LESS_RISK") less++;
    });
    return { more, less };
  }, [annotations]);

  return (
    <ToolFrame
      title="Compare two versions"
      description="Clause-by-clause differences between the original and a revised draft, with what each change means for you."
      disclaimer={DISCLAIMER}
      controls={
        secondary ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate">
                <span className="font-semibold">A</span> <span className="text-ink-soft">{doc.name}</span>
              </p>
              <p className="truncate">
                <span className="font-semibold">B</span> <span className="text-ink-soft">{secondary.name}</span>
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={swapDocuments} title="Make B the original and A the revision">
              <ArrowLeftRight aria-hidden /> Swap A and B
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDocument("secondary", null)}>
              <RefreshCw aria-hidden /> Replace B
            </Button>
            <Button onClick={submit} disabled={isLoading}>
              <GitCompareArrows aria-hidden /> {final ? "Explain again" : "Explain the changes"}
            </Button>
          </div>
        ) : (
          <UploadZone
            compact
            title="Add version B"
            hint="The revised or counterparty version, PDF or text"
            sampleId={/revised/i.test(doc.name) ? "standard" : "revised"}
            onReady={(d) => setDocument("secondary", d)}
          />
        )
      }
    >
      {!diff && (
        <EmptyOutput icon={<GitCompareArrows className="size-5" aria-hidden />}>
          <p>Your current document is version A. Add the other version above to see every added, removed and reworded clause.</p>
        </EmptyOutput>
      )}

      {diff && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Added" value={diff.stats.added} className="text-seal" />
            <Stat label="Removed" value={diff.stats.removed} className="text-redline" />
            <Stat label="Modified" value={diff.stats.modified} className="text-amber" />
            <Stat label="Unchanged" value={diff.stats.unchanged} className="text-ink-soft" />
          </dl>

          {state !== "idle" ? (
            <div className="space-y-3 rounded-control border border-rule bg-sheet p-4" lang={preferences.language}>
              <GenAiStatus state={state} model={model} label="explaining each change" onStop={stop} />
              {errorMessage && <ErrorNotice message={errorMessage} onRetry={submit} />}
              {partial?.verdict ? <p className="font-serif text-lg leading-relaxed">{partial.verdict}</p> : isLoading && <SkeletonLines lines={2} />}
              {(riskTally.more > 0 || riskTally.less > 0) && (
                <p className="text-xs text-ink-soft">
                  <span className="font-semibold text-redline">{riskTally.more} changes add risk</span> ·{" "}
                  <span className="font-semibold text-seal">{riskTally.less} reduce it</span>
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-control bg-highlight/15 p-3 text-sm">
              The diff below was computed on your device. Select <span className="font-semibold">Explain the changes</span> to have Gemini explain why each one matters.
            </p>
          )}

          <div className="flex items-center justify-between">
            <h3 className="font-sans text-sm font-bold">Risk-delta table</h3>
            <label className="flex items-center gap-2 text-xs text-ink-soft">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="accent-current" />
              Show unchanged clauses
            </label>
          </div>

          <ol className="space-y-3" aria-label="Clause changes">
            {rows.map((r) => (
              <DiffRowCard
                key={r.id}
                row={r}
                annotation={annotations.get(r.id)}
                pending={isLoading && r.kind !== "unchanged" && !annotations.get(r.id)}
                onShow={(slot) => {
                  const clause = slot === "primary" ? r.before : r.after;
                  if (clause) focusCitation({ page: clause.page, excerpt: clause.text.slice(0, 160) }, slot);
                }}
              />
            ))}
          </ol>
          {rows.length === 0 && <p className="text-sm text-ink-soft">No differences found between the two versions.</p>}
        </div>
      )}
    </ToolFrame>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-control border border-rule bg-sheet px-3 py-2">
      <dt className="text-2xs font-semibold text-ink-soft">{label}</dt>
      <dd className={cn("font-serif text-2xl tabular-nums", className)}>{value}</dd>
    </div>
  );
}

function DiffRowCard({
  row,
  annotation,
  pending,
  onShow,
}: {
  row: DiffRow;
  annotation: Partial<DiffAnnotation> | undefined;
  pending: boolean;
  onShow: (slot: "primary" | "secondary") => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (row.kind === "unchanged") {
    return (
      <li className="rounded-control border border-rule bg-sheet/50 px-4 py-2.5 text-sm text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <Minus className="size-3.5" aria-hidden /> Unchanged
        </span>
        <span className="ml-2 font-semibold text-ink">{row.heading}</span>
      </li>
    );
  }
  const k = KIND[row.kind];
  const body = row.kind === "removed" ? row.before?.text : row.after?.text;
  const long = (body?.length ?? 0) > 420 || (row.wordDiff?.reduce((n, d) => n + d.text.length, 0) ?? 0) > 420;

  return (
    <li className={cn("overflow-hidden rounded-control border border-rule border-l-4 bg-sheet", k.edge)}>
      <div className={cn("flex flex-wrap items-center gap-2 px-4 py-2.5", k.tint)}>
        <span className={cn("inline-flex items-center gap-1 text-xs font-bold", k.text)}>
          {k.icon} {k.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{row.heading}</span>
        {annotation?.riskDelta && <RiskDeltaBadge delta={annotation.riskDelta} />}
        {annotation?.severity && <SeverityBadge severity={annotation.severity} />}
      </div>

      <div className="px-4 py-3">
        <div className={cn("relative font-serif text-sm leading-relaxed", !expanded && long && "max-h-32 overflow-hidden")}>
          {row.kind === "modified" && row.wordDiff ? (
            <p>
              {row.wordDiff.map((d, i) =>
                d.op === "equal" ? (
                  <WithPiiTokens key={i} text={d.text} />
                ) : d.op === "delete" ? (
                  <del key={i} className="redline-strike mx-px rounded-[2px] bg-redline/10 px-0.5 text-redline">
                    <WithPiiTokens text={d.text} />
                  </del>
                ) : (
                  <ins key={i} className="mx-px rounded-[2px] bg-seal/15 px-0.5 text-seal decoration-seal decoration-2 underline-offset-2 [text-decoration-line:underline]">
                    <WithPiiTokens text={d.text} />
                  </ins>
                ),
              )}
            </p>
          ) : (
            <p className={row.kind === "removed" ? "redline-strike text-ink-soft" : "text-ink"}>
              <WithPiiTokens text={body ?? ""} />
            </p>
          )}
          {!expanded && long && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-sheet" aria-hidden />}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-2xs font-semibold">
          {long && (
            <button className="text-ink-soft hover:text-ink" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? "Show less" : "Show full clause"}
            </button>
          )}
          {row.before && (
            <button className="text-ink-soft hover:text-ink" onClick={() => onShow("primary")}>
              Show in version A (page {row.before.page})
            </button>
          )}
          {row.after && (
            <button className="text-ink-soft hover:text-ink" onClick={() => onShow("secondary")}>
              Show in version B (page {row.after.page})
            </button>
          )}
        </div>

        {(annotation?.whatChanged || pending) && (
          <div className="mt-3 space-y-1.5 rounded-control bg-ink/[0.04] p-3 text-sm">
            {annotation?.whatChanged ? (
              <>
                <p>
                  <span className="font-semibold">What changed: </span>
                  {annotation.whatChanged}
                </p>
                {annotation.whyItMatters && (
                  <p>
                    <span className="font-semibold">Why it matters: </span>
                    {annotation.whyItMatters}
                  </p>
                )}
              </>
            ) : (
              <SkeletonLines lines={2} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function RiskDeltaBadge({ delta }: { delta: DiffAnnotation["riskDelta"] }) {
  if (delta === "MORE_RISK")
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-redline/10 px-2 py-0.5 text-2xs font-bold text-redline">
        <ArrowUpRight className="size-3" aria-hidden /> More risk for you
      </span>
    );
  if (delta === "LESS_RISK")
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-seal/10 px-2 py-0.5 text-2xs font-bold text-seal">
        <ArrowDownRight className="size-3" aria-hidden /> Less risk for you
      </span>
    );
  return <span className="rounded-pill bg-ink/5 px-2 py-0.5 text-2xs font-bold text-ink-soft">Neutral</span>;
}
