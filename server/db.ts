/**
 * Opens data/trade-assistant.db, and on the first start of this version of the desk
 * moves an older database aside instead of converting it.
 *
 * An older database (from before the clean start) is never changed or deleted: it is
 * moved whole into data/archive/, the desk starts a fresh one, and the check-ins you
 * did yourself are copied over. Demo trades, demo check-ins and a demo briefing stay
 * behind in the archive.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toVerdict } from "../src/lib/checkin.js";
import { upgradeRulebook } from "./rulebookStore.js";
import { isCurrentSchema, setupSchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const DB_PATH = path.join(DATA_DIR, "trade-assistant.db");

const DEMO = "[demo]";

/** Moves a database file and its WAL companions into data/archive/, under one timestamped name. */
export function archive(file: string): string {
  const dir = path.join(path.dirname(file), "archive");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const target = path.join(dir, `${path.basename(file, ".db")}-${stamp}.db`);
  // Fold the write-ahead log into the file and leave WAL mode, so the archive is one
  // complete file that opens without companions.
  const old = new Database(file);
  old.pragma("wal_checkpoint(TRUNCATE)");
  old.pragma("journal_mode = DELETE");
  old.close();
  fs.renameSync(file, target);
  for (const ext of ["-wal", "-shm"]) if (fs.existsSync(file + ext)) fs.rmSync(file + ext);
  return target;
}

/** Your own check-ins from the archived database: the demo ones stay behind. "caution" is now "careful". */
function carryCheckins(from: string, to: Database.Database): number {
  const old = new Database(from, { readonly: true });
  try {
    const has = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkins'").get();
    if (!has) return 0;
    const rows = old.prepare("SELECT * FROM checkins").all() as Record<string, unknown>[];
    const insert = to.prepare(
      "INSERT OR IGNORE INTO checkins (date, answers, note, score, verdict, reflection, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    let n = 0;
    for (const r of rows) {
      if (String(r.note ?? "").includes(DEMO)) continue;
      insert.run(
        String(r.date),
        String(r.answers ?? "{}"),
        String(r.note ?? ""),
        Number(r.score) || 0,
        toVerdict(r.verdict),
        String(r.reflection ?? ""),
        String(r.created_at ?? new Date().toISOString()),
      );
      n++;
    }
    return n;
  } finally {
    old.close();
  }
}

/** A demo briefing left from before: put back the real one it covered, or clear it. */
export function dropDemoBriefing(dataDir: string): boolean {
  const file = path.join(dataDir, "daily-bias.json");
  const before = path.join(dataDir, "daily-bias.before-demo.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { demo?: boolean };
    if (data?.demo !== true) return false;
    if (fs.existsSync(before)) fs.renameSync(before, file);
    else fs.rmSync(file);
    return true;
  } catch {
    return false; // no briefing, or not one the demo wrote — leave it
  }
}

/**
 * The desk no longer ships demo data. Anything an earlier version's demo left behind —
 * tagged "[demo]", so nothing of yours is ever touched — goes on start.
 */
function clearDemo(db: Database.Database, dataDir: string): string | null {
  const trades = db.prepare("DELETE FROM trades WHERE notes LIKE ?").run(`${DEMO}%`).changes;
  const checkins = db.prepare("DELETE FROM checkins WHERE note = ?").run(DEMO).changes;
  const briefing = dropDemoBriefing(dataDir);
  const parts = [
    trades ? `${trades} trade${trades === 1 ? "" : "s"}` : "",
    checkins ? `${checkins} check-in${checkins === 1 ? "" : "s"}` : "",
    briefing ? "the briefing" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function openDatabase(file = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let archived: string | null = null;
  if (fs.existsSync(file)) {
    const probe = new Database(file, { readonly: true });
    const current = isCurrentSchema(probe);
    probe.close();
    if (!current) archived = archive(file);
  }

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  setupSchema(db);
  const cleared = clearDemo(db, path.dirname(file));
  if (cleared) console.log(`Removed what was left of the old demo: ${cleared}.`);
  const upgraded = upgradeRulebook(db);
  if (upgraded) console.log(`Rulebook updated for this version of the desk: ${upgraded.reason}.`);

  if (archived) {
    const kept = carryCheckins(archived, db);
    console.log(`A database from an older version of the desk was moved to ${path.relative(path.dirname(file), archived)}.`);
    console.log(`A fresh one starts now, with the GOLD Model rulebook and ${kept} of your own check-in${kept === 1 ? "" : "s"}.`);
  }
  return db;
}
