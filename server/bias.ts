/**
 * Today's gold bias on disk: data/daily-bias.json.
 *
 * gmailBias.ts fills it from the morning's Gmail draft. One file, replaced each day:
 * the desk keeps only the latest read. The text is passed to the page untouched;
 * the page decides what is usable and whether it is still today's.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIAS_FILE = path.join(__dirname, "..", "data", "daily-bias.json");

/* Mirrors BiasFile in src/lib/dailyBias.ts (which adds the Gmail status). */
type BiasFile =
  | { found: false }
  | { found: true; savedAt: string; data: unknown }
  | { found: true; savedAt: string; error: string; text: string };

export function readBias(): BiasFile {
  let text: string;
  let savedAt: string;
  try {
    savedAt = fs.statSync(BIAS_FILE).mtime.toISOString();
    text = fs.readFileSync(BIAS_FILE, "utf8");
  } catch {
    return { found: false };
  }
  try {
    return { found: true, savedAt, data: JSON.parse(text) };
  } catch (err) {
    // Hand the text over anyway — a briefing with a stray comma is still worth reading.
    return { found: true, savedAt, error: (err as Error).message, text };
  }
}

/**
 * The "date" the saved briefing was written for, or null when there's none to read.
 * A demo briefing (`npm run demo:bias`) counts as none, so the real one still replaces it.
 */
export function savedDate(): string | null {
  const file = readBias();
  if (!file.found) return null;
  const data = "data" in file ? (file.data as { date?: unknown; demo?: unknown } | null) : null;
  if (data?.demo === true) return null;
  return typeof data?.date === "string" ? data.date : null;
}

/** Replaces the briefing. Written aside and renamed, so a reader never sees half a file. */
export function writeBias(text: string) {
  fs.mkdirSync(path.dirname(BIAS_FILE), { recursive: true });
  const tmp = `${BIAS_FILE}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, BIAS_FILE);
}
