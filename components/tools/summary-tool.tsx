"use client";

import * as React from "react";
import { BookText, CalendarClock, CheckSquare, Gavel, Hourglass, Signpost, Users } from "lucide-react";
import type { IngestedDocument } from "@/types/legal";
import { DISCLAIMER, SummaryModelSchema, SummaryOutputSchema } from "@/types/legal";
import { verifyCitations } from "@/lib/grounding";
import { toPayload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { CitationLink, ErrorNotice, GenAiStatus, SectionHeading, SkeletonLines, StreamingCaret } from "@/components/panels/shared";
import { EmptyOutput, FieldLabel, ToolFrame, inputClass } from "./tool-frame";
import { useStructuredStream } from "./use-structured-stream";
import { ReadAloud, useRequestPreferences } from "@/components/preferences";

export function SummaryTool({ doc }: { doc: IngestedDocument }) {
  const { partial, final, run, stop, isLoading, errorMessage, model, state } = useStructuredStream("/api/summarize", SummaryModelSchema);
  const [focus, setFocus] = React.useState("");
  const id = React.useId();
  const preferences = useRequestPreferences();

  const submit = () => run({ documentId: doc.documentId, document: toPayload(doc), focus: focus.trim() || undefined, preferences });

  // Validate the finished object into the public SummaryOutput shape (disclaimer attached by us, not the model).
  const output = React.useMemo(() => {
    if (!final) return null;
    const parsed = SummaryOutputSchema.safeParse({ ...final, disclaimer: DISCLAIMER });
    return parsed.success ? parsed.data : null;
  }, [final]);
  const citations = React.useMemo(() => (output ? verifyCitations(output.citations, doc.pages) : null), [output, doc.pages]);
  const s = output ?? partial;

  return (
    <ToolFrame
      title="Plain-English summary"
      description="What this document is, what it asks of you, and what it gives you, with page references."
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
            <FieldLabel htmlFor={id}>Anything to focus on? (optional)</FieldLabel>
            <input id={id} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300} placeholder="e.g. how I can end this agreement" className={inputClass} />
          </div>
          <Button type="submit" disabled={isLoading}>
            <BookText aria-hidden /> {output ? "Summarize again" : "Summarize document"}
          </Button>
        </form>
      }
    >
      {state === "idle" && (
        <EmptyOutput icon={<BookText className="size-5" aria-hidden />}>
          <p>Gemini will read every page and explain it in plain English. Each statement links back to the clause it came from.</p>
        </EmptyOutput>
      )}

      {state !== "idle" && (
        <div className="space-y-6" lang={preferences.language}>
          <GenAiStatus state={state} model={model} label="reading your document" onStop={stop} />
          {errorMessage && <ErrorNotice message={errorMessage} onRetry={submit} />}

          {(s?.documentType || s?.parties?.length) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {s?.documentType && <span className="rounded-pill bg-ink px-2.5 py-1 font-semibold text-sheet">{s.documentType}</span>}
              {s?.parties?.filter(Boolean).map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-pill bg-ink/5 px-2.5 py-1 text-ink-soft">
                  <Users className="size-3" aria-hidden />
                  {p}
                </span>
              ))}
            </div>
          )}

          <section aria-labelledby="tldr">
            <h3 id="tldr" className="sr-only">
              In short
            </h3>
            {s?.tldr ? (
              <>
                <p className="max-w-prose font-serif text-lg leading-relaxed text-ink sm:text-xl">
                  {s.tldr}
                  <StreamingCaret show={isLoading && !s.keyObligations?.length} />
                </p>
                {output && (
                  <div className="mt-1 -ml-3">
                    <ReadAloud
                      text={[output.tldr, "What you must do.", ...output.keyObligations, "What you are entitled to.", ...output.keyRights].join(" ")}
                      label="Read summary aloud"
                    />
                  </div>
                )}
              </>
            ) : (
              isLoading && <SkeletonLines lines={3} />
            )}
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <ListBlock title="What you must do" items={s?.keyObligations} tone="ink" loading={isLoading} />
            <ListBlock title="What you are entitled to" items={s?.keyRights} tone="seal" loading={isLoading} />
          </div>

          {(s?.duration !== undefined || s?.governingLaw !== undefined) && (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact icon={<Hourglass className="size-4" aria-hidden />} label="How long it lasts" value={s?.duration} />
              <Fact icon={<Gavel className="size-4" aria-hidden />} label="Governing law" value={s?.governingLaw} />
            </dl>
          )}

          {!!s?.keyDates?.length && (
            <section>
              <SectionHeading>
                <CalendarClock className="size-4 self-center" aria-hidden /> Dates and deadlines
              </SectionHeading>
              <ul className="divide-y divide-rule rounded-control border border-rule bg-sheet">
                {s.keyDates.map((d, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-ink-soft">{d?.label}</span>
                    <span className="font-semibold text-ink">{d?.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!s?.options?.length && (
            <section>
              <SectionHeading>
                <Signpost className="size-4 self-center" aria-hidden /> Your options
              </SectionHeading>
              <ul className="grid gap-2 sm:grid-cols-2">
                {s.options.map((o, i) =>
                  o?.option ? (
                    <li key={i} className="rounded-control border border-rule bg-sheet px-3 py-2.5 text-sm">
                      <span className="block font-semibold text-ink">{o.option}</span>
                      {o.whatItMeans && <span className="text-ink-soft">{o.whatItMeans}</span>}
                    </li>
                  ) : null,
                )}
              </ul>
              <p className="mt-1.5 text-2xs text-ink-soft">These are possibilities to discuss, not recommendations.</p>
            </section>
          )}

          {!!s?.checklist?.length && (
            <section>
              <SectionHeading>
                <CheckSquare className="size-4 self-center" aria-hidden /> Before you sign
              </SectionHeading>
              <ul className="space-y-1.5">
                {s.checklist.filter(Boolean).map((c, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer gap-2.5 text-sm leading-relaxed text-ink">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-current" />
                      <span>{c}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {citations && citations.length > 0 && (
            <section>
              <SectionHeading count={citations.length}>Where this comes from</SectionHeading>
              <div className="space-y-2">
                {citations.map((c, i) => (
                  <CitationLink key={i} citation={c} verified={c.verified} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </ToolFrame>
  );
}

function ListBlock({ title, items, tone, loading }: { title: string; items: (string | undefined)[] | undefined; tone: "ink" | "seal"; loading: boolean }) {
  const list = (items ?? []).filter((x): x is string => !!x);
  if (!list.length && !loading) return null;
  return (
    <section>
      <SectionHeading count={list.length || undefined}>{title}</SectionHeading>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
              <span className={tone === "seal" ? "mt-2 size-1.5 shrink-0 rounded-pill bg-seal" : "mt-2 size-1.5 shrink-0 rounded-pill bg-ink"} aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <SkeletonLines lines={3} />
      )}
    </section>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 rounded-control border border-rule bg-sheet px-3 py-2.5">
      <span className="mt-0.5 text-ink-soft">{icon}</span>
      <div>
        <dt className="text-2xs font-semibold text-ink-soft">{label}</dt>
        <dd className="text-sm text-ink">{value === undefined ? "…" : value ?? "Not stated in the document"}</dd>
      </div>
    </div>
  );
}
