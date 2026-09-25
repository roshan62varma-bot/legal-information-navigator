"use client";

import type { ConsultationSheet } from "@/types/legal";

/** Render the consultation sheet as a printable A4 PDF with jsPDF (loaded on demand). */
export async function downloadConsultPdf(sheet: ConsultationSheet, sourceName: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const width = W - M * 2;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, opts: { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    const size = opts.size ?? 10.5;
    doc.setFont("times", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? [20, 27, 45]));
    const lines = doc.splitTextToSize(s, width - (opts.indent ?? 0)) as string[];
    for (const line of lines) {
      ensure(size * 1.35);
      doc.text(line, M + (opts.indent ?? 0), y);
      y += size * 1.35;
    }
    y += opts.gap ?? 4;
  };
  const rule = () => {
    ensure(12);
    doc.setDrawColor(200, 204, 214);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  text("Attorney consultation sheet", { size: 20, bold: true, gap: 2 });
  text(`${sheet.documentTitle}  (source file: ${sourceName})`, { size: 10, color: [80, 88, 104] });
  text(`Prepared ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} with Legal Information Navigator`, { size: 9, color: [80, 88, 104], gap: 10 });
  rule();

  text("Situation", { size: 13, bold: true });
  text(sheet.situationSummary, { gap: 10 });

  text("Clauses to discuss", { size: 13, bold: true, gap: 6 });
  sheet.items.forEach((item, i) => {
    ensure(60);
    text(`${i + 1}. ${item.clauseTitle}   [${item.priority}]   page ${item.citation.page}`, { size: 11.5, bold: true, gap: 2 });
    text(`"${item.citation.excerpt}"`, { italic: true, size: 9.5, color: [80, 88, 104], indent: 14, gap: 3 });
    text(item.whyAsk, { indent: 14, gap: 3 });
    item.questions.forEach((q) => text(`[  ]  ${q}`, { indent: 22, gap: 1 }));
    y += 8;
  });

  if (sheet.generalQuestions.length) {
    rule();
    text("General questions", { size: 13, bold: true });
    sheet.generalQuestions.forEach((q) => text(`[  ]  ${q}`, { indent: 8, gap: 1 }));
    y += 6;
  }
  if (sheet.documentsToBring.length) {
    text("Bring to the meeting", { size: 13, bold: true });
    sheet.documentsToBring.forEach((d) => text(`-  ${d}`, { indent: 8, gap: 1 }));
    y += 6;
  }

  rule();
  text("Notes", { size: 13, bold: true, gap: 90 });
  text(sheet.disclaimer, { size: 8.5, italic: true, color: [110, 116, 130] });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 136, 150);
    doc.text(`Page ${p} of ${pages}  ·  Informational only, not legal advice`, W / 2, H - 28, { align: "center" });
  }
  doc.save(`consultation-sheet-${sheet.documentTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)}.pdf`);
}
