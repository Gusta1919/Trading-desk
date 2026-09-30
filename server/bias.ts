/**
 * Today's gold bias, as the scheduled Claude task left it.
 *
 * The task writes data/daily-bias.json each weekday morning — to a temp name first,
 * then renamed into place, so this never reads half a file. One file, replaced
 * daily: the desk keeps only today's read. The text is passed through untouched;
 * the page decides what is usable and whether it is still today's.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIAS_FILE = path.join(__dirname, "..", "data", "daily-bias.json");

/* Mirrors BiasFile in src/lib/dailyBias.ts. */
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
