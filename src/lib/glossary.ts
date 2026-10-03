/**
 * Finds glossary terms inside a line of text, so the setup check and the trade form
 * can put the rulebook's own definition one hover away.
 *
 * A term like "MFE / MAE" or "PDH/PDL, PWH/PWL" is several names for related things;
 * each name is matched on its own. One-letter terms ("R") are left out — they would
 * light up every other word.
 */
import type { GlossaryEntry } from "./rulebook";

export interface GlossPart {
  text: string;
  /** The definition when this part is a glossary term. */
  meaning?: string;
}

/** The names a glossary entry is known by. */
export function aliases(term: string): string[] {
  return term
    .split(/\s*,\s*|\s+\/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits a line into plain text and terms, each term marked once — at its first appearance. */
export function gloss(text: string, entries: GlossaryEntry[]): GlossPart[] {
  const names = entries
    .flatMap((e) => aliases(e.term).map((name) => ({ name, meaning: `${e.term}: ${e.meaning}` })))
    .sort((a, b) => b.name.length - a.name.length);
  if (!names.length || !text) return [{ text }];
  const pattern = new RegExp(`(?<![\\w/])(${names.map((n) => escape(n.name)).join("|")})(?![\\w/])`, "g");
  const seen = new Set<string>();
  const out: GlossPart[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const i = m.index ?? 0;
    const hit = names.find((n) => n.name === m[0]);
    if (!hit || seen.has(hit.name)) continue;
    seen.add(hit.name);
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ text: m[0], meaning: hit.meaning });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
