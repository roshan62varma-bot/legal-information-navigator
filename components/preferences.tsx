"use client";

import * as React from "react";
import { Check, Pause, Settings2, Volume2 } from "lucide-react";
import type { Language, Preferences, ReadingLevel } from "@/types/legal";
import { LANGUAGES } from "@/types/legal";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Reader preferences that make the output usable by more people:
 * - language: every AI explanation is written in the reader's language
 * - reading level: simple / standard / detailed
 * - text size: scales the whole interface (rem-based)
 * Stored per device in localStorage; nothing is sent anywhere except the
 * language and reading level, which travel with each AI request.
 */

type TextSize = "base" | "lg" | "xl";
type PrefsState = Preferences & {
  textSize: TextSize;
  setLanguage: (l: Language) => void;
  setReadingLevel: (r: ReadingLevel) => void;
  setTextSize: (t: TextSize) => void;
};

const KEY = "lin-prefs";
const Ctx = React.createContext<PrefsState | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = React.useState<Language>("en");
  const [readingLevel, setReadingLevel] = React.useState<ReadingLevel>("standard");
  const [textSize, setTextSize] = React.useState<TextSize>("base");
  const loaded = React.useRef(false);

  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PrefsState>;
      if (saved.language && saved.language in LANGUAGES) setLanguage(saved.language);
      if (saved.readingLevel && ["simple", "standard", "detailed"].includes(saved.readingLevel)) setReadingLevel(saved.readingLevel);
      if (saved.textSize && ["base", "lg", "xl"].includes(saved.textSize)) setTextSize(saved.textSize);
    } catch {
      /* storage unavailable: defaults apply */
    }
    loaded.current = true;
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ language, readingLevel, textSize }));
    } catch {
      /* ignore */
    }
  }, [language, readingLevel, textSize]);

  const value = React.useMemo(
    () => ({ language, readingLevel, textSize, setLanguage, setReadingLevel, setTextSize }),
    [language, readingLevel, textSize],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PrefsState {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("usePreferences must be used inside PreferencesProvider");
  return v;
}

/** The subset that is sent to the API with every AI request. */
export function useRequestPreferences(): Preferences {
  const { language, readingLevel } = usePreferences();
  return React.useMemo(() => ({ language, readingLevel }), [language, readingLevel]);
}

const LEVELS: { id: ReadingLevel; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Short sentences, no legal terms" },
  { id: "standard", label: "Standard", hint: "Plain English, terms explained" },
  { id: "detailed", label: "Detailed", hint: "Includes legal terms and exceptions" },
];

const SIZES: { id: TextSize; label: string; cls: string }[] = [
  { id: "base", label: "Default text size", cls: "text-sm" },
  { id: "lg", label: "Larger text", cls: "text-base" },
  { id: "xl", label: "Largest text", cls: "text-lg" },
];

export function PreferencesMenu() {
  const { language, readingLevel, textSize, setLanguage, setReadingLevel, setTextSize } = usePreferences();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
        <Settings2 aria-hidden />
        <span className="max-sm:sr-only">Reading options</span>
        <span className="rounded-pill bg-ink/10 px-1.5 text-2xs font-bold uppercase">{language}</span>
      </Button>
      {open && (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label="Reading options"
          className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-sheet border border-rule bg-sheet p-4 shadow-lift"
        >
          <div>
            <label htmlFor={`${id}-lang`} className="mb-1 block text-xs font-bold text-ink">
              Explain results in
            </label>
            <select
              id={`${id}-lang`}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="w-full rounded-control border border-rule bg-sheet px-3 py-2 text-sm text-ink"
            >
              {(Object.keys(LANGUAGES) as Language[]).map((k) => (
                <option key={k} value={k}>
                  {LANGUAGES[k].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-2xs text-ink-soft">Quotes from your document stay in its original language so they can be checked.</p>
          </div>

          <fieldset>
            <legend className="mb-1 text-xs font-bold text-ink">Reading level</legend>
            <div className="grid gap-1.5">
              {LEVELS.map((l) => (
                <label
                  key={l.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2 text-sm",
                    readingLevel === l.id ? "border-ink bg-ink/5" : "border-rule hover:border-ink/40",
                  )}
                >
                  <input type="radio" name={`${id}-level`} value={l.id} checked={readingLevel === l.id} onChange={() => setReadingLevel(l.id)} className="accent-current" />
                  <span>
                    <span className="block font-semibold text-ink">{l.label}</span>
                    <span className="block text-2xs text-ink-soft">{l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-xs font-bold text-ink">Text size</legend>
            <div className="flex gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={textSize === s.id}
                  aria-label={s.label}
                  onClick={() => setTextSize(s.id)}
                  className={cn(
                    "flex h-10 flex-1 items-center justify-center gap-1 rounded-control border font-serif",
                    s.cls,
                    textSize === s.id ? "border-ink bg-ink text-sheet" : "border-rule text-ink hover:border-ink/40",
                  )}
                >
                  A{textSize === s.id && <Check className="size-3" aria-hidden />}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Reads text aloud with the browser's speech engine, in the chosen output language. */
export function ReadAloud({ text, label = "Read aloud" }: { text: string | undefined; label?: string }) {
  const { language } = usePreferences();
  const [speaking, setSpeaking] = React.useState(false);
  const [supported, setSupported] = React.useState(false);

  React.useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported || !text) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGUAGES[language].speech;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-pressed={speaking}>
      {speaking ? <Pause aria-hidden /> : <Volume2 aria-hidden />}
      {speaking ? "Stop reading" : label}
    </Button>
  );
}
