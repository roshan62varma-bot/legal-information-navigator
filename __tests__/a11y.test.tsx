// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { DISCLAIMER } from "@/types/legal";
import { PreferencesMenu, PreferencesProvider } from "@/components/preferences";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { UploadZone } from "@/components/upload/upload-zone";
import { CitationLink, Disclaimer, ErrorNotice, SeverityBadge } from "@/components/panels/shared";
import { RiskGauge } from "@/components/tools/risk-gauge";

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on the interactive building
 * blocks. jsdom cannot compute layout, so colour-contrast is verified
 * separately in the palette test below.
 */

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </PreferencesProvider>
  );
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

afterEach(cleanup);

describe("accessibility (axe-core, WCAG 2.1 AA)", () => {
  it("upload zone: labelled file input, switch and tabs", async () => {
    const { container } = render(
      <Providers>
        <UploadZone title="Start with your document" hint="PDF or .txt" sampleId="revised" onReady={() => {}} />
      </Providers>,
    );
    expect(screen.getByLabelText(/Drop a PDF here/i)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
    await expectNoViolations(container);
  });

  it("paste mode has a labelled textarea", async () => {
    const { container } = render(
      <Providers>
        <UploadZone title="Start" hint="PDF" onReady={() => {}} />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Paste text" }));
    expect(screen.getByLabelText("Contract text")).toBeTruthy();
    await expectNoViolations(container);
  });

  it("reading options dialog: language, reading level and text size are all labelled", async () => {
    const { container } = render(
      <Providers>
        <PreferencesMenu />
      </Providers>,
    );
    const toggle = screen.getByRole("button", { name: /Reading options/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Reading options" })).toBeTruthy();
    expect(screen.getByLabelText("Explain results in")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Largest text" })).toBeTruthy();
    await expectNoViolations(container);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("text size choice scales the root font size", () => {
    render(
      <Providers>
        <PreferencesMenu />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reading options/i }));
    fireEvent.click(screen.getByRole("button", { name: "Largest text" }));
    expect(document.documentElement.dataset.textSize).toBe("xl");
  });

  it("output pieces: citation button, disclaimer note, alerts, severity and gauge", async () => {
    const { container } = render(
      <Providers>
        <CitationLink citation={{ page: 3, clause: "5. Non-Competition", excerpt: "shall not engage in any competing business" }} verified />
        <Disclaimer text={DISCLAIMER} />
        <ErrorNotice message="The AI service is busy right now." onRetry={() => {}} />
        <SeverityBadge severity="CRITICAL" />
        <RiskGauge score={72} label="One-sidedness score" />
      </Providers>,
    );
    expect(screen.getByRole("button", { name: /Show page 3, 5\. Non-Competition/ })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("not legal advice");
    expect(screen.getByRole("alert")).toBeTruthy();
    // Severity is conveyed by text, not colour alone.
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByLabelText(/72 out of 100/)).toBeTruthy();
    await expectNoViolations(container);
  });
});

// ---------------------------------------------------------------------------
// Colour contrast of the design tokens (WCAG 1.4.3: 4.5:1 for body text)
// ---------------------------------------------------------------------------

function luminance([r, g, b]: number[]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: number[], b: number[]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Mirrors app/globals.css
const LIGHT = { paper: [243, 245, 248], sheet: [255, 255, 255], ink: [20, 32, 58], inkSoft: [72, 84, 110], redline: [180, 35, 24], seal: [21, 104, 74], amber: [146, 84, 0], actionInk: [255, 255, 255], action: [29, 43, 79] };
const DARK = { paper: [13, 19, 34], sheet: [21, 29, 49], ink: [232, 236, 244], inkSoft: [165, 176, 199], redline: [255, 138, 128], seal: [104, 214, 166], amber: [244, 180, 84], actionInk: [20, 26, 40], action: [246, 214, 92] };
const SEVERITY_LIGHT = [
  [[253, 228, 228], [145, 22, 22]],
  [[255, 234, 213], [150, 52, 8]],
  [[253, 243, 196], [112, 80, 0]],
  [[225, 236, 255], [29, 64, 175]],
];
const SEVERITY_DARK = [
  [[92, 22, 28], [255, 196, 196]],
  [[90, 42, 12], [255, 206, 160]],
  [[78, 64, 10], [250, 228, 140]],
  [[22, 44, 96], [190, 214, 255]],
];

describe("colour contrast of design tokens", () => {
  for (const [name, t] of Object.entries({ light: LIGHT, dark: DARK })) {
    it(`${name} theme text colours meet 4.5:1 on paper and sheet`, () => {
      for (const fg of [t.ink, t.inkSoft, t.redline, t.seal, t.amber]) {
        expect(contrast(fg, t.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, t.sheet)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.actionInk, t.action)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("severity badges meet 4.5:1 in both themes", () => {
    for (const [bg, fg] of [...SEVERITY_LIGHT, ...SEVERITY_DARK]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
