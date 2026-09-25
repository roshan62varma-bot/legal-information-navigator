"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { BookText, Flag, GitCompareArrows, MessageSquareText, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/upload/upload-zone";
import { DocumentViewer } from "@/components/viewer/document-viewer";
import type { IngestedDocument } from "@/types/legal";
import { useMediaQuery } from "@/lib/hooks";
import { useWorkspace, type ToolId } from "./workspace-context";

const ContractScene = dynamic(() => import("@/components/three/contract-scene"), { ssr: false });

// Each tool is its own chunk: the first paint only downloads the tool that is open.
const toolLoading = () => <div className="p-6" aria-busy="true" />;
const TOOL_COMPONENTS: Record<ToolId, React.ComponentType<{ doc: IngestedDocument }>> = {
  summary: dynamic(() => import("@/components/tools/summary-tool").then((m) => m.SummaryTool), { loading: toolLoading }),
  redflags: dynamic(() => import("@/components/tools/redflags-tool").then((m) => m.RedFlagsTool), { loading: toolLoading }),
  compare: dynamic(() => import("@/components/tools/compare-tool").then((m) => m.CompareTool), { loading: toolLoading }),
  ask: dynamic(() => import("@/components/tools/ask-tool").then((m) => m.AskTool), { loading: toolLoading }),
  consult: dynamic(() => import("@/components/tools/consult-tool").then((m) => m.ConsultTool), { loading: toolLoading }),
};

const TOOLS: { id: ToolId; label: string; blurb: string; icon: React.ReactNode }[] = [
  { id: "summary", label: "Summarize", blurb: "Plain-English overview", icon: <BookText aria-hidden /> },
  { id: "redflags", label: "Red flags", blurb: "Risky clauses by severity", icon: <Flag aria-hidden /> },
  { id: "compare", label: "Compare", blurb: "What changed between drafts", icon: <GitCompareArrows aria-hidden /> },
  { id: "ask", label: "Ask", blurb: "Cited answers from the text", icon: <MessageSquareText aria-hidden /> },
  { id: "consult", label: "Consult", blurb: "Questions for your lawyer", icon: <NotebookPen aria-hidden /> },
];

export function Workspace() {
  const { primary, setDocument, tool, setTool, pane, setPane } = useWorkspace();
  // Arrow-key navigation must match what the user sees: a vertical rail on wide screens, a horizontal strip otherwise.
  const wide = useMediaQuery("(min-width: 1280px)");
  // Tools mount on first visit and then stay mounted, so switching tabs keeps results without re-requesting.
  const [visited, setVisited] = React.useState<{ doc: string | null; tools: ToolId[] }>({ doc: null, tools: [] });
  const docId = primary?.documentId ?? null;
  const visitedTools = visited.doc === docId ? visited.tools : [];
  if (docId && !visitedTools.includes(tool)) setVisited({ doc: docId, tools: [...visitedTools, tool] });

  return (
    <section id="workspace" aria-label="Workspace" className="mx-auto max-w-[1440px] scroll-mt-14 px-0 sm:px-6 sm:py-6">
      {/* Mobile / tablet pane switcher */}
      <div className="sticky top-14 z-20 flex border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur lg:hidden" role="tablist" aria-label="Workspace pane">
        {(["document", "analysis"] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              "flex-1 rounded-control py-2 text-sm font-semibold transition-colors",
              pane === p ? "bg-ink text-sheet" : "text-ink-soft hover:text-ink",
            )}
          >
            {p === "document" ? "Document" : "Analysis"}
          </button>
        ))}
      </div>

      <Tabs value={tool} onValueChange={(v) => setTool(v as ToolId)} orientation={wide ? "vertical" : "horizontal"} activationMode="manual" asChild>
        <div
          className={cn(
            "grid overflow-hidden border-rule bg-sheet sm:rounded-sheet sm:border sm:shadow-sheet",
            "lg:h-[calc(100dvh-5.5rem)] lg:min-h-[640px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_13.5rem_minmax(0,1.2fr)] xl:grid-rows-1",
          )}
        >
          {/* Left: document */}
          <div className={cn("min-h-0 border-rule lg:row-span-2 lg:border-r xl:row-span-1", pane === "document" ? "block" : "hidden lg:block", "h-[calc(100dvh-7.5rem)] lg:h-auto")}>
            {primary ? (
              <DocumentViewer />
            ) : (
              <div className="scrollbar-thin flex h-full flex-col overflow-y-auto">
                <div className="h-56 shrink-0 sm:h-64">
                  <ContractScene compact label="A contract page waiting to be read" />
                </div>
                <div className="px-5 pb-6">
                  <UploadZone
                    title="Start with your document"
                    hint="PDF or .txt, up to 8 MB. Text is read on your device."
                    sampleId="revised"
                    onReady={(d) => setDocument("primary", d)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Center: tool selector */}
          <TabsList
            aria-label="Analysis tools"
            className={cn(
              "scrollbar-thin gap-1 overflow-x-auto border-rule bg-paper/60 p-2",
              "flex-row border-b xl:flex-col xl:border-b-0 xl:border-r xl:p-3",
              pane === "analysis" ? "flex" : "hidden lg:flex",
              "lg:col-start-2 lg:row-start-1 xl:col-start-auto xl:row-start-auto",
            )}
          >
            <p className="hidden px-2 pb-2 pt-1 text-2xs font-semibold text-ink-soft xl:block">Choose a tool</p>
            {TOOLS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                disabled={!primary}
                className={cn(
                  "group flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                  "data-[state=active]:bg-sheet data-[state=active]:shadow-sheet data-[state=inactive]:hover:bg-ink/5",
                  "xl:items-start xl:py-2.5",
                )}
              >
                <span className="text-ink-soft group-data-[state=active]:text-ink [&_svg]:size-4 xl:mt-0.5">{t.icon}</span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{t.label}</span>
                  <span className="hidden text-2xs text-ink-soft xl:block">{t.blurb}</span>
                </span>
                <span className="ml-auto hidden h-6 w-1 rounded-pill bg-highlight opacity-0 transition-opacity group-data-[state=active]:opacity-100 xl:block" aria-hidden />
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Right: output */}
          <div
            className={cn(
              "min-h-0 bg-paper/40",
              pane === "analysis" ? "block" : "hidden lg:block",
              "h-[calc(100dvh-10.5rem)] lg:col-start-2 lg:row-start-2 lg:h-auto xl:col-start-auto xl:row-start-auto",
            )}
          >
            {primary ? (
              <React.Fragment key={primary.documentId}>
                {TOOLS.map((t) => {
                  const Tool = TOOL_COMPONENTS[t.id];
                  return (
                    <TabsContent key={t.id} value={t.id} forceMount className="h-full data-[state=inactive]:hidden">
                      {(visitedTools.includes(t.id) || t.id === tool) && <Tool doc={primary} />}
                    </TabsContent>
                  );
                })}
              </React.Fragment>
            ) : (
              <NoDocument />
            )}
          </div>
        </div>
      </Tabs>
    </section>
  );
}

function NoDocument() {
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-6 py-10 sm:px-10">
      <h2 className="max-w-md font-serif text-3xl leading-tight text-ink">Five ways to read a contract, once you add one.</h2>
      <dl className="grid max-w-lg gap-4 text-sm">
        {TOOLS.map((t) => (
          <div key={t.id} className="flex gap-3">
            <dt className="mt-0.5 text-ink-soft [&_svg]:size-4">{t.icon}</dt>
            <dd>
              <span className="font-semibold text-ink">{t.label}.</span> <span className="text-ink-soft">{DESCRIPTIONS[t.id]}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const DESCRIPTIONS: Record<ToolId, string> = {
  summary: "What the document is, what you must do and what you get, in plain English.",
  redflags: "Auto-renewals, non-competes, one-sided indemnities and seven more patterns, ranked by severity.",
  compare: "Upload two drafts to see every added, removed and reworded clause and why it matters.",
  ask: "Ask anything; the answer quotes the clause and highlights it on the page, or says the document does not cover it.",
  consult: "A printable brief with the questions worth paying a lawyer to answer.",
};
