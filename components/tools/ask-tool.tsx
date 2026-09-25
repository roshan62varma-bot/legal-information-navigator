"use client";

import * as React from "react";
import { Ban, Check, ChevronDown, Loader2, MessageSquareText, SendHorizonal, ShieldCheck } from "lucide-react";
import type { AskEvent, GroundedAnswer, IngestedDocument, RetrievedChunk } from "@/types/legal";
import { DISCLAIMER, LIMITS } from "@/types/legal";
import { askQuestion, readableError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Scroll the output column (not the window) to show the newest turn. */
function scrollToEnd(el: HTMLElement | null) {
  let parent = el?.parentElement ?? null;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  parent?.scrollTo({ top: parent.scrollHeight, behavior: "smooth" });
}
import { Button } from "@/components/ui/button";
import { CitationLink, ErrorNotice } from "@/components/panels/shared";
import { EmptyOutput, ToolFrame } from "./tool-frame";
import { ReadAloud, useRequestPreferences } from "@/components/preferences";

type Stage = "retrieve" | "rerank" | "generate" | "verify";
const STAGES: { key: Stage; label: string }[] = [
  { key: "retrieve", label: "Search" },
  { key: "rerank", label: "Rerank" },
  { key: "generate", label: "Answer" },
  { key: "verify", label: "Verify quotes" },
];

type Turn = {
  id: number;
  question: string;
  stage: Stage | null;
  /** Stages the server actually ran, in order (a refusal can stop early). */
  reached: Stage[];
  stageDetail: string;
  retrieved: RetrievedChunk[];
  result: GroundedAnswer | null;
  error: string | null;
};

const SUGGESTIONS = [
  "Can I end this agreement early, and how?",
  "What happens if I break it?",
  "Who owns what I create?",
  "Does it renew automatically?",
];

export function AskTool({ doc }: { doc: IngestedDocument }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const preferences = useRequestPreferences();

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setQuery("");
    setBusy(true);
    const turnId = Date.now();
    setTurns((t) => [...t, { id: turnId, question, stage: "retrieve", reached: [], stageDetail: "", retrieved: [], result: null, error: null }]);
    const update = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === turnId ? fn(t) : t)));
    requestAnimationFrame(() => scrollToEnd(endRef.current));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await askQuestion(
        doc,
        question,
        preferences,
        (e: AskEvent) => {
          if (e.type === "stage") update((t) => ({ ...t, stage: e.stage, stageDetail: e.detail, reached: [...t.reached, e.stage] }));
          else if (e.type === "retrieved") update((t) => ({ ...t, retrieved: e.chunks }));
          else if (e.type === "result") update((t) => ({ ...t, result: e.data, stage: null }));
          else if (e.type === "error") update((t) => ({ ...t, error: e.error, stage: null }));
        },
        ctrl.signal,
      );
    } catch (err) {
      if (!ctrl.signal.aborted) update((t) => ({ ...t, error: readableError(err).message, stage: null }));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollToEnd(endRef.current));
    }
  };

  return (
    <ToolFrame
      title="Ask your document"
      description="Answers come only from your document, with the exact clause quoted. If the document does not say, you will be told so."
      disclaimer={DISCLAIMER}
      controls={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(query);
          }}
          className="space-y-2"
        >
          <label htmlFor={id} className="sr-only">
            Your question
          </label>
          <div className="flex gap-2">
            <input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={LIMITS.maxQueryChars}
              placeholder="e.g. How much notice do I need to give to cancel?"
              className="h-10 min-w-0 flex-1 rounded-control border border-rule bg-sheet px-3 text-sm text-ink placeholder:text-ink-soft/70 focus:border-ink/40 focus:outline-none"
              autoComplete="off"
            />
            <Button type="submit" disabled={busy || query.trim().length < 3} aria-label="Ask">
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizonal aria-hidden />}
              <span className="max-sm:hidden">Ask</span>
            </Button>
          </div>
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuery(s)}
                  className="rounded-pill border border-rule px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink/40 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </form>
      }
    >
      {turns.length === 0 ? (
        <EmptyOutput icon={<MessageSquareText className="size-5" aria-hidden />}>
          <p>
            Your question is matched against every passage (by meaning and by keyword), Gemini ranks the best five, answers from those alone, and every quote
            is checked against your document before you see it.
          </p>
        </EmptyOutput>
      ) : (
        <div className="space-y-8">
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} onFollowUp={(q) => void ask(q)} busy={busy} />
          ))}
          <div ref={endRef} />
        </div>
      )}
    </ToolFrame>
  );
}

function TurnView({ turn, onFollowUp, busy }: { turn: Turn; onFollowUp: (q: string) => void; busy: boolean }) {
  const r = turn.result;
  const finished = !turn.stage;
  return (
    <article className="space-y-3" aria-label={`Question: ${turn.question}`}>
      <p className="ml-auto w-fit max-w-[85%] rounded-sheet rounded-br-none bg-ink px-3.5 py-2 text-sm text-sheet">{turn.question}</p>

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-2xs font-semibold" aria-label="Answer pipeline">
        {STAGES.map((s, i) => {
          const ran = turn.reached.includes(s.key);
          const active = turn.stage === s.key;
          const done = ran && !active;
          const skipped = finished && !ran;
          return (
            <li key={s.key} className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill px-2 py-0.5",
                  active ? "bg-highlight text-highlight-ink" : done ? "bg-seal/10 text-seal" : "bg-ink/5 text-ink-soft",
                  skipped && "line-through opacity-60",
                )}
                title={skipped ? "Not needed: stopped earlier" : undefined}
              >
                {active ? <Loader2 className="size-3 animate-spin" aria-hidden /> : done ? <Check className="size-3" aria-hidden /> : null}
                {s.label}
              </span>
              {i < STAGES.length - 1 && <span className="text-ink-soft/50" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
      {turn.stage && turn.stageDetail && (
        <p className="text-xs text-ink-soft" aria-live="polite">
          {turn.stageDetail}
        </p>
      )}

      {turn.error && <ErrorNotice message={turn.error} onRetry={busy ? undefined : () => onFollowUp(turn.question)} />}

      {r?.status === "answered" && (
        <div className="space-y-3 rounded-sheet border border-rule bg-sheet p-4">
          <p className="whitespace-pre-line font-serif text-base leading-relaxed text-ink">{r.answer}</p>
          <div className="-ml-3 -mt-2">
            <ReadAloud text={r.answer} label="Read answer aloud" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs">
            <span className="inline-flex items-center gap-1 rounded-pill bg-seal/10 px-2 py-0.5 font-bold text-seal">
              <ShieldCheck className="size-3" aria-hidden />
              {r.faithfulness.verifiedCitations} of {r.faithfulness.totalCitations} quotes verified in your document
            </span>
            <span className="rounded-pill bg-ink/5 px-2 py-0.5 font-semibold text-ink-soft">Confidence: {r.confidence}</span>
          </div>
          <div className="space-y-2">
            {r.citations.map((c, i) => (
              <CitationLink key={i} citation={c} verified={c.verified} />
            ))}
          </div>
          <p className="border-t border-rule pt-2 text-xs italic text-ink-soft">{r.disclaimer}</p>
        </div>
      )}

      {r?.status === "refused" && (
        <div className="flex gap-3 rounded-sheet border border-amber/40 bg-amber/5 p-4 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
          <div>
            <p className="font-semibold text-ink">Not answered from your document</p>
            <p className="text-ink-soft">{r.refusalReason}</p>
          </div>
        </div>
      )}

      {turn.retrieved.length > 0 && <RetrievalTrace chunks={turn.retrieved} />}

      {r && r.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.followUps.map((f) => (
            <button
              key={f}
              disabled={busy}
              onClick={() => onFollowUp(f)}
              className="rounded-pill border border-rule px-2.5 py-1 text-left text-xs text-ink-soft transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function RetrievalTrace({ chunks }: { chunks: RetrievedChunk[] }) {
  return (
    <details className="group rounded-control border border-rule bg-sheet/60 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-ink-soft">
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        Passages Gemini used ({chunks.length})
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[26rem] text-left">
          <thead className="text-2xs text-ink-soft">
            <tr>
              <th className="py-1 pr-2 font-semibold">Page</th>
              <th className="py-1 pr-2 font-semibold">Section</th>
              <th className="py-1 pr-2 text-right font-semibold">Meaning</th>
              <th className="py-1 pr-2 text-right font-semibold">Keyword</th>
              <th className="py-1 text-right font-semibold">Gemini rank</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {chunks.map((c) => (
              <tr key={c.id} className="border-t border-rule align-top" title={c.preview}>
                <td className="py-1 pr-2">{c.page}</td>
                <td className="max-w-[12rem] truncate py-1 pr-2">{c.section}</td>
                <td className="py-1 pr-2 text-right">{c.vectorScore === null ? "–" : c.vectorScore.toFixed(2)}</td>
                <td className="py-1 pr-2 text-right">{c.lexicalScore.toFixed(1)}</td>
                <td className="py-1 text-right font-semibold">{c.rerankScore === null ? "–" : `${c.rerankScore}/10`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
