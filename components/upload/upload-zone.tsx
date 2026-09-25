"use client";

import * as React from "react";
import { ClipboardType, FileUp, Loader2, ScanText, ShieldCheck } from "lucide-react";
import type { IngestedDocument } from "@/types/legal";
import { SAMPLES } from "@/lib/samples";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ErrorNotice } from "@/components/panels/shared";
import { useIngest, type IngestStage } from "./use-ingest";

type Props = {
  onReady: (doc: IngestedDocument) => void;
  title: string;
  hint: string;
  /** Which bundled sample this slot offers. */
  sampleId?: (typeof SAMPLES)[number]["id"];
  compact?: boolean;
};

export function UploadZone({ onReady, title, hint, sampleId, compact = false }: Props) {
  const { stage, scrub, setScrub, ingestFile, ingestText, runOcr, reset } = useIngest(onReady);
  const [dragging, setDragging] = React.useState(false);
  const [mode, setMode] = React.useState<"file" | "paste">("file");
  const [pasted, setPasted] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const id = React.useId();
  const busy = stage.kind === "reading" || stage.kind === "scrubbing" || stage.kind === "indexing" || stage.kind === "ocr";
  const sample = SAMPLES.find((s) => s.id === sampleId);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !busy) void ingestFile(file);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={cn("font-serif text-ink", compact ? "text-lg" : "text-xl")}>{title}</h2>
        <div role="tablist" aria-label="Input method" className="flex rounded-control bg-ink/5 p-0.5 text-xs font-semibold">
          {(["file", "paste"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-[5px] px-2.5 py-1 transition-colors", mode === m ? "bg-sheet text-ink shadow-sheet" : "text-ink-soft hover:text-ink")}
            >
              {m === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>
      </div>

      {busy || stage.kind === "needs-ocr" ? (
        <Progress stage={stage} onOcr={runOcr} onCancel={reset} />
      ) : mode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-sheet border-2 border-dashed bg-sheet transition-colors",
            dragging ? "border-highlight bg-highlight/10" : "border-rule hover:border-ink/30",
            compact ? "p-4" : "p-6",
          )}
        >
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept="application/pdf,.pdf,text/plain,.txt"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void ingestFile(f);
              e.target.value = "";
            }}
          />
          <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2 text-center">
            <span className="grid size-11 place-items-center rounded-pill bg-highlight/30 text-ink">
              <FileUp className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-ink">Drop a PDF here or choose a file</span>
            <span className="text-xs text-ink-soft">{hint}</span>
          </label>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ingestText("Pasted text", pasted);
          }}
          className="space-y-2"
        >
          <label htmlFor={`${id}-paste`} className="sr-only">
            Contract text
          </label>
          <textarea
            id={`${id}-paste`}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={compact ? 5 : 7}
            placeholder="Paste the contract or clause you want to understand"
            className="w-full resize-y rounded-sheet border border-rule bg-sheet p-3 font-serif text-sm leading-relaxed text-ink placeholder:text-ink-soft/70 focus:border-ink/40 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-ink-soft">{pasted.length.toLocaleString()} characters</span>
            <Button type="submit" size="sm" disabled={pasted.trim().length < 80}>
              <ClipboardType aria-hidden /> Analyze text
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-xs text-ink">
          <Switch checked={scrub} onCheckedChange={setScrub} disabled={busy} aria-describedby={`${id}-pii`} />
          <span>
            <span className="font-semibold">Remove personal details first</span>
            <span id={`${id}-pii`} className="block text-ink-soft">
              Names, emails, phones, addresses, ID and bank numbers are replaced in your browser.
            </span>
          </span>
        </label>
        {sample && !busy && (
          <Button variant="ghost" size="sm" onClick={() => void ingestText(sample.name, sample.text)}>
            Use sample: {sample.name.replace(".txt", "")}
          </Button>
        )}
      </div>

      {stage.kind === "error" && <ErrorNotice message={stage.message} onRetry={reset} />}
    </div>
  );
}

function Progress({ stage, onOcr, onCancel }: { stage: IngestStage; onOcr: (f: File) => void; onCancel: () => void }) {
  if (stage.kind === "needs-ocr") {
    return (
      <div className="space-y-3 rounded-sheet border border-amber/40 bg-amber/5 p-4 text-sm" role="alertdialog" aria-labelledby="ocr-title">
        <p id="ocr-title" className="flex items-center gap-2 font-semibold">
          <ScanText className="size-4" aria-hidden /> This PDF is a scan with no text layer
        </p>
        <p className="text-ink-soft">
          To read it, the file must be sent to the server so Gemini can transcribe it. Personal details cannot be removed before this step; they are
          removed right after, before any analysis. Nothing is stored.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onOcr(stage.file)}>
            Send for transcription
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const steps = [
    { key: "read", label: stage.kind === "ocr" ? "Transcribing scan with Gemini" : "Reading text in your browser" },
    { key: "scrub", label: "Removing personal details" },
    { key: "index", label: "Splitting into clauses and embedding with Gemini" },
  ];
  const activeIndex = stage.kind === "reading" || stage.kind === "ocr" ? 0 : stage.kind === "scrubbing" ? 1 : 2;
  const pct =
    stage.kind === "reading" ? Math.round((stage.done / Math.max(1, stage.total)) * 33) : stage.kind === "ocr" ? 20 : stage.kind === "scrubbing" ? 45 : 75;

  return (
    <div className="rounded-sheet border border-rule bg-sheet p-4" aria-live="polite">
      <div
        className="mb-3 h-1.5 overflow-hidden rounded-pill bg-ink/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Processing document"
      >
        <div className="h-full rounded-pill bg-highlight transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <ol className="space-y-1.5 text-sm">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("flex items-center gap-2", i > activeIndex ? "text-ink-soft/60" : i < activeIndex ? "text-ink-soft" : "font-semibold text-ink")}>
            {i < activeIndex ? (
              <ShieldCheck className="size-4 text-seal" aria-hidden />
            ) : i === activeIndex ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <span className="size-4 rounded-pill border border-rule" aria-hidden />
            )}
            {s.label}
            {i === 0 && stage.kind === "reading" && stage.total > 1 && (
              <span className="text-ink-soft">
                (page {stage.done} of {stage.total})
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
