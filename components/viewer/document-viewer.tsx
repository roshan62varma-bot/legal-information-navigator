"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { EyeOff, FileText, ShieldAlert, X } from "lucide-react";
import { describePiiReport } from "@/lib/ingestion";
import { pluralize } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TextViewer } from "./text-viewer";

const PdfViewer = dynamic(() => import("./pdf-viewer").then((m) => m.PdfViewer), { ssr: false });

export function DocumentViewer() {
  const { primary, secondary, viewing, setViewing, highlight, setDocument } = useWorkspace();
  const doc = viewing === "secondary" && secondary ? secondary : primary;
  const [showAnalyzed, setShowAnalyzed] = React.useState(false);
  if (!doc) return null;
  const slot = doc === secondary ? "secondary" : "primary";
  const hl = highlight && highlight.slot === slot ? highlight : null;
  const usePdf = doc.fileUrl && !showAnalyzed;

  return (
    <section aria-label="Document" className="flex h-full min-h-0 flex-col bg-sheet">
      <header className="space-y-2 border-b border-rule px-4 py-3">
        {secondary && (
          <div role="tablist" aria-label="Document version" className="flex gap-1 text-xs font-semibold">
            {(["primary", "secondary"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={viewing === s}
                onClick={() => setViewing(s)}
                className={cn("rounded-control px-2.5 py-1", viewing === s ? "bg-ink text-sheet" : "text-ink-soft hover:bg-ink/5")}
              >
                {s === "primary" ? "Version A" : "Version B"}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start gap-3">
          <FileText className="mt-1 size-4 shrink-0 text-ink-soft" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-lg leading-tight" title={doc.name}>
              {doc.name}
            </h2>
            <p className="text-2xs text-ink-soft">
              {pluralize(doc.pages.length, "page")} · {pluralize(doc.chunks.length, "chunk")} ·{" "}
              {doc.retrievalMode === "hybrid" ? "vector + keyword search" : "keyword search"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${doc.name}`}
            onClick={() => setDocument(slot, null)}
          >
            <X />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-2xs">
          <span className={cn("inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-semibold", doc.pii ? "bg-seal/10 text-seal" : "bg-ink/5 text-ink-soft")}>
            <EyeOff className="size-3" aria-hidden />
            {doc.pii ? describePiiReport(doc.pii) : "Personal details were not removed"}
          </span>
          {doc.injectionsNeutralized > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-redline/10 px-2 py-0.5 font-semibold text-redline">
              <ShieldAlert className="size-3" aria-hidden />
              {pluralize(doc.injectionsNeutralized, "hidden instruction")} to the AI neutralized
            </span>
          )}
          {doc.fileUrl && (
            <button
              onClick={() => setShowAnalyzed((v) => !v)}
              className="ml-auto rounded-pill px-2 py-0.5 font-semibold text-ink-soft underline-offset-2 hover:underline"
            >
              {showAnalyzed ? "Show original PDF" : "Show text sent to AI"}
            </button>
          )}
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {hl ? `Showing the quoted passage on page ${hl.page} of ${doc.name}` : ""}
      </p>
      <div className="min-h-0 flex-1">
        {usePdf ? <PdfViewer fileUrl={doc.fileUrl!} highlight={hl} /> : <TextViewer pages={doc.pages} highlight={hl} />}
      </div>
    </section>
  );
}
