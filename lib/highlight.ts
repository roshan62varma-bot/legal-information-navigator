/**
 * Locate a citation excerpt inside rendered page text, tolerating
 * whitespace, punctuation, case and PII placeholders (the excerpt may say
 * "[NAME_1]" where the original PDF shows the real name).
 */

type Normalized = { text: string; map: number[] };

export function normalizeWithMap(s: string): Normalized {
  let text = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i].toLowerCase();
    if (/[a-z0-9$%]/.test(ch)) {
      text += ch;
      map.push(i);
      lastSpace = false;
    } else if (!lastSpace && !/['’]/.test(ch)) {
      text += " ";
      map.push(i);
      lastSpace = true;
    }
  }
  return { text, map };
}

function norm(s: string): string {
  return normalizeWithMap(s).text.trim();
}

const PLACEHOLDER = /\[(?:NAME|EMAIL|PHONE|ADDRESS|ID|BANK|CARD)_\d+\]|\[instruction-like text removed\]|\.\.\./gi;

export function findExcerptRange(haystack: string, excerpt: string): { start: number; end: number } | null {
  const hay = normalizeWithMap(haystack);
  if (!hay.text) return null;

  const runs = excerpt
    .split(PLACEHOLDER)
    .map(norm)
    .filter((r) => r.split(" ").length >= 2)
    .sort((a, b) => b.length - a.length);

  const tryFind = (needle: string) => {
    const at = hay.text.indexOf(needle);
    if (at < 0) return null;
    return { start: hay.map[at], end: hay.map[Math.min(hay.map.length - 1, at + needle.length - 1)] + 1 };
  };

  for (const run of runs) {
    const whole = tryFind(run);
    if (whole) return whole;
  }
  // Fall back to the longest contiguous window of the excerpt that does appear.
  for (const run of runs) {
    const words = run.split(" ");
    for (let size = Math.min(words.length - 1, 12); size >= 4; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        const hit = tryFind(words.slice(i, i + size).join(" "));
        if (hit) return hit;
      }
    }
  }
  return null;
}
