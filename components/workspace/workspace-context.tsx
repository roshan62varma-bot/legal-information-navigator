"use client";

import * as React from "react";
import type { Citation, IngestedDocument } from "@/types/legal";

export type ToolId = "summary" | "redflags" | "compare" | "ask" | "consult";
export type DocSlot = "primary" | "secondary";

export type HighlightTarget = {
  slot: DocSlot;
  page: number;
  excerpt: string;
  /** Changes on every click so re-clicking the same citation re-scrolls. */
  nonce: number;
};

type WorkspaceState = {
  primary: IngestedDocument | null;
  secondary: IngestedDocument | null;
  setDocument: (slot: DocSlot, doc: IngestedDocument | null) => void;
  swapDocuments: () => void;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  viewing: DocSlot;
  setViewing: (s: DocSlot) => void;
  highlight: HighlightTarget | null;
  focusCitation: (c: Pick<Citation, "page" | "excerpt">, slot?: DocSlot) => void;
  /** Mobile only: which pane is visible. */
  pane: "document" | "analysis";
  setPane: (p: "document" | "analysis") => void;
};

const Ctx = React.createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [primary, setPrimary] = React.useState<IngestedDocument | null>(null);
  const [secondary, setSecondary] = React.useState<IngestedDocument | null>(null);
  const [tool, setTool] = React.useState<ToolId>("summary");
  const [viewing, setViewing] = React.useState<DocSlot>("primary");
  const [highlight, setHighlight] = React.useState<HighlightTarget | null>(null);
  const [pane, setPane] = React.useState<"document" | "analysis">("document");

  const setDocument = React.useCallback((slot: DocSlot, doc: IngestedDocument | null) => {
    const setter = slot === "primary" ? setPrimary : setSecondary;
    setter((prev) => {
      if (prev?.fileUrl && prev.fileUrl !== doc?.fileUrl) URL.revokeObjectURL(prev.fileUrl);
      return doc;
    });
    setHighlight(null);
    if (slot === "primary") {
      setViewing("primary");
      if (doc) setPane("analysis");
    }
  }, []);

  const swapDocuments = React.useCallback(() => {
    if (!primary || !secondary) return;
    setPrimary(secondary);
    setSecondary(primary);
    setHighlight(null);
    setViewing("primary");
  }, [primary, secondary]);

  const focusCitation = React.useCallback((c: Pick<Citation, "page" | "excerpt">, slot: DocSlot = "primary") => {
    setViewing(slot);
    setPane("document");
    setHighlight({ slot, page: c.page, excerpt: c.excerpt, nonce: Date.now() });
  }, []);

  const value = React.useMemo(
    () => ({ primary, secondary, setDocument, swapDocuments, tool, setTool, viewing, setViewing, highlight, focusCitation, pane, setPane }),
    [primary, secondary, setDocument, swapDocuments, tool, viewing, highlight, focusCitation, pane],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}
