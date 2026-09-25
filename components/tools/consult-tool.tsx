"use client";

import * as React from "react";
import { Briefcase, Download, Loader2, NotebookPen } from "lucide-react";
import type { ConsultItem, IngestedDocument } from "@/types/legal";
import { ConsultModelSchema, ConsultationSheetSchema, DISCLAIMER } from "@/types/legal";
import { verifyAndRepairCitation } from "@/lib/grounding";
import { toPayload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { CitationLink, ErrorNotice, GenAiStatus, SeverityBadge, SkeletonLines } from "@/components/panels/shared";
import { EmptyOutput, FieldLabel, ToolFrame, inputClass } from "./tool-frame";
import { useStructuredStream } from "./use-structured-stream";
import { ReadAloud, useRequestPreferences } from "@/components/preferences";

export function ConsultTool({ doc }: { doc: IngestedDocument }) {
  const { partial, final, run, stop, isLoading, errorMessage, model, state } = useStructuredStream("/api/consult", ConsultModelSchema);
  const [concerns, setConcerns] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const id = React.useId();
  const preferences = useRequestPreferences();

  const submit = () => run({ documentId: doc.documentId, document: toPayload(doc), concerns: concerns.trim() || undefined, preferences });

  const sheet = React.useMemo(() => {
    if (!final) return null;
    const parsed = ConsultationSheetSchema.safeParse({ ...final, items: final.items.slice(0, 10), disclaimer: DISCLAIMER });
    if (!parsed.success) return null;
    return { ...parsed.data, items: parsed.data.items.map((it) => ({ ...it, citation: verifyAndRepairCitation(it.citation, doc.pages) })) };
  }, [final, doc.pages]);

  const s = sheet ?? partial;
  const items = (s?.items ?? []).filter(Boolean) as Partial<ConsultItem>[];

  return (
    <ToolFrame
      title="Attorney consultation sheet"
      description="A one-page brief to take to a lawyer: the clauses worth discussing and the exact questions to ask."
      disclaimer={DISCLAIMER}
      controls={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2"
        >
          <FieldLabel htmlFor={id}>Your concerns (optional)</FieldLabel>
          <textarea
            id={id}
            rows={2}
            value={concerns}
            onChange={(e) => setConcerns(e.target.value)}
            maxLength={600}
            placeholder="e.g. I may start my own company next year"
            className={inputClass}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {sheet && (
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const { downloadConsultPdf } = await import("@/lib/consult-pdf");
                    await downloadConsultPdf(sheet, doc.name);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download PDF
              </Button>
            )}
            <Button type="submit" disabled={isLoading}>
              <NotebookPen aria-hidden /> {sheet ? "Generate again" : "Generate consultation sheet"}
            </Button>
          </div>
        </form>
      }
    >
      {state === "idle" && (
        <EmptyOutput icon={<Briefcase className="size-5" aria-hidden />}>
          <p>An hour with a lawyer goes further when you arrive with the right questions. Gemini picks the 5 to 10 clauses that matter most and drafts them.</p>
        </EmptyOutput>
      )}

      {state !== "idle" && (
        <div className="space-y-5">
          <GenAiStatus state={state} model={model} label="preparing your questions" onStop={stop} />
          {errorMessage && <ErrorNotice message={errorMessage} onRetry={submit} />}

          <article className="rounded-sheet border border-rule bg-sheet px-5 py-6 shadow-sheet sm:px-7" lang={preferences.language}>
            <header className="border-b border-rule pb-4">
              <p className="text-2xs font-semibold text-ink-soft">Consultation sheet</p>
              <h3 className="mt-1 font-serif text-2xl leading-tight">{s?.documentTitle ?? (isLoading ? "…" : doc.name)}</h3>
              {s?.situationSummary ? <p className="mt-2 text-sm leading-relaxed text-ink">{s.situationSummary}</p> : isLoading && <div className="mt-3"><SkeletonLines lines={2} /></div>}
              {sheet && (
                <div className="-ml-3 mt-1">
                  <ReadAloud
                    text={[sheet.situationSummary, ...sheet.items.flatMap((it, i) => [`${i + 1}. ${it.clauseTitle}.`, it.whyAsk, ...it.questions])].join(" ")}
                    label="Read sheet aloud"
                  />
                </div>
              )}
            </header>

            <ol className="divide-y divide-rule">
              {items.map((it, i) => (
                <li key={i} className="py-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-serif text-lg tabular-nums text-ink-soft">{i + 1}.</span>
                    <h4 className="flex-1 font-serif text-lg leading-snug">{it.clauseTitle}</h4>
                    <SeverityBadge severity={it.priority} />
                  </div>
                  {it.whyAsk && <p className="mt-1 text-sm leading-relaxed text-ink">{it.whyAsk}</p>}
                  {!!it.questions?.length && (
                    <ul className="mt-2 space-y-1.5">
                      {it.questions.filter(Boolean).map((q, j) => (
                        <li key={j} className="flex gap-2 text-sm">
                          <span className="mt-1 size-3.5 shrink-0 rounded-[3px] border border-ink/40" aria-hidden />
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sheet && it.citation && (
                    <div className="mt-2">
                      <CitationLink citation={it.citation} verified={"verified" in it.citation ? (it.citation as { verified: boolean }).verified : undefined} compact />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {isLoading && items.length === 0 && <SkeletonLines lines={5} />}

            {(!!s?.generalQuestions?.length || !!s?.documentsToBring?.length) && (
              <footer className="grid gap-5 border-t border-rule pt-4 sm:grid-cols-2">
                {!!s?.generalQuestions?.length && (
                  <section>
                    <h4 className="mb-1.5 font-sans text-sm font-bold">General questions</h4>
                    <ul className="space-y-1 text-sm">
                      {s.generalQuestions.filter(Boolean).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {!!s?.documentsToBring?.length && (
                  <section>
                    <h4 className="mb-1.5 font-sans text-sm font-bold">Bring to the meeting</h4>
                    <ul className="space-y-1 text-sm">
                      {s.documentsToBring.filter(Boolean).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </footer>
            )}
          </article>
        </div>
      )}
    </ToolFrame>
  );
}
